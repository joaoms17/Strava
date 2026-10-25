// Gráficos do Corpo e do Balanço: as contas puras partilhadas (o período
// escolhido, eixos com poucos números redondos, datas no eixo, rótulos que
// nunca se sobrepõem, médias por semana e extremos). Sem supabase nem node:
// o telemóvel corre tudo isto.
import { shiftDate } from './nutritional-day.js'
import { mondayOf } from './manutencao.js'

// --- Período (um para a página toda) -------------------------------------

export type Period = '1M' | '3M' | 'Tudo'
export const PERIODS: Period[] = ['1M', '3M', 'Tudo']
export const PERIOD_DAYS = { '1M': 30, '3M': 91 } as const
export const PERIOD_LABEL: Record<Period, string> = { '1M': '1 mês', '3M': '3 meses', Tudo: 'Tudo' }
export const DEFAULT_PERIOD: Period = '3M'

// O que vem do armazenamento do telemóvel (pode vir estragado ou vazio).
export function cleanPeriod(raw: unknown): Period {
  return raw === '1M' || raw === '3M' || raw === 'Tudo' ? raw : DEFAULT_PERIOD
}

// O primeiro dia do período. 1M e 3M nunca começam antes do primeiro
// registo (uma conta nova não fica com o gráfico vazio à esquerda); «Tudo»
// começa no primeiro registo.
export function periodFrom(period: Period, today: string, first: string | null): string {
  if (period === 'Tudo') return first != null && first < today ? first : shiftDate(today, -(PERIOD_DAYS['3M'] - 1))
  const from = shiftDate(today, -(PERIOD_DAYS[period] - 1))
  return first != null && first > from && first <= today ? first : from
}

// --- Datas como números (eixo do tempo contínuo) --------------------------

const DAY_MS = 86_400_000
export const dayNum = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
export const fromDayNum = (n: number): string => new Date(Math.round(n) * DAY_MS).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string): number => dayNum(b) - dayNum(a)

// --- Eixo dos valores: poucos números redondos ----------------------------

export interface NiceScale {
  domain: [number, number]
  ticks: number[]
  step: number
}

const STEPS = [1, 2, 2.5, 5]

// De `min` a `max`, com no máximo `maxTicks` marcas (contando as pontas), em
// passos de 1, 2, 2,5 ou 5 × 10ⁿ (2,5 só a partir de 25). `minSpan` evita um eixo de 0,1 kg quando
// os valores quase não mexem.
export function niceScale(min: number, max: number, maxTicks = 4, minSpan = 0): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1], step: 1 }
  if (min > max) [min, max] = [max, min]
  if (max - min < minSpan) {
    const mid = (min + max) / 2
    min = mid - minSpan / 2
    max = mid + minSpan / 2
  }
  if (max === min) {
    max = min + 1
  }
  const target = Math.max(2, maxTicks)
  const raw = (max - min) / (target - 1)
  let power = Math.pow(10, Math.floor(Math.log10(raw)))
  for (let guard = 0; guard < 40; guard++) {
    for (const s of STEPS) {
      // 2,5 só a partir das dezenas (25, 250…): sem casas decimais no eixo.
      if (s === 2.5 && power < 10) continue
      const step = s * power
      const lo = Math.floor(min / step + 1e-9) * step
      const hi = Math.ceil(max / step - 1e-9) * step
      const count = Math.round((hi - lo) / step) + 1
      if (count <= target) {
        const ticks = Array.from({ length: count }, (_, i) => round(lo + i * step))
        return { domain: [round(lo), round(hi)], ticks, step }
      }
    }
    power *= 10
  }
  return { domain: [min, max], ticks: [min, max], step: max - min }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

// --- Eixo do tempo: poucas datas, em sítios que fazem sentido -------------

export interface DateTicks {
  ticks: string[]
  kind: 'day' | 'month'
}

// Até `max` marcas entre `from` e `to`: dias seguidos, segundas-feiras de 1
// ou 2 em 2 semanas, ou o dia 1 dos meses (de 1, 2, 3 ou 6 em 6).
export function dateTicks(from: string, to: string, max = 4): DateTicks {
  const span = daysBetween(from, to)
  const inside = (d: string) => d >= from && d <= to
  const fits = (list: string[]) => list.length >= 2 && list.length <= max
  if (span <= 0) return { ticks: [from], kind: 'day' }
  for (const step of [1, 2, 3]) {
    if (span / step > max) continue
    const list: string[] = []
    for (let d = from; d <= to; d = shiftDate(d, step)) list.push(d)
    if (fits(list)) return { ticks: list, kind: 'day' }
  }
  for (const step of [7, 14]) {
    let first = mondayOf(from)
    if (first < from) first = shiftDate(first, 7)
    const list: string[] = []
    for (let d = first; d <= to; d = shiftDate(d, step)) list.push(d)
    if (fits(list)) return { ticks: list, kind: 'day' }
  }
  for (const step of [1, 2, 3, 6, 12]) {
    const list: string[] = []
    let y = Number(from.slice(0, 4))
    let m = Number(from.slice(5, 7))
    // Os meses alinham ao calendário (jan, mar, mai… de 2 em 2).
    for (let guard = 0; guard < 400; guard++) {
      const d = `${y}-${String(m).padStart(2, '0')}-01`
      if (d > to) break
      if (inside(d) && (m - 1) % step === 0) list.push(d)
      m++
      if (m > 12) {
        m = 1
        y++
      }
    }
    if (fits(list)) return { ticks: list, kind: 'month' }
  }
  return { ticks: [from, to], kind: 'day' }
}

// --- Rótulos que nunca se sobrepõem --------------------------------------

export interface Box {
  x: number // canto de cima à esquerda
  y: number
  w: number
  h: number
}

export interface LabelIn {
  id: string
  x: number // o ponto marcado (pixels)
  y: number
  w: number // tamanho do rótulo
  h: number
  priority: number // maior primeiro
  prefer?: 'above' | 'below'
}

export interface LabelOut extends Box {
  id: string
  hidden: boolean
}

const GAP = 6

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Coloca cada rótulo perto do seu ponto (por cima, por baixo, ao lado),
// dentro da área do gráfico e sem tocar nos já colocados nem nos pontos
// (`obstacles`). O que não cabe esconde-se (a dica e a tabela têm o valor).
export function placeLabels(items: LabelIn[], bounds: Box, obstacles: Box[] = []): LabelOut[] {
  const placed: Box[] = []
  const out = new Map<string, LabelOut>()
  const order = [...items].sort((a, b) => b.priority - a.priority)
  for (const it of order) {
    const above = { x: it.x - it.w / 2, y: it.y - GAP - it.h }
    const below = { x: it.x - it.w / 2, y: it.y + GAP }
    const candidates = [
      ...(it.prefer === 'below' ? [below, above] : [above, below]),
      { x: it.x + GAP, y: it.y - it.h - 2 },
      { x: it.x - GAP - it.w, y: it.y - it.h - 2 },
      { x: it.x + GAP, y: it.y + 2 },
      { x: it.x - GAP - it.w, y: it.y + 2 },
      { x: it.x + GAP + 2, y: it.y - it.h / 2 },
      { x: it.x - GAP - 2 - it.w, y: it.y - it.h / 2 },
    ]
    let chosen: Box | null = null
    for (const c of candidates) {
      // Encosta à margem em vez de sair do gráfico, sem se afastar do ponto.
      const x = Math.min(Math.max(c.x, bounds.x), bounds.x + bounds.w - it.w)
      const y = Math.min(Math.max(c.y, bounds.y), bounds.y + bounds.h - it.h)
      if (Math.abs(x - c.x) > it.w / 2 || Math.abs(y - c.y) > it.h / 2) continue
      const box = { x, y, w: it.w, h: it.h }
      if (placed.some((p) => overlaps(p, box)) || obstacles.some((o) => overlaps(o, box))) continue
      chosen = box
      break
    }
    if (chosen) placed.push(chosen)
    out.set(it.id, chosen ? { id: it.id, ...chosen, hidden: false } : { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, hidden: true })
  }
  return items.map((it) => out.get(it.id)!)
}

// Largura de um rótulo de 12 px (Barlow), para o colocar antes de o desenhar.
export function labelWidth(text: string, fontSize = 12): number {
  let w = 0
  for (const ch of text) w += /[\s  ]/.test(ch) ? 0.28 : /[,.·:]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.82 : /[A-Z]/.test(ch) ? 0.62 : 0.54
  return Math.ceil(w * fontSize) + 4
}

// --- Séries ----------------------------------------------------------------

export interface DatedValue {
  date: string
  value: number
}

// A média de cada semana (segunda a domingo), só com os dias que têm valor.
export function weekMeans(rows: DatedValue[]): { monday: string; value: number; n: number }[] {
  const weeks = new Map<string, number[]>()
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!Number.isFinite(r.value)) continue
    const m = mondayOf(r.date)
    const list = weeks.get(m) ?? []
    list.push(r.value)
    weeks.set(m, list)
  }
  return [...weeks].map(([monday, list]) => ({ monday, value: list.reduce((a, b) => a + b, 0) / list.length, n: list.length }))
}

// O mais baixo e o mais alto; num empate fica o mais recente.
export function lowest<T extends DatedValue>(points: T[]): T | null {
  return points.reduce<T | null>((best, p) => (best == null || p.value <= best.value ? p : best), null)
}

export function highest<T extends DatedValue>(points: T[]): T | null {
  return points.reduce<T | null>((best, p) => (best == null || p.value >= best.value ? p : best), null)
}

export function meanOf(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
