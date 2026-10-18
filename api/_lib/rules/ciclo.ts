// Ciclo menstrual (opcional, só para mulheres): datas de início guardadas em
// profile.goals.ciclo. Serve para explicar o peso — na semana antes do
// período é normal subir 0,5–2 kg de água — e não para previsões médicas.
// Com pílula (goals.ciclo_pilula) não há ovulação nem fases: o «período» é a
// hemorragia da pausa, de 28 dias ou de ~3 meses (pílula contínua, 91 dias).
import { shiftDate } from './nutritional-day.js'

export const DEFAULT_CYCLE_DAYS = 28
const MIN_CYCLE = 21
const MAX_CYCLE = 100

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export type CyclePhase = 'menstrual' | 'folicular' | 'ovulacao' | 'lutea' | 'pilula'

export interface CycleInfo {
  lastStart: string
  dayOfCycle: number // 1 = primeiro dia do período
  length: number // duração média (mediana das últimas 6), a escolhida sem histórico
  nextStart: string
  daysToNext: number
  phase: CyclePhase
  daysLate: number // dias depois da data prevista (0 = ainda não passou)
  overdue: boolean // mais de LATE_WATER_DAYS de atraso: provavelmente faltou marcar
  waterWeek: boolean // até 7 dias antes do próximo (e até 7 de atraso), ou nos 3 primeiros dias
}

// Uma semana de atraso ainda conta como semana de água. Depois disso a app já
// não sabe em que dia está (o mais provável é ter faltado marcar o início) e
// deixa de desculpar o peso com água — também na pílula de 3 em 3 meses.
export const LATE_WATER_DAYS = 7

export function cleanStarts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
}

export interface CycleOptions {
  pill?: boolean // pílula: sem fases
  defaultLength?: number // sem histórico: 28, ou 91 com a pílula contínua
}

export function cycleOptions(goals: Record<string, unknown> | null | undefined): CycleOptions {
  const days = Number(goals?.ciclo_dias)
  return {
    pill: goals?.ciclo_pilula === true,
    defaultLength: Number.isFinite(days) && days >= MIN_CYCLE && days <= MAX_CYCLE ? days : DEFAULT_CYCLE_DAYS,
  }
}

export function cycleInfo(starts: string[], today: string, options: CycleOptions = {}): CycleInfo | null {
  const past = cleanStarts(starts).filter((d) => d <= today)
  const lastStart = past[past.length - 1]
  if (!lastStart) return null
  const gaps = past
    .slice(1)
    .map((d, i) => dayDiff(past[i]!, d))
    .filter((g) => g >= MIN_CYCLE && g <= MAX_CYCLE)
    .slice(-6)
    .sort((a, b) => a - b)
  const length = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : (options.defaultLength ?? DEFAULT_CYCLE_DAYS)
  const dayOfCycle = dayDiff(lastStart, today) + 1
  // Se já passou da data prevista, o próximo é «a qualquer momento» (hoje).
  const nextStart = dayOfCycle > length ? today : shiftDate(lastStart, length)
  const daysToNext = dayDiff(today, nextStart)
  const daysLate = Math.max(0, dayOfCycle - 1 - length)
  const overdue = daysLate > LATE_WATER_DAYS
  const ovulation = length - 14
  const phase: CyclePhase =
    dayOfCycle <= 5 ? 'menstrual' : options.pill ? 'pilula' : Math.abs(dayOfCycle - ovulation) <= 1 ? 'ovulacao' : dayOfCycle < ovulation ? 'folicular' : 'lutea'
  return {
    lastStart,
    dayOfCycle,
    length,
    nextStart,
    daysToNext,
    phase,
    daysLate,
    overdue,
    waterWeek: (daysToNext <= 7 && !overdue) || dayOfCycle <= 3,
  }
}

// Algum dia de [from, to] na semana de água: o Balanço, a Conta da gordura e
// o resumo da semana não leem essa subida como gordura nem como comida por
// registar. Só para mulheres com o ciclo marcado.
export function waterWeekDuring(
  profile: { sex?: string | null; goals?: Record<string, unknown> | null },
  from: string,
  to: string,
): boolean {
  if (profile.sex !== 'f') return false
  const starts = cleanStarts(profile.goals?.ciclo)
  if (starts.length === 0) return false
  const options = cycleOptions(profile.goals)
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    if (cycleInfo(starts, d, options)?.waterWeek) return true
  }
  return false
}

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'período',
  folicular: 'fase folicular',
  ovulacao: 'ovulação',
  lutea: 'fase lútea',
  pilula: 'com pílula',
}
