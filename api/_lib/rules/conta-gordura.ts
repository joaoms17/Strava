// «Conta da gordura»: desde uma data (o início, ou o último «Recomeçar»), o
// défice somado dos dias completos (gasto − comido) a 7700 kcal por kg,
// contra o que o peso médio desceu. Os dias incompletos ou com «faltou algo»
// ficam de fora (não se sabe o que se comeu) e contam-se à parte.
import { shiftDate } from './nutritional-day.js'
import { trend7 } from './weight.js'
import { KCAL_PER_KG } from './gasto.js'

export interface TallyDay {
  date: string
  kcal_in: number | null
  kcal_out_est: number | null
  is_complete: boolean
  flags?: string[] | null
}

export interface FatTally {
  desde: string
  diasContados: number
  diasFora: number
  defice: number // kcal; positivo = comeu menos do que gastou
  previstoKg: number // positivo = devia ter perdido
  realKg: number | null // positivo = o peso médio desceu
}

const round1 = (n: number) => Math.round(n * 10) / 10 || 0

export function fatTally(days: TallyDay[], weights: { date: string; kg: number }[], since: string, today: string): FatTally {
  const yesterday = shiftDate(today, -1)
  const inRange = days.filter((d) => d.date >= since && d.date <= yesterday)
  const used = inRange.filter(
    (d) => d.is_complete && d.kcal_out_est != null && d.kcal_in != null && !(d.flags ?? []).includes('faltou_algo'),
  )
  const defice = Math.round(used.reduce((a, d) => a + Number(d.kcal_out_est) - Number(d.kcal_in), 0))
  let calendarDays = 0
  for (let d = since; d <= yesterday; d = shiftDate(d, 1)) calendarDays++

  // Peso médio de 7 dias: o último até ao início (ou o primeiro depois, se
  // ainda não havia pesagens) contra o mais recente.
  const trend = trend7(weights.map((w) => ({ date: w.date, value: Number(w.kg) })))
  const start = [...trend].reverse().find((p) => p.date <= since) ?? trend.find((p) => p.date >= since)
  const end = trend[trend.length - 1]
  const realKg = start && end && end.date > start.date ? round1(start.value - end.value) : null

  return {
    desde: since,
    diasContados: used.length,
    diasFora: Math.max(0, calendarDays - used.length),
    defice,
    previstoKg: round1(defice / KCAL_PER_KG),
    realKg,
  }
}
