import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../_lib/supabase.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import { CLOSE_DAY_PROFILE_COLUMNS, closeDay, recomputeRange, type CloseDayProfile } from '../_lib/close-day.js'
import { generateWeeklyReview } from '../_lib/review.js'

// Cron diária às 04:30 UTC (sempre depois das 04:00 em Lisboa, com ou sem DST):
// marca análises presas como erro; recalcula, por ordem, os dias alterados
// (marcados pelo trigger mark_day_dirty) e sempre os últimos 3 — no máximo 21
// por noite, a noite seguinte continua —, com o gasto adaptativo e a semana de
// pausa da dieta; o resumo neutro da semana anterior, na primeira noite em
// que falte; ao domingo, limpa refeições apagadas há mais de 7 dias e fotos
// sem dono.

const MAX_DAYS_PER_NIGHT = 21
const TIME_BUDGET_MS = 45_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  try {
    const admin = adminClient()

    const { data: profiles, error } = await admin
      .from('profile')
      .select(CLOSE_DAY_PROFILE_COLUMNS)
    if (error) throw new Error(error.message)

    const startedAt = Date.now()
    const closed = []
    let reviews = 0

    // Análises presas passam a 'erro' (sem IA aqui: o telemóvel tenta outra
    // vez ao abrir): 3 tentativas gastas, ou mais de 24 h a analisar.
    const stuckMessage = { status: 'erro', analysis_error: 'A análise não terminou. Tenta outra vez.' }
    await admin
      .from('meals')
      .update(stuckMessage)
      .eq('status', 'a_analisar')
      .gte('analysis_attempts', 3)
      .lt('analysis_started_at', new Date(Date.now() - 90_000).toISOString())
    await admin
      .from('meals')
      .update(stuckMessage)
      .eq('status', 'a_analisar')
      .lt('created_at', new Date(Date.now() - 86_400_000).toISOString())
    for (const profile of (profiles ?? []) as CloseDayProfile[]) {
      const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

      // Âncora da regra 7: fixa no perfil; sem ela, a semana do primeiro dia registado.
      let anchor = profile.maintenance_anchor ?? null
      if (!anchor) {
        const { data: firstDay } = await admin
          .from('days')
          .select('date')
          .eq('user_id', profile.user_id)
          .order('date')
          .limit(1)
        anchor = firstDay?.[0]?.date ?? null
      }

      const { data: dirtyRows } = await admin
        .from('days')
        .select('date')
        .eq('user_id', profile.user_id)
        .eq('dirty', true)
        .lt('date', today)
        .order('date')
        .limit(1)
      const { dates, next } = recomputeRange(today, dirtyRows?.[0]?.date ?? null, MAX_DAYS_PER_NIGHT)

      let stoppedAt: string | null = next
      for (const date of dates) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          stoppedAt = date
          break
        }
        closed.push(await closeDay(admin, profile, date, anchor))
      }
      // Ficou a meio: marca o dia seguinte para a próxima noite continuar a cadeia.
      if (stoppedAt) {
        await admin
          .from('days')
          .upsert({ user_id: profile.user_id, date: stoppedAt, dirty: true }, { onConflict: 'user_id,date' })
      }

      // O gasto previsto (Mifflin × 1,2) passa a ser escrito pelo servidor,
      // a partir do dia mais recente fechado, quando há ano de nascimento.
      if (profile.birth_year != null) {
        const { data: lastDay } = await admin
          .from('days')
          .select('formula_base')
          .eq('user_id', profile.user_id)
          .lt('date', today)
          .not('formula_base', 'is', null)
          .order('date', { ascending: false })
          .limit(1)
        const formula = lastDay?.[0]?.formula_base
        if (formula != null && Number(formula) !== Number(profile.expected_tdee)) {
          await admin.from('profile').update({ expected_tdee: formula }).eq('user_id', profile.user_id)
        }
      }

      // O resumo da semana que terminou, na primeira noite em que falte.
      if (Date.now() - startedAt < TIME_BUDGET_MS) {
        try {
          if (await generateWeeklyReview(admin, profile.user_id, mondayOf(shiftDate(today, -7)))) {
            reviews++
          }
        } catch (err) {
          console.error('Resumo semanal falhou:', err)
        }
      }
    }

    // Ao domingo: apaga de vez o que foi apagado há mais de 7 dias e até 50
    // fotos sem dono (nenhuma refeição nem favorito as usa).
    let purged = 0
    let orphans = 0
    const todayLisbon = nutritionalDay(new Date(), 4)
    if (new Date(`${todayLisbon}T12:00:00Z`).getUTCDay() === 0 && Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: gone } = await admin
        .from('meals')
        .delete()
        .lt('deleted_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
        .select('id')
      purged = gone?.length ?? 0
      const { data: candidates, error: orphanError } = await admin.rpc('storage_orphan_candidates', {
        p_bucket: 'meal-photos',
        p_min_age: '7 days',
        p_limit: 50,
      })
      if (orphanError) console.error('Órfãos:', orphanError.message)
      const names = ((candidates ?? []) as { name: string }[]).map((c) => c.name)
      if (names.length) {
        const { error: removeError } = await admin.storage.from('meal-photos').remove(names)
        if (removeError) console.error('Remover órfãos:', removeError.message)
        else orphans = names.length
      }
    }
    res.status(200).json({ ok: true, closed, reviews, purged, orphans })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Falha no fecho do dia.' })
  }
}
