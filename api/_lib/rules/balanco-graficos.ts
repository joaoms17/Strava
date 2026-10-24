// Balanço: as contas dos gráficos. A cor de cada dia contra o alvo desse dia,
// a frase do gráfico da semana, o calendário do mês (dias no alvo, decisão
// 289), as últimas semanas lado a lado (défice médio e peso médio) e a única
// ação de «Para esta semana». Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'
import { mondayOf } from './manutencao.js'
import { ON_TARGET_TOLERANCE_KCAL, monthBounds, onTarget, type MonthDay } from './mes.js'
import { counted } from './projecao.js'
import type { MoveNote } from './projecao.js'
import { SLOT_LABEL, type Slot } from './momentos.js'
import { daysBetween, meanOf, type DatedValue } from './graficos.js'
import { dec1, int, signed1 } from './leituras.js'

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const weekdayShort = (d: string) => WEEKDAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()]!
const round10 = (n: number) => Math.round(n / 10) * 10

// --- A semana, dia a dia -------------------------------------------------

// ±100 kcal do alvo é «no alvo»; acima disso, «acima»; abaixo, «abaixo»
// (mais clara: comeu menos do que o alvo).
export const DAY_BAND_KCAL = ON_TARGET_TOLERANCE_KCAL

export type DayResult = 'no_alvo' | 'acima' | 'abaixo' | 'fora' | 'hoje' | 'vazio' | 'futuro'

export interface WeekDay {
  date: string
  eaten: number
  plan: number
  meals: number
  complete: boolean
}

export function dayResult(d: WeekDay, today: string): DayResult {
  if (d.date > today) return 'futuro'
  if (d.meals === 0) return d.date === today ? 'hoje' : 'vazio'
  if (d.date === today) return 'hoje'
  if (!d.complete) return 'fora'
  const diff = d.eaten - d.plan
  if (diff > DAY_BAND_KCAL) return 'acima'
  if (diff < -DAY_BAND_KCAL) return 'abaixo'
  return 'no_alvo'
}

// «4 de 6 dias completos no alvo · 1 acima» (no alvo = até 100 kcal acima do
// alvo do dia, como em «O teu mês»).
export function weekDaysReading(days: WeekDay[], today: string): string {
  const done = days.filter((d) => d.date < today && d.complete && d.meals > 0)
  if (done.length === 0) return 'Ainda sem dias completos nesta semana'
  const on = done.filter((d) => d.eaten <= d.plan + DAY_BAND_KCAL).length
  const above = done.length - on
  const head = `${on} de ${done.length} ${done.length === 1 ? 'dia completo' : 'dias completos'} no alvo`
  return above > 0 ? `${head} · ${above} acima` : head
}

// --- O mês em calendário -------------------------------------------------

export type CalResult = 'no_alvo' | 'acima' | 'fora' | 'sem_registo' | 'hoje' | 'futuro'

export interface CalCell {
  date: string
  day: number
  result: CalResult
  kcalIn: number | null
  kcalTarget: number | null
}

export interface MonthCalendar {
  month: string
  weeks: (CalCell | null)[][] // segunda a domingo
  onTarget: number
  countedDays: number
  streak: number
  reading: string
}

export function monthCalendar(month: string, days: MonthDay[], today: string): MonthCalendar {
  const { first, last } = monthBounds(month)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const cells: CalCell[] = []
  let on = 0
  let countedDays = 0
  let streak = 0
  let run = 0
  for (let date = first; date <= last; date = shiftDate(date, 1)) {
    const d = byDate.get(date)
    let result: CalResult
    if (date > today) result = 'futuro'
    else if (date === today) result = 'hoje'
    else if (d && counted(d)) {
      countedDays++
      result = onTarget(d) ? 'no_alvo' : 'acima'
    } else if (d && Number(d.kcal_in) > 0) result = 'fora'
    else result = 'sem_registo'
    if (result === 'no_alvo') on++
    // A sequência só conta dias que acabaram (hoje ainda não).
    run = result === 'no_alvo' ? run + 1 : date >= today ? run : 0
    streak = Math.max(streak, run)
    cells.push({
      date,
      day: Number(date.slice(8, 10)),
      result,
      kcalIn: d && Number(d.kcal_in) > 0 ? Math.round(Number(d.kcal_in)) : null,
      kcalTarget: d && Number(d.kcal_target) > 0 ? Math.round(Number(d.kcal_target)) : null,
    })
  }
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const grid: (CalCell | null)[] = [...Array.from({ length: lead }, () => null), ...cells]
  while (grid.length % 7) grid.push(null)
  const weeks: (CalCell | null)[][] = []
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7))
  const reading =
    countedDays === 0
      ? 'Ainda sem dias completos neste mês'
      : `${on} de ${countedDays} ${countedDays === 1 ? 'dia completo' : 'dias completos'} no alvo${streak >= 2 ? ` · melhor sequência: ${streak} dias` : ''}`
  return { month, weeks, onTarget: on, countedDays, streak, reading }
}

// --- Semana a semana -----------------------------------------------------

export interface BalanceDayRow {
  date: string
  kcal_in: number | null
  kcal_out_est: number | null
  is_complete: boolean
  flags?: string[] | null
}

export interface WeekBalance {
  monday: string
  deficit: number | null // kcal/dia (gasto − comido), média dos dias completos
  days: number // dias completos que contam
  kg: number | null // média das pesagens dessa semana
  water: boolean // semana de água do ciclo (o peso sobe sem ser gordura)
}

export const MIN_WEEK_DAYS = 3

// As semanas de `mondays` (a mais antiga primeiro), com o défice médio dos
// dias completos (sem «faltou algo», até ontem) e o peso médio das pesagens.
export function weeklyBalance(
  days: BalanceDayRow[],
  weights: DatedValue[],
  mondays: string[],
  today: string,
  waterDay?: (d: string) => boolean,
): WeekBalance[] {
  return mondays.map((monday) => {
    const sunday = shiftDate(monday, 6)
    const inWeek = (d: string) => d >= monday && d <= sunday
    const used = days.filter(
      (d) =>
        inWeek(d.date) &&
        d.date < today &&
        d.is_complete &&
        !(d.flags ?? []).includes('faltou_algo') &&
        d.kcal_out_est != null &&
        d.kcal_in != null,
    )
    const ws = weights.filter((w) => inWeek(w.date))
    const kg = meanOf(ws.map((w) => w.value))
    return {
      monday,
      deficit: used.length ? round10(meanOf(used.map((d) => Number(d.kcal_out_est) - Number(d.kcal_in)))!) : null,
      days: used.length,
      kg: kg != null ? Math.round(kg * 10) / 10 : null,
      water: waterDay != null && ws.some((w) => waterDay(w.date)),
    }
  })
}

// As segundas-feiras das `count` semanas até à de `today`.
export function mondaysUpTo(today: string, count: number): string[] {
  const current = mondayOf(today)
  return Array.from({ length: count }, (_, i) => shiftDate(current, -7 * (count - 1 - i)))
}

export function weeklyReading(weeks: WeekBalance[]): string {
  const withDeficit = weeks.filter((w) => w.deficit != null && w.days >= MIN_WEEK_DAYS)
  if (withDeficit.length < 2) return 'Ainda poucas semanas completas: volta daqui a 1 semana'
  const firstMonday = withDeficit[0]!.monday
  const n = Math.round(daysBetween(firstMonday, weeks[weeks.length - 1]!.monday) / 7) + 1
  const avg = meanOf(withDeficit.map((w) => w.deficit!))!
  const deficit =
    avg >= 50
      ? `défice médio de ${int(round10(avg))} kcal por dia`
      : avg <= -50
        ? `em média ${int(round10(-avg))} kcal por dia acima do gasto`
        : 'comeste cerca do que gastaste'
  const kgs = weeks.filter((w) => w.kg != null && !w.water && w.monday >= firstMonday)
  const a = kgs[0]
  const b = kgs[kgs.length - 1]
  if (!a || !b || a.monday === b.monday) return `Em ${n} semanas: ${deficit}`
  const kg = Math.round((b.kg! - a.kg!) * 10) / 10
  const weight = Math.abs(kg) < 0.2 ? 'peso médio estável' : `${signed1(kg)} kg no peso médio`
  return `Em ${n} semanas: ${deficit} e ${weight}`
}

// A semana com o maior défice médio (com 4 dias completos ou mais).
export function bestDeficitWeek(weeks: WeekBalance[]): WeekBalance | null {
  const ok = weeks.filter((w) => w.deficit != null && w.days >= 4)
  if (ok.length < 3) return null
  return ok.reduce((best, w) => (w.deficit! >= best.deficit! ? w : best))
}

// --- «Para esta semana»: uma ação só -------------------------------------

export type ActionKind = 'fechar_dias' | 'semana' | 'fim_de_semana' | 'proteina' | 'pesar' | 'manter'

export interface WeekAction {
  kind: ActionKind
  title: string
  detail: string
  date?: string // o dia para abrir no Hoje
}

export const LEFT_OUT_MIN = 2
export const WEEKEND_GAP_KCAL = 250
export const WEEKEND_MIN_DAYS = 5
export const PROTEIN_GAP_G = 8
export const MIN_WEIGHINGS_7 = 3
const MAIN_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']

export interface ActionInput {
  leftOut: string[] // dias acabados desta semana com refeições que não contam
  note: MoveNote | null // a projeção contra a da semana passada
  weekday: number | null // kcal/dia nos dias de semana (28 dias)
  weekend: number | null // kcal/dia ao sábado e domingo
  fdsDaysEarlier: number | null // dias mais cedo com o fim de semana como a semana
  targetKg: number | null
  protein: { slot: Slot; avg: number; days: number }[]
  perMeal: number
  weighings7: number // pesagens nos últimos 7 dias
  projection: string | null // «A este ritmo: …»
}

// Pela ordem: os dados primeiro (dias de fora), o que atrasou a projeção,
// o fim de semana, a proteína da refeição mais fraca, as pesagens; sem
// nada disso, continuar.
export function weekAction(input: ActionInput): WeekAction {
  const { leftOut } = input
  if (leftOut.length >= LEFT_OUT_MIN) {
    const list = leftOut.map((d) => `${weekdayShort(d)} ${Number(d.slice(8, 10))}`).join(', ')
    return {
      kind: 'fechar_dias',
      title: `Responde aos ${leftOut.length} dias que ficaram de fora`,
      detail: `${list}: diz no Hoje se foi tudo. Sem eles, a média da semana e o gasto medido contam menos dias.`,
      date: leftOut[0],
    }
  }
  const gap = input.weekday != null && input.weekend != null ? input.weekend - input.weekday : null
  const kgText = input.targetKg != null ? `${dec1(input.targetKg).replace(/,0$/, '')} kg` : 'o peso alvo'
  const weekendAction = (lead: string | null): WeekAction => {
    const earlier =
      input.fdsDaysEarlier != null && input.fdsDaysEarlier >= 1
        ? ` Assim, chegas aos ${kgText} ${input.fdsDaysEarlier} ${input.fdsDaysEarlier === 1 ? 'dia' : 'dias'} mais cedo.`
        : ''
    const why = gap != null && gap > 0 ? `Comes mais ${int(round10(gap))} kcal por dia ao sábado e ao domingo do que durante a semana.` : ''
    return {
      kind: 'fim_de_semana',
      title: 'Ao fim de semana, come como durante a semana',
      detail: [lead, why].filter(Boolean).join(' ') + earlier,
    }
  }
  const note = input.note
  if (note && note.days >= WEEKEND_MIN_DAYS && note.cause === 'fds') return weekendAction(`Desde a semana passada, a data ${note.text}.`)
  if (note && note.days >= WEEKEND_MIN_DAYS && note.cause === 'semana') {
    return {
      kind: 'semana',
      title: 'Durante a semana, come perto do alvo do dia',
      detail: `Desde a semana passada, a data ${note.text}.`,
    }
  }
  if (gap != null && gap >= WEEKEND_GAP_KCAL && (input.fdsDaysEarlier ?? 0) >= WEEKEND_MIN_DAYS) return weekendAction(null)

  const main = input.protein.filter((p) => MAIN_SLOTS.includes(p.slot) && p.days >= 3)
  const weakest = main.length ? main.reduce((a, b) => (b.avg < a.avg ? b : a)) : null
  if (weakest && input.perMeal - weakest.avg >= PROTEIN_GAP_G) {
    const need = Math.max(5, Math.round((input.perMeal - weakest.avg) / 5) * 5)
    return {
      kind: 'proteina',
      title: `Junta ${need} g de proteína ao ${SLOT_LABEL[weakest.slot].toLowerCase()}`,
      detail: `Tens ${weakest.avg} g em média nos últimos 14 dias; o alvo é ${input.perMeal} g por refeição. Um iogurte grego ou 2 ovos dão cerca de 13–15 g.`,
    }
  }
  if (input.weighings7 < MIN_WEIGHINGS_7) {
    return {
      kind: 'pesar',
      title: 'Pesa-te 3 vezes esta semana',
      detail: 'De manhã, antes de comer. Com poucas pesagens, o peso médio e a data da projeção ficam menos certos.',
    }
  }
  return {
    kind: 'manter',
    title: 'Continua assim',
    detail: input.projection ? `${input.projection}.` : 'Os números desta semana estão no sítio: mantém o que tens feito.',
  }
}
