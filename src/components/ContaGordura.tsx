import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDataVersion } from '../lib/events'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { shiftDate } from '../lib/day'
import { fmt1, fmtDayMonth, fmtInt } from '../lib/format'
import { fatTally, type FatTally, type TallyDay } from '../../api/_lib/rules/conta-gordura'

// Balanço › Mês › «Conta da gordura»: quanto se devia ter perdido pelas contas
// (défice dos dias completos ÷ 7700) contra o que o peso médio desceu, desde o
// início ou desde o último «Recomeçar» (goals.contagem_desde).
export default function ContaGordura({ today }: { today: string }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const version = useDataVersion()
  const [tally, setTally] = useState<FatTally | null>(null)
  const [confirm, setConfirm] = useState(false)
  const saved = typeof profile.goals?.contagem_desde === 'string' ? (profile.goals.contagem_desde as string) : null

  useEffect(() => {
    let alive = true
    void (async () => {
      let since = saved ?? profile.maintenance_anchor ?? null
      if (!since) {
        const { data } = await supabase.from('meals_counted').select('date').order('date').limit(1)
        since = (data?.[0]?.date as string | undefined) ?? today
      }
      const [days, weights] = await Promise.all([
        supabase.from('days').select('date,kcal_in,kcal_out_est,is_complete,flags').gte('date', since).lt('date', today),
        supabase.from('weights').select('date,kg').gte('date', shiftDate(since, -14)).lte('date', today).order('date'),
      ])
      if (!alive) return
      setTally(fatTally((days.data ?? []) as TallyDay[], (weights.data ?? []) as { date: string; kg: number }[], since, today))
    })()
    return () => {
      alive = false
    }
  }, [saved, profile.maintenance_anchor, today, version])

  async function restart() {
    const previous = saved
    const ok = await update({ goals: { ...(profile.goals ?? {}), contagem_desde: today } })
    setConfirm(false)
    if (!ok) {
      toast('Não consegui guardar.')
      return
    }
    toast('A contagem recomeça hoje.', [
      { label: 'Anular', run: async () => void (await update({ goals: { ...(profile.goals ?? {}), contagem_desde: previous } })) },
    ])
  }

  if (!tally) return null
  const { previstoKg: kg, realKg } = tally
  const headline =
    tally.diasContados === 0
      ? 'A contagem começa com o primeiro dia completo.'
      : Math.abs(kg) < 0.1
        ? 'Pelas contas, estás ela por ela.'
        : `Pelas contas, devias ter ${kg > 0 ? 'perdido' : 'ganho'} cerca de ${fmt1(Math.abs(kg))} kg de gordura.`
  const gap = realKg != null && tally.diasContados > 0 ? realKg - kg : null
  const note =
    gap == null
      ? null
      : Math.abs(gap) <= 0.5
        ? 'Bate certo.'
        : gap > 0
          ? 'A balança desceu mais do que as contas: no início sai água, ou o gasto real é maior do que o estimado.'
          : 'As contas dizem mais do que a balança: água e sal escondem gordura perdida, ou ficou comida por registar.'

  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-5" aria-label="Conta da gordura">
      <p className="font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase">Conta da gordura</p>
      <p className="text-[19px] leading-snug font-semibold">{headline}</p>
      {tally.diasContados > 0 && (
        <p className="text-[14px] text-dim">
          {tally.defice >= 0 ? 'Défice' : 'Excedente'} de {fmtInt(Math.abs(tally.defice))} kcal em {tally.diasContados}{' '}
          {tally.diasContados === 1 ? 'dia completo' : 'dias completos'} desde {fmtDayMonth(tally.desde)} (7 700 kcal ≈ 1 kg).
        </p>
      )}
      {realKg != null && (
        <p className="text-[15px]">
          A balança: {realKg === 0 ? 'peso médio igual' : `${realKg > 0 ? '−' : '+'}${fmt1(Math.abs(realKg))} kg no peso médio`}.
          {note && <span className="text-dim"> {note}</span>}
        </p>
      )}
      {tally.diasFora > 0 && (
        <p className="text-[13px] text-dim">
          {tally.diasFora} {tally.diasFora === 1 ? 'dia ficou' : 'dias ficaram'} de fora (incompletos ou com «faltou algo»).
        </p>
      )}
      {confirm ? (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <BusyButton busy="A guardar…" onClick={restart} className="min-h-11 rounded-xl bg-surface2 text-[15px]">
            Recomeçar hoje
          </BusyButton>
          <button onClick={() => setConfirm(false)} className="min-h-11 rounded-xl text-[15px] text-dim">
            Cancelar
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="min-h-10 text-[14px] text-eat">
          Recomeçar a contagem
        </button>
      )}
    </section>
  )
}
