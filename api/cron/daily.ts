import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from '../_lib/supabase.js'
import { nutritionalDay, shiftDate } from '../_lib/rules/nutritional-day.js'
import { mondayOf } from '../_lib/rules/manutencao.js'
import {
  CLOSE_DAY_PROFILE_COLUMNS,
  closeDay,
  maintenanceAnchor,
  nightOrder,
  recomputeRange,
  type CloseDayProfile,
} from '../_lib/close-day.js'
import { generateWeeklyReview } from '../_lib/review.js'
import { syncUser } from '../_lib/intervals-sync.js'
import { cronAuthorized } from '../_lib/secret.js'
import { finishCronRun, lastStepAt, startCronRun } from '../_lib/cron-runs.js'
import { cronError, monthlyCleanupDue, retentionCutoff, weeklyCleanupDue, type CronError } from '../_lib/rules/rotinas.js'
import { REVIEW_LOOKBACK_WEEKS, REVIEW_REWRITES_PER_NIGHT, reviewWeeks } from '../_lib/rules/resumo.js'

// Cron diária às 05:30 UTC (no Hobby, num minuto qualquer das 05:00–05:59 UTC:
// sempre depois das 04:00 em Lisboa, com ou sem DST, com uma hora de margem):
// marca análises presas como erro; recalcula, por ordem, os dias alterados
// (marcados pelo trigger mark_day_dirty) e sempre os últimos 3 — no máximo 21
// por noite, a noite seguinte continua —, com o gasto adaptativo e a semana de
// pausa da dieta; o resumo neutro da semana anterior, na primeira noite em
// que falte e quando os dados dessa semana mudam, e os das semanas já
// resumidas das últimas 8 cujos dados mudaram (B9: um dia de há 3 semanas
// respondido; no máximo 6 semanas vistas e 2 reescritas por pessoa e por
// noite, rules/resumo.ts); ao domingo (ou na noite
// seguinte, se a última limpeza tem mais de 7 dias), limpa refeições apagadas
// há mais de 7 dias, fotos sem dono e as imagens dos prints com mais de 90
// dias; uma vez por mês, os registos de api_calls, off_searches e cron_runs
// com mais de 90 dias. Primeiro sincroniza-se o relógio de toda a gente (em
// paralelo), depois fecham-se os dias (cada noite começa por outra pessoa);
// os resumos (IA) vêm depois, com o tempo que sobra.
//
// Um erro numa pessoa ou num dia não pára o resto (S1): o dia fica marcado
// como sujo para a noite seguinte, e os erros vão no JSON e em cron_runs.

const MAX_DAYS_PER_NIGHT = 21
const TIME_BUDGET_MS = 45_000
// A sincronização (até 8 s, toda a gente em paralelo) corre logo no início;
// um resumo (até 20 s de IA) só começa a tempo de acabar antes dos 60 s do Vercel.
const REVIEW_BUDGET_MS = 35_000

async function markDirty(admin: SupabaseClient, userId: string, date: string): Promise<void> {
  const { error } = await admin.from('days').upsert({ user_id: userId, date, dirty: true }, { onConflict: 'user_id,date' })
  if (error) throw new Error(error.message)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Não autorizado.' })
    return
  }

  let runId: number | null = null
  const errors: CronError[] = []
  try {
    const admin = adminClient()
    runId = await startCronRun(admin, 'daily')

    const { data: profiles, error } = await admin
      .from('profile')
      .select(CLOSE_DAY_PROFILE_COLUMNS)
    if (error) throw new Error(error.message)

    const startedAt = Date.now()
    const closed = []
    // B9: os dias fechados esta noite, por pessoa (as semanas deles revêem-se).
    const touched = new Map<string, string[]>()
    let reviews = 0

    // Análises presas passam a 'erro' (sem IA aqui: o telemóvel tenta outra
    // vez ao abrir): 3 tentativas gastas, ou mais de 24 h a analisar.
    try {
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
    } catch (err) {
      errors.push(cronError('analises_presas', err))
    }

    const people = nightOrder((profiles ?? []) as CloseDayProfile[], nutritionalDay(new Date(), 4))

    // Passo 1: treinos do relógio (intervals.icu), últimos 3 dias, no máximo
    // 8 s, toda a gente ao mesmo tempo (S4: em série eram até 8 s por pessoa).
    // Um erro fica no estado da ligação; o fecho do dia continua.
    const syncs = await Promise.all(
      people.map((profile) => syncUser(admin, profile.user_id, { days: 3, timeoutMs: 8_000 }).catch(() => false)),
    )
    const synced = syncs.filter(Boolean).length

    for (const profile of people) {
      try {
        const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

        // Âncora da regra 7: fixa no perfil (a mesma do recálculo).
        const anchor = await maintenanceAnchor(admin, profile)

        const { data: dirtyRows, error: dirtyError } = await admin
          .from('days')
          .select('date')
          .eq('user_id', profile.user_id)
          .eq('dirty', true)
          .lt('date', today)
          .order('date')
          .limit(1)
        if (dirtyError) throw new Error(dirtyError.message)
        const { dates, next } = recomputeRange(today, dirtyRows?.[0]?.date ?? null, MAX_DAYS_PER_NIGHT)

        let stoppedAt: string | null = next
        for (const date of dates) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            console.warn('Cron: sem tempo, continua na noite seguinte', profile.user_id, date)
            stoppedAt = date
            break
          }
          try {
            closed.push(await closeDay(admin, profile, date, anchor))
            touched.set(profile.user_id, [...(touched.get(profile.user_id) ?? []), date])
          } catch (err) {
            // O dia fica sujo (a noite seguinte tenta outra vez); os dias
            // seguintes e as outras pessoas continuam.
            console.error('Cron: fecho do dia falhou', profile.user_id, date, err)
            errors.push(cronError('fecho', err, { user_id: profile.user_id, date }))
            await markDirty(admin, profile.user_id, date).catch((markError: unknown) =>
              console.error('Cron: não consegui marcar o dia', profile.user_id, date, markError),
            )
          }
        }
        // Ficou a meio: marca o dia seguinte para a próxima noite continuar a cadeia.
        if (stoppedAt) await markDirty(admin, profile.user_id, stoppedAt)

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
      } catch (err) {
        console.error('Cron: pessoa falhou', profile.user_id, err)
        errors.push(cronError('pessoa', err, { user_id: profile.user_id }))
      }
    }

    // Os resumos: o da semana que terminou (na primeira noite em que falte e
    // quando os dados dessa semana mudam) e os das semanas já resumidas cujos
    // dados mudaram (B9). Ver uma semana são só leituras; a IA só corre se a
    // impressão digital mudou, no máximo REVIEW_REWRITES_PER_NIGHT vezes por
    // pessoa, e só com tempo para a chamada.
    for (const profile of people) {
      const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
      let weeks = [mondayOf(shiftDate(today, -7))]
      try {
        const { data: reviewedRows, error: reviewedError } = await admin
          .from('weekly_reviews')
          .select('week_start')
          .eq('user_id', profile.user_id)
          .eq('kind', 'neutro')
          .gte('week_start', shiftDate(weeks[0]!, -7 * REVIEW_LOOKBACK_WEEKS))
        if (reviewedError) throw new Error(reviewedError.message)
        weeks = reviewWeeks({
          today,
          reviewed: (reviewedRows ?? []).map((r) => r.week_start as string),
          touched: touched.get(profile.user_id) ?? [],
        })
      } catch (err) {
        // Sem a lista, fica a semana anterior (como antes).
        console.error('Cron: semanas resumidas', profile.user_id, err)
        errors.push(cronError('resumo_semanas', err, { user_id: profile.user_id }))
      }
      let rewrites = 0
      for (const weekStart of weeks) {
        if (rewrites >= REVIEW_REWRITES_PER_NIGHT) break
        if (Date.now() - startedAt >= REVIEW_BUDGET_MS) {
          console.warn('Cron: resumo semanal fica para a noite seguinte', profile.user_id, weekStart)
          break
        }
        try {
          if (await generateWeeklyReview(admin, profile.user_id, weekStart)) {
            reviews++
            rewrites++
          }
        } catch (err) {
          console.error('Resumo semanal falhou:', err)
          errors.push(cronError('resumo', err, { user_id: profile.user_id, date: weekStart }))
        }
      }
    }

    // Limpeza (S9): ao domingo, ou na primeira noite seguinte se a do domingo
    // não chegou a correr (a última tem mais de 7 dias).
    let purged = 0
    let orphans = 0
    let prints = 0
    let cleanup = false
    let retention = false
    const todayLisbon = nutritionalDay(new Date(), 4)
    if (Date.now() - startedAt < TIME_BUDGET_MS) {
      cleanup = weeklyCleanupDue(todayLisbon, await lastStepAt(admin, 'daily', 'cleanup'), new Date())
    }
    if (cleanup) {
      // Apaga de vez o que foi apagado há mais de 7 dias.
      try {
        const { data: gone, error: goneError } = await admin
          .from('meals')
          .delete()
          .lt('deleted_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
          .select('id')
        if (goneError) throw new Error(goneError.message)
        purged = gone?.length ?? 0
      } catch (err) {
        errors.push(cronError('limpeza_refeicoes', err))
      }

      // Até 50 fotos sem dono (nenhuma refeição nem favorito as usa).
      try {
        const { data: candidates, error: orphanError } = await admin.rpc('storage_orphan_candidates', {
          p_bucket: 'meal-photos',
          p_min_age: '7 days',
          p_limit: 50,
        })
        if (orphanError) throw new Error(orphanError.message)
        const names = ((candidates ?? []) as { name: string }[]).map((c) => c.name)
        if (names.length) {
          const { error: removeError } = await admin.storage.from('meal-photos').remove(names)
          if (removeError) throw new Error(removeError.message)
          orphans = names.length
        }
      } catch (err) {
        errors.push(cronError('limpeza_orfaos', err))
      }

      // As imagens dos prints com mais de 90 dias apagam-se (com ou sem
      // miniatura); os números ficam no treino.
      try {
        type PrintRow = { id: string; workout_id: string | null; source_paths: string[] | null; thumb_paths: string[] | null }
        const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()
        const oldPrints = (column: 'thumb_paths' | 'source_paths') =>
          admin
            .from('workout_imports')
            .select('id,workout_id,source_paths,thumb_paths')
            .lt('created_at', cutoff)
            .neq('status', 'por_confirmar')
            .neq(column, '{}')
            .limit(50)
        const [withThumbs, withSources] = await Promise.all([oldPrints('thumb_paths'), oldPrints('source_paths')])
        if (withThumbs.error) throw new Error(withThumbs.error.message)
        if (withSources.error) throw new Error(withSources.error.message)
        const rows = new Map<string, PrintRow>()
        for (const row of [...(withThumbs.data ?? []), ...(withSources.data ?? [])] as PrintRow[]) rows.set(row.id, row)
        for (const row of [...rows.values()].slice(0, 50)) {
          const files = [...(row.source_paths ?? []), ...(row.thumb_paths ?? [])]
          if (!files.length) continue
          const { error: removeError } = await admin.storage.from('workout-shots').remove(files)
          if (removeError) {
            console.error('Prints antigos:', removeError.message)
            continue
          }
          await admin.from('workout_imports').update({ source_paths: [], thumb_paths: [] }).eq('id', row.id)
          if (row.workout_id) await admin.from('workouts').update({ source_paths: [] }).eq('id', row.workout_id)
          prints++
        }
      } catch (err) {
        errors.push(cronError('limpeza_prints', err))
      }

      // Uma vez por mês: os registos com mais de 90 dias (custos da IA,
      // pesquisas de alimentos e o próprio histórico das crons).
      if (monthlyCleanupDue(todayLisbon, await lastStepAt(admin, 'daily', 'retention'))) {
        retention = true
        const cutoff = retentionCutoff(new Date())
        const steps = [
          ['api_calls', 'created_at'],
          ['off_searches', 'fetched_at'],
          ['cron_runs', 'started_at'],
        ] as const
        for (const [table, column] of steps) {
          try {
            const { error: deleteError } = await admin.from(table).delete().lt(column, cutoff)
            // cron_runs pode ainda não existir (migração por correr).
            if (deleteError && table !== 'cron_runs') throw new Error(deleteError.message)
          } catch (err) {
            errors.push(cronError(`retencao_${table}`, err))
          }
        }
      }
    }

    const ok = errors.length === 0
    const summary = { synced, closed: closed.length, reviews, purged, orphans, prints, cleanup, retention }
    await finishCronRun(admin, runId, { ok, errors, summary })
    res.status(200).json({ ok, synced, closed, reviews, purged, orphans, prints, cleanup, retention, errors })
  } catch (err) {
    console.error(err)
    errors.push(cronError('geral', err))
    try {
      await finishCronRun(adminClient(), runId, { ok: false, errors, summary: {} })
    } catch {
      // sem cliente, sem registo
    }
    res.status(500).json({ error: 'Falha no fecho do dia.', errors })
  }
}
