// Ciclo menstrual (opcional, só para mulheres): datas de início guardadas em
// profile.goals.ciclo. Serve para explicar o peso — na semana antes do
// período é normal subir 0,5–2 kg de água — e não para previsões médicas.
import { shiftDate } from './nutritional-day.js'

export const DEFAULT_CYCLE_DAYS = 28
const MIN_CYCLE = 21
const MAX_CYCLE = 40

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export type CyclePhase = 'menstrual' | 'folicular' | 'ovulacao' | 'lutea'

export interface CycleInfo {
  lastStart: string
  dayOfCycle: number // 1 = primeiro dia do período
  length: number // duração média (mediana das últimas 6), 28 sem histórico
  nextStart: string
  daysToNext: number
  phase: CyclePhase
  waterWeek: boolean // até 7 dias antes do próximo, ou nos 3 primeiros dias
}

export function cleanStarts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
}

export function cycleInfo(starts: string[], today: string): CycleInfo | null {
  const past = cleanStarts(starts).filter((d) => d <= today)
  const lastStart = past[past.length - 1]
  if (!lastStart) return null
  const gaps = past
    .slice(1)
    .map((d, i) => dayDiff(past[i]!, d))
    .filter((g) => g >= MIN_CYCLE && g <= MAX_CYCLE)
    .slice(-6)
    .sort((a, b) => a - b)
  const length = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : DEFAULT_CYCLE_DAYS
  const dayOfCycle = dayDiff(lastStart, today) + 1
  // Se já passou da data prevista, o próximo é «a qualquer momento» (hoje).
  const nextStart = dayOfCycle > length ? today : shiftDate(lastStart, length)
  const daysToNext = dayDiff(today, nextStart)
  const ovulation = length - 14
  const phase: CyclePhase =
    dayOfCycle <= 5 ? 'menstrual' : Math.abs(dayOfCycle - ovulation) <= 1 ? 'ovulacao' : dayOfCycle < ovulation ? 'folicular' : 'lutea'
  return { lastStart, dayOfCycle, length, nextStart, daysToNext, phase, waterWeek: daysToNext <= 7 || dayOfCycle <= 3 }
}

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: 'período',
  folicular: 'fase folicular',
  ovulacao: 'ovulação',
  lutea: 'fase lútea',
}
