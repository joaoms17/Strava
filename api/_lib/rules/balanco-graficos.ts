// Balanço: as contas dos gráficos. A cor de cada dia contra o alvo desse dia,
// a frase do gráfico da semana, o calendário do mês (dias no alvo, decisão
// 289), as últimas semanas lado a lado (défice médio e peso médio) e a única
// ação de «Para esta semana». Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'
import { mondayOf } from './manutencao.js'
import { ON_TARGET_TOLERANCE_KCAL, monthBounds, onTarget, overLevel, type MonthDay } from './mes.js'
import { counted } from './projecao.js'
import type { MoveNote } from './projecao.js'
import { SLOT_LABEL, type Slot } from './momentos.js'
import { daysBetween, meanOf, type DatedValue } from './graficos.js'
import { dec1, int, signed1 } from './leituras.js'

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const weekdayShort = (d: string) => WEEKDAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()]!
const round10 = (n: number) => Math.round(n / 10) * 10

// --- A semana, dia a dia -------------------------------------------------

// Decisão 289: um dia completo está «no alvo» quando o comido fica até 100
// kcal acima do alvo do dia. Dentro disso, a cor separa os ±100 («no_alvo»)
// dos dias bem abaixo («abaixo», mais claros), mas os dois contam como no
// alvo, na frase, na legenda e no calendário do Mês: um dia, um veredicto.
// Acima, há dois níveis (decisão 301, `overLevel`): «acima do alvo» (ainda
// abaixo do gasto, âmbar com riscas) e «acima do gasto» (o falhar grave,
// vermelho cheio com «!»).
export const DAY_BAND_KCAL = ON_TARGET_TOLERANCE_KCAL

export type DayResult = 'no_alvo' | 'acima_alvo' | 'acima_gasto' | 'abaixo' | 'fora' | 'hoje' | 'vazio' | 'futuro'

export interface WeekDay {
  date: string
  eaten: number
  plan: number
  meals: number
  complete: boolean
  out?: number | null // o gasto do dia (o da linha azul e do fecho do dia)
}

export const isAbove = (r: DayResult | CalResult): r is 'acima_alvo' | 'acima_gasto' => r === 'acima_alvo' || r === 'acima_gasto'

export function dayResult(d: WeekDay, today: string): DayResult {
  if (d.date > today) return 'futuro'
  if (d.meals === 0) return d.date === today ? 'hoje' : 'vazio'
  if (d.date === today) return 'hoje'
  if (!d.complete) return 'fora'
  const over = overLevel(d.eaten, d.plan, d.out)
  if (over) return over
  if (d.eaten - d.plan < -DAY_BAND_KCAL) return 'abaixo'
  return 'no_alvo'
}

// «no alvo» e «bem abaixo» são o mesmo veredicto (decisão 289).
export const isOnTarget = (r: DayResult): boolean => r === 'no_alvo' || r === 'abaixo'

// «3 de 5 dias completos no alvo · 1 acima do alvo · 1 acima do gasto» (no
// alvo = até 100 kcal acima do alvo do dia, como em «O teu mês»), contado com
// o mesmo dayResult das barras.
export function weekDaysReading(days: WeekDay[], today: string): string {
  const done = days.map((d) => dayResult(d, today)).filter((r) => isOnTarget(r) || isAbove(r))
  if (done.length === 0) return 'Ainda sem dias completos nesta semana'
  const on = done.filter(isOnTarget).length
  const mild = done.filter((r) => r === 'acima_alvo').length
  const grave = done.filter((r) => r === 'acima_gasto').length
  const parts = [`${on} de ${done.length} ${done.length === 1 ? 'dia completo' : 'dias completos'} no alvo`]
  if (mild > 0) parts.push(`${mild} acima do alvo`)
  if (grave > 0) parts.push(`${grave} acima do gasto`)
  return parts.join(' · ')
}

// O que o toque num dia diz: «no alvo · 450 kcal abaixo», «acima do alvo,
// ainda abaixo do gasto · +320 kcal», «acima do gasto · +250 kcal do que
// gastaste» (a diferença contra o gasto, não contra o alvo).
export function dayVerdict(r: DayResult | CalResult, eaten: number | null, plan: number | null, out?: number | null): string {
  const diff = eaten != null && plan != null ? Math.round(eaten - plan) : null
  switch (r) {
    case 'no_alvo':
      return 'no alvo'
    case 'abaixo':
      return diff != null ? `no alvo · ${int(round10(-diff))} kcal abaixo` : 'no alvo (abaixo)'
    case 'acima_alvo': {
      const head = out != null && out > 0 ? 'acima do alvo, ainda abaixo do gasto' : 'acima do alvo'
      return diff != null ? `${head} · +${int(round10(diff))} kcal` : head
    }
    case 'acima_gasto':
      return eaten != null && out != null ? `acima do gasto · +${int(round10(eaten - out))} kcal do que gastaste` : 'acima do gasto'
    case 'fora':
      return 'ficou de fora (incompleto)'
    case 'hoje':
      return 'hoje, ainda a meio'
    case 'vazio':
    case 'sem_registo':
      return 'sem registos'
    default:
      return ''
  }
}

// A linha da média dos 7 dias só quando diz alguma coisa: a menos de 80 kcal
// da mediana dos alvos da semana ficava colada ao traço do alvo (o número
// fica na legenda).
export const MEAN_LINE_MIN_GAP_KCAL = 80

export function showMeanLine(avg: number | null, plans: number[]): boolean {
  if (avg == null) return false
  const sorted = plans.filter((p) => p > 0).sort((a, b) => a - b)
  if (!sorted.length) return true
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  return Math.abs(avg - mid) >= MEAN_LINE_MIN_GAP_KCAL
}

// A linha de factos debaixo da frase da semana: «5 dias completos · média
// 2 010 kcal · 4 treinos».
export function weekFacts(completeDays: number, avgEaten: number | null, sessions: number): string | null {
  const parts: string[] = []
  if (completeDays > 0) parts.push(`${completeDays} ${completeDays === 1 ? 'dia completo' : 'dias completos'}`)
  if (avgEaten != null && completeDays > 0) parts.push(`média ${int(round10(avgEaten))} kcal`)
  // Sem treinos não se diz nada (a Joana não treina e não é falha).
  if (sessions > 0) parts.push(`${sessions} ${sessions === 1 ? 'treino' : 'treinos'}`)
  return parts.length ? parts.join(' · ') : null
}

// --- O mês em calendário -------------------------------------------------

export type CalResult = 'no_alvo' | 'acima_alvo' | 'acima_gasto' | 'fora' | 'sem_registo' | 'hoje' | 'futuro'

export interface CalCell {
  date: string
  day: number
  result: CalResult
  kcalIn: number | null
  kcalTarget: number | null
  kcalOut: number | null
}

export interface MonthCalendar {
  month: string
  weeks: (CalCell | null)[][] // segunda a domingo
  onTarget: number
  aboveTarget: number // acima do alvo, ainda abaixo do gasto
  aboveSpent: number // acima do gasto (decisão 301)
  countedDays: number
  streak: number
  reading: string
}

export function monthCalendar(month: string, days: MonthDay[], today: string): MonthCalendar {
  const { first, last } = monthBounds(month)
  const byDate = new Map(days.map((d) => [d.date, d]))
  const cells: CalCell[] = []
  let on = 0
  let mild = 0
  let grave = 0
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
      const out = d.kcal_out_est != null ? Number(d.kcal_out_est) : null
      result = onTarget(d) ? 'no_alvo' : (overLevel(Number(d.kcal_in), Number(d.kcal_target), out) ?? 'acima_alvo')
    } else if (d && Number(d.kcal_in) > 0) result = 'fora'
    else result = 'sem_registo'
    if (result === 'no_alvo') on++
    if (result === 'acima_alvo') mild++
    if (result === 'acima_gasto') grave++
    // A sequência só conta dias que acabaram (hoje ainda não).
    run = result === 'no_alvo' ? run + 1 : date >= today ? run : 0
    streak = Math.max(streak, run)
    cells.push({
      date,
      day: Number(date.slice(8, 10)),
      result,
      kcalIn: d && Number(d.kcal_in) > 0 ? Math.round(Number(d.kcal_in)) : null,
      kcalTarget: d && Number(d.kcal_target) > 0 ? Math.round(Number(d.kcal_target)) : null,
      kcalOut: d && d.kcal_out_est != null && Number(d.kcal_out_est) > 0 ? Math.round(Number(d.kcal_out_est)) : null,
    })
  }
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const grid: (CalCell | null)[] = [...Array.from({ length: lead }, () => null), ...cells]
  while (grid.length % 7) grid.push(null)
  const weeks: (CalCell | null)[][] = []
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7))
  // A frase diz os dias acima do gasto (o falhar grave); os «acima do alvo»
  // veem-se no calendário e na legenda (a frase não cabia com os dois e a
  // sequência).
  const reading =
    countedDays === 0
      ? 'Ainda sem dias completos neste mês'
      : `${on} de ${countedDays} ${countedDays === 1 ? 'dia completo' : 'dias completos'} no alvo${grave > 0 ? ` · ${grave} acima do gasto` : ''}${streak >= 2 ? ` · melhor sequência: ${streak} dias` : ''}`
  return { month, weeks, onTarget: on, aboveTarget: mild, aboveSpent: grave, countedDays, streak, reading }
}

// Os dias completos de uma semana contra o alvo, para o resumo semanal (o
// mesmo veredicto do gráfico e do calendário).
export interface TargetRow {
  kcal_in: number | null
  kcal_target: number | null
  kcal_out_est: number | null
  is_complete: boolean
  flags?: string[] | null
}

export function daysAgainstTarget(rows: TargetRow[]): { completos: number; no_alvo: number; acima_do_alvo: number; acima_do_gasto: number } {
  const res = { completos: 0, no_alvo: 0, acima_do_alvo: 0, acima_do_gasto: 0 }
  for (const r of rows) {
    const d: MonthDay = {
      date: '',
      kcal_in: Number(r.kcal_in ?? 0),
      kcal_target: Number(r.kcal_target ?? 0),
      is_complete: r.is_complete === true,
      flags: r.flags ?? [],
      kcal_out_est: r.kcal_out_est,
    }
    if (!counted(d)) continue
    res.completos++
    if (onTarget(d)) res.no_alvo++
    else if (overLevel(d.kcal_in, d.kcal_target, d.kcal_out_est != null ? Number(d.kcal_out_est) : null) === 'acima_gasto') res.acima_do_gasto++
    else res.acima_do_alvo++
  }
  return res
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
  eaten: number | null // kcal/dia comidas, média dos mesmos dias
  out: number | null // kcal/dia gastas, média dos mesmos dias
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
      eaten: used.length ? Math.round(meanOf(used.map((d) => Number(d.kcal_in)))!) : null,
      out: used.length ? Math.round(meanOf(used.map((d) => Number(d.kcal_out_est)))!) : null,
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

export type ActionKind = 'acima_gasto' | 'fechar_dias' | 'semana' | 'fim_de_semana' | 'proteina' | 'pesar' | 'manter'

export interface WeekAction {
  kind: ActionKind
  title: string
  detail: string
  date?: string // o dia para abrir no Hoje
}

export const LEFT_OUT_MIN = 2
export const WEEKEND_GAP_KCAL = 250
export const WEEKEND_MIN_DAYS = 5
export const FDS_MIN_GAP_KCAL = 50
export const PROTEIN_GAP_G = 8
export const MIN_WEIGHINGS_7 = 3
const MAIN_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']

export interface SpentDay {
  date: string
  over: number // kcal comidas a mais do que o gasto do dia
}

export interface ActionInput {
  aboveSpent?: SpentDay[] // dias acabados desta semana acima do gasto (decisão 301)
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

// Pela ordem: um dia acima do gasto (o falhar grave, decisão 301), os dados
// (dias de fora), o que atrasou a projeção, o fim de semana, a proteína da
// refeição mais fraca, as pesagens; sem nada disso, continuar.
export function weekAction(input: ActionInput): WeekAction {
  const { leftOut } = input
  const spent = input.aboveSpent ?? []
  if (spent.length > 0) {
    const list = spent.map((d) => `${weekdayShort(d.date)} ${Number(d.date.slice(8, 10))} (+${int(round10(d.over))} kcal)`)
    const joined = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
    const many = spent.length > 1
    return {
      kind: 'acima_gasto',
      title: 'Fica abaixo do que gastas, todos os dias',
      detail: `${joined}: ${many ? 'nesses dias' : 'nesse dia'} comeste mais do que gastaste, sem défice. Acima do alvo ainda se perde, só mais devagar; acima do gasto, não. Abre o dia e vê o que o fez subir.`,
      date: spent[0]!.date,
    }
  }
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
  // O fim de semana só é «a causa» quando se come mesmo mais nele (≥ 50
  // kcal/dia, o mesmo limiar do cenário «E se…»); sem isso, o título é
  // neutro e não diz «come como durante a semana».
  const weekendHigher = gap != null && gap >= FDS_MIN_GAP_KCAL
  const weekendAction = (lead: string | null): WeekAction => {
    const earlier =
      weekendHigher && input.fdsDaysEarlier != null && input.fdsDaysEarlier >= 1
        ? ` Se comeres como durante a semana, chegas aos ${kgText} ${input.fdsDaysEarlier} ${input.fdsDaysEarlier === 1 ? 'dia' : 'dias'} mais cedo.`
        : ''
    const why = weekendHigher ? `Comes mais ${int(round10(gap!))} kcal por dia ao sábado e ao domingo do que durante a semana.` : ''
    return {
      kind: 'fim_de_semana',
      title: weekendHigher ? 'Ao fim de semana, come como durante a semana' : 'Ao fim de semana, come perto do alvo do dia',
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
