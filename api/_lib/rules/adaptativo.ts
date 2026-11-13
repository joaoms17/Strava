// Regra 4: gasto adaptativo (tdee_est), no fecho do dia, sobre os últimos
// 28 dias completos: tdee = média(kcal_in) + (trend_inicio - trend_fim) x 7700
// / n_dias, suavizado devagar: EMA alfa 0,1, no máximo 30 kcal por dia e 100
// por semana, sem os dias da fase de água (2 semanas no início da dieta, à
// volta de cada pausa e depois de um recomeço) e, até 6 semanas de dados,
// a ±15 % da fórmula (decisão 304). Só mostrar com >= 10 dias completos.
// Se |tdee_est - expected_tdee| > 250, propor ajustar base_kcal.
import { isMaintenanceWeek, mondayOf } from './manutencao.js'
import { shiftDate } from './nutritional-day.js'
import { linearSlope } from './weight.js'
import { KCAL_PER_KG, round1 } from './comum.js'

export interface ClosedDay {
  date: string
  kcal_in: number
  weight_trend: number | null
}

export const TDEE_ALPHA = 0.1
export const TDEE_MAX_STEP_KCAL = 30
export const TDEE_WINDOW_DAYS = 28
export const MIN_COMPLETE_DAYS = 10

// K1: o gasto medido só com pesagens reais suficientes na janela — pelo
// menos 4 dias de pesagem, a cobrir 10 dias ou mais (como a projeção). O
// peso médio guardado em cada dia carrega a mesma pesagem 7 dias seguidos:
// duas pesagens no mesmo fim de semana pareciam «peso estável» e o gasto
// ficava igual ao que se comeu.
export const MEASURED_MIN_WEIGHINGS = 4
export const MEASURED_MIN_SPAN_DAYS = 10

export interface Weighing {
  date: string
  kg: number
}

// Quantas pesagens faltam para medir (0 = chegam): 4 dias de pesagem e 10
// dias entre a primeira e a última. Com os 4 dias mas pouco espaço entre
// eles, falta pelo menos mais uma, mais tarde.
export function missingWeighings(dates: string[]): number {
  const unique = [...new Set(dates)].sort()
  const span = unique.length ? dayDiff(unique[0]!, unique[unique.length - 1]!) : 0
  const byCount = Math.max(0, MEASURED_MIN_WEIGHINGS - unique.length)
  return Math.max(byCount, span < MEASURED_MIN_SPAN_DAYS ? 1 : 0)
}

// A descida do peso (kg, positiva = desceu) e os dias que ela cobre, por
// regressão sobre as pesagens reais, troço a troço: `breaks` diz onde há uma
// fase de água pelo meio (a conta não a atravessa). Várias pesagens no mesmo
// dia contam como a média desse dia.
export function weighingsDrop(
  weighings: Weighing[],
  breaks?: (a: string, b: string) => boolean,
): { drop: number; span: number } {
  const byDate = new Map<string, number[]>()
  for (const w of weighings) byDate.set(w.date, [...(byDate.get(w.date) ?? []), Number(w.kg)])
  const points = [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, kgs]) => ({ date, value: kgs.reduce((x, y) => x + y, 0) / kgs.length }))
  let drop = 0
  let span = 0
  let segment: typeof points = []
  const close = () => {
    if (segment.length >= 2) {
      const days = dayDiff(segment[0]!.date, segment[segment.length - 1]!.date)
      drop += -linearSlope(segment) * days
      span += days
    }
  }
  for (const p of points) {
    const prev = segment[segment.length - 1]
    if (prev && breaks?.(prev.date, p.date)) {
      close()
      segment = []
    }
    segment.push(p)
  }
  close()
  return { drop, span }
}

// window: os dias completos da janela, por ordem cronológica.
// n_dias é o intervalo de calendário entre a primeira e a última tendência
// (o peso muda em dias de calendário, não só nos dias completos). Com
// `breaks`, a janela parte-se em troços onde ele diz que há uma fase de
// água pelo meio: a descida soma-se troço a troço, sem atravessar a fase.
// Com `weighings` (as pesagens reais da janela; é o que o fecho do dia usa,
// K1), a descida mede-se entre pesagens e só com o mínimo de pesagens.
export function tdeeRaw(
  window: ClosedDay[],
  options: { minDays?: number; breaks?: (a: string, b: string) => boolean; weighings?: Weighing[] } = {},
): number | null {
  if (window.length < (options.minDays ?? MIN_COMPLETE_DAYS)) return null
  const kcalMean = window.reduce((acc, d) => acc + d.kcal_in, 0) / window.length
  if (options.weighings) {
    if (missingWeighings(options.weighings.map((w) => w.date)) > 0) return null
    const { drop, span } = weighingsDrop(options.weighings, options.breaks)
    if (span <= 0) return null
    return round1(kcalMean + (drop * KCAL_PER_KG) / span)
  }

  const withTrend = window.filter((d) => d.weight_trend != null)
  let drop = 0
  let span = 0
  let first = withTrend[0]
  let last = first
  const close = () => {
    if (first && last && first.date !== last.date) {
      drop += first.weight_trend! - last.weight_trend!
      span += dayDiff(first.date, last.date)
    }
  }
  for (const d of withTrend.slice(1)) {
    if (options.breaks && last && options.breaks(last.date, d.date)) {
      close()
      first = d
    }
    last = d
  }
  close()
  if (span <= 0) return null
  return round1(kcalMean + (drop * KCAL_PER_KG) / span)
}

export function smoothTdee(previous: number | null, raw: number, alpha = TDEE_ALPHA): number {
  if (previous == null) return round1(raw)
  const step = Math.max(-TDEE_MAX_STEP_KCAL, Math.min(TDEE_MAX_STEP_KCAL, alpha * (raw - previous)))
  return round1(previous + step)
}

// O gasto medido guardado num dia fechado (decisão 304). Só um dia completo
// fora da fase de água dá um passo (é o único que traz dados novos à
// janela); um dia incompleto, um dia da fase de água ou um dia sem dados
// para medir ficam com o valor anterior. O valor fica dentro dos limites da
// fórmula (`measuredBounds`) e muda no máximo 100 kcal por semana em relação
// ao valor de antes da segunda-feira (ou, sem ele, à referência). A primeira
// estimativa parte do valor pelo peso já limitado: a água do início não entra.
export type MeasuredLimit = 'teto' | 'piso' | 'ritmo'

export function dayTdee(input: {
  complete: boolean
  excluded?: boolean
  previous: number | null
  raw: number | null
  reference: number | null
  bounds?: { lo: number; hi: number } | null
  weekStart?: number | null
}): { value: number | null; limit: MeasuredLimit | null } {
  if (!input.complete || input.excluded || input.raw == null) return { value: input.previous, limit: null }
  const reference = input.reference
  const bounds =
    input.bounds ??
    (reference != null ? { lo: reference - MEASURED_MAX_GAP_KCAL, hi: reference + MEASURED_MAX_GAP_KCAL } : null)
  const clampB = (v: number) => (bounds ? Math.min(bounds.hi, Math.max(bounds.lo, v)) : v)
  const raw = clampB(input.raw)
  const start = input.previous != null ? clampB(input.previous) : raw
  let value = clampB(smoothTdee(start, raw))
  let limit: MeasuredLimit | null = bounds && input.raw > bounds.hi ? 'teto' : bounds && input.raw < bounds.lo ? 'piso' : null
  const anchor = input.weekStart ?? reference
  if (anchor != null) {
    const limited = Math.min(anchor + TDEE_MAX_WEEK_STEP_KCAL, Math.max(anchor - TDEE_MAX_WEEK_STEP_KCAL, value))
    if (Math.abs(limited - value) >= 0.5) {
      value = limited
      limit ??= 'ritmo'
    }
  }
  return { value: round1(value), limit }
}

// ---- Fase de água no gasto medido (decisão 304) ----------------------------
// «As primeiras semanas são o que são»: nas 2 primeiras semanas da dieta, nas
// 2 depois de cada semana de pausa (e na própria pausa) e nas 2 depois de um
// recomeço (o primeiro dia completo depois de 7 dias ou mais sem nenhum), o
// peso cai (ou sobe) com água e glicogénio. Esses dias não entram no gasto
// medido e a conta do peso não atravessa essas fases.
export const TDEE_WATER_DAYS = 14
export const RESTART_GAP_DAYS = 7
export const TDEE_MIN_ELIGIBLE_DAYS = 7
export const TDEE_LOOKBACK_DAYS = 120
export const TDEE_WINDOW_CALENDAR_DAYS = 56
export const STABLE_ELIGIBLE_DAYS = 42
export const EARLY_CAP_FRACTION = 0.15
export const TDEE_MAX_WEEK_STEP_KCAL = 100
const MEASURED_MAX_GAP_KCAL = 400

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// Os começos da dieta até `until`: a segunda-feira da semana da âncora, a
// segunda-feira a seguir a cada semana de pausa (com a pausa ligada) e cada
// recomeço. `completeDates` (por ordem) são os dias completos desde `from`;
// o primeiro só é recomeço se houver 7 dias ou mais sem nenhum antes dele
// dentro do que se leu.
export function dietStarts(input: {
  anchor: string | null
  maintenanceEnabled: boolean
  completeDates: string[]
  from: string
  until: string
}): string[] {
  const starts = new Set<string>()
  if (input.anchor) {
    const first = mondayOf(input.anchor)
    for (let k = 0; ; k++) {
      const s = shiftDate(first, 42 * k)
      if (s > input.until) break
      if (k === 0 || input.maintenanceEnabled) starts.add(s)
      if (!input.maintenanceEnabled) break
    }
  }
  let previous = shiftDate(input.from, -1)
  for (const d of input.completeDates) {
    if (d > input.until) break
    if (dayDiff(previous, d) > RESTART_GAP_DAYS) starts.add(d)
    previous = d
  }
  return [...starts].sort()
}

// Um dia da fase de água para o gasto medido.
export function waterForTdee(
  date: string,
  starts: string[],
  anchor: string | null,
  maintenanceEnabled: boolean,
): boolean {
  if (maintenanceEnabled && anchor && isMaintenanceWeek(anchor, date)) return true
  return starts.some((s) => {
    const d = dayDiff(s, date)
    return d >= 0 && d < TDEE_WATER_DAYS
  })
}

// Os limites do gasto medido: até haver 6 semanas de dias completos fora da
// fase de água, entre −15 % e +15 % da fórmula (mais o treino médio); depois,
// a 400 da fórmula mais o treino, como antes.
export function measuredBounds(formula: number, avgTraining: number, stable: boolean): { lo: number; hi: number } {
  if (stable) {
    const reference = formula + avgTraining
    return { lo: reference - MEASURED_MAX_GAP_KCAL, hi: reference + MEASURED_MAX_GAP_KCAL }
  }
  return {
    lo: Math.round(formula * (1 - EARLY_CAP_FRACTION) + avgTraining),
    hi: Math.round(formula * (1 + EARLY_CAP_FRACTION) + avgTraining),
  }
}

export interface AdaptiveDay extends ClosedDay {
  kcal_exercise?: number | null
  formula_base?: number | null
}

// «teto»/«piso»: limitado a ±15 % da fórmula (primeiras 6 semanas);
// «teto400»/«piso400»: depois disso, a ±400 da fórmula (decisão 175, K4: a
// marca fica à vista em vez de se esconder); «ritmo»: 100 kcal por semana.
export type AdaptiveLimit = MeasuredLimit | 'teto400' | 'piso400'

export interface AdaptiveResult {
  raw: number | null
  tdee: number | null
  excluded: boolean
  stable: boolean
  limit: AdaptiveLimit | null
  eligibleDays: number
  missingWeighings: number // pesagens que faltam na janela para medir (0 = chegam)
}

// A janela do gasto medido num dia: os últimos 28 dias completos fora da
// fase de água dentro de 56 dias (`rows`: dias completos, por ordem). Serve
// também à base sem treino (K3), que tira o treino médio desta mesma janela.
export function tdeeWindow(input: {
  date: string
  rows: AdaptiveDay[]
  anchor: string | null
  maintenanceEnabled: boolean
}): { rows: AdaptiveDay[]; eligibleAll: AdaptiveDay[]; window: AdaptiveDay[]; isWater: (d: string) => boolean } {
  const from = shiftDate(input.date, -TDEE_LOOKBACK_DAYS)
  const rows = input.rows.filter((r) => r.date >= from && r.date <= input.date)
  const starts = dietStarts({
    anchor: input.anchor,
    maintenanceEnabled: input.maintenanceEnabled,
    completeDates: rows.map((r) => r.date),
    from,
    until: input.date,
  })
  const isWater = (d: string) => waterForTdee(d, starts, input.anchor, input.maintenanceEnabled)
  const eligibleAll = rows.filter((r) => !isWater(r.date))
  const windowFrom = shiftDate(input.date, -TDEE_WINDOW_CALENDAR_DAYS)
  const window = eligibleAll.filter((r) => r.date > windowFrom).slice(-TDEE_WINDOW_DAYS)
  return { rows, eligibleAll, window, isWater }
}

// O treino médio por dia numa janela (ou, vazia, nos dias de reserva).
export function windowTraining(window: AdaptiveDay[], fallback: AdaptiveDay[] = []): number {
  const basis = window.length ? window : fallback
  return basis.length ? basis.reduce((a, d) => a + Number(d.kcal_exercise ?? 0), 0) / basis.length : 0
}

// O gasto medido de um dia fechado, a partir dos dias completos dos últimos
// 120 dias (`rows`, por ordem, este incluído se completo) e das pesagens
// reais (`weighings`, K1): a janela são os últimos 28 dias completos fora da
// fase de água dentro de 56 dias; a descida do peso mede-se entre as
// pesagens dessa janela, por troços, sem atravessar uma fase de água, e só
// com 4 dias de pesagem a cobrir 10 dias ou mais.
export function adaptiveDay(input: {
  date: string
  complete: boolean
  rows: AdaptiveDay[]
  weighings: Weighing[]
  anchor: string | null
  maintenanceEnabled: boolean
  previous: number | null
  weekStart: number | null
}): AdaptiveResult {
  const { rows, eligibleAll, window, isWater } = tdeeWindow(input)
  const breaks = (a: string, b: string) => {
    for (let d = shiftDate(a, 1); d < b; d = shiftDate(d, 1)) if (isWater(d)) return true
    return false
  }
  const weighFrom = window[0]?.date ?? input.date
  const weighings = input.weighings.filter((w) => w.date >= weighFrom && w.date <= input.date && !isWater(w.date))
  const missing = missingWeighings(weighings.map((w) => w.date))
  const raw = tdeeRaw(window, { minDays: TDEE_MIN_ELIGIBLE_DAYS, breaks, weighings })
  const stable = eligibleAll.length >= STABLE_ELIGIBLE_DAYS
  const basis = window.length ? window : rows
  const formula = [...basis].reverse().find((d) => d.formula_base != null)?.formula_base
  const avgTraining = windowTraining(window, rows)
  const reference = formula != null ? Number(formula) + avgTraining : null
  const bounds = formula != null ? measuredBounds(Number(formula), avgTraining, stable) : null
  const excluded = isWater(input.date)
  const { value, limit } = dayTdee({
    complete: input.complete,
    excluded,
    previous: input.previous,
    raw,
    reference,
    bounds,
    weekStart: input.weekStart,
  })
  // Com 6 semanas de dados o limite é o de sempre (400), e fica dito como tal.
  const shown: AdaptiveLimit | null = stable && limit === 'teto' ? 'teto400' : stable && limit === 'piso' ? 'piso400' : limit
  return { raw, tdee: value, excluded, stable, limit: shown, eligibleDays: window.length, missingWeighings: missing }
}
