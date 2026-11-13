// Arquivado (L5): a parte de rules/plano.ts que só servia o plano semanal
// com IA. Fica só para consulta; está fora de api/, do tsconfig e do vitest.
import { mondayOf } from '../../api/_lib/rules/manutencao.js'
import { shiftDate } from '../../api/_lib/rules/nutritional-day.js'
import { mergeSessions } from '../../api/_lib/rules/sessoes.js'
import { cleanWellness, type PlanPrefs, type PlanWorkout, type WellnessRow } from '../../api/_lib/rules/plano.js'

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  return Math.min(max, Math.max(min, n))
}
const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null

// Semana 1 é a do início; nunca antes de 1.
export function weekNumber(inicio: string, weekStart: string): number {
  const days = (Date.parse(`${mondayOf(weekStart)}T00:00:00Z`) - Date.parse(`${mondayOf(inicio)}T00:00:00Z`)) / 86_400_000
  return Math.max(1, Math.floor(days / 7) + 1)
}

// Uma semana em cada quatro é mais leve (descarga).
export function isDeloadWeek(week: number): boolean {
  return week % 4 === 0
}

export interface WellnessTrend {
  hrv7: number | null
  hrv28: number | null
  rhr7: number | null
  rhr28: number | null
  sleepScore7: number | null
  sleepScore28: number | null
  sleepQuality7: number | null // média 1–4 (com uma casa decimal)
  sleepMinutes7: number | null
  steps7: number | null
  steps28: number | null
}

// Média dos últimos 7 dias contra a dos últimos 28 (até `today`).
export function wellnessTrend(all: WellnessRow[], today: string): WellnessTrend {
  const rows = cleanWellness(all)
  const since = (days: number) => rows.filter((r) => r.date > shiftDate(today, -days) && r.date <= today)
  const values = (list: WellnessRow[], key: keyof WellnessRow) =>
    list.map((r) => r[key]).filter((v): v is number => typeof v === 'number')
  const pick = (list: WellnessRow[], key: keyof WellnessRow) => mean(values(list, key))
  const w7 = since(7)
  const w28 = since(28)
  // Passos: hoje ainda vai a meio, contam os 7 e 28 dias completos antes.
  const full = (days: number) =>
    rows.filter((r) => r.date > shiftDate(today, -days - 1) && r.date < today)
  const quality = values(w7, 'sleep_quality')
  return {
    hrv7: pick(w7, 'hrv'),
    hrv28: pick(w28, 'hrv'),
    rhr7: pick(w7, 'resting_hr'),
    rhr28: pick(w28, 'resting_hr'),
    sleepScore7: pick(w7, 'sleep_score'),
    sleepScore28: pick(w28, 'sleep_score'),
    sleepQuality7: quality.length ? Math.round((quality.reduce((a, b) => a + b, 0) / quality.length) * 10) / 10 : null,
    sleepMinutes7: pick(w7, 'sleep_minutes'),
    steps7: pick(full(7), 'steps'),
    steps28: pick(full(28), 'steps'),
  }
}

// O plano da semana, como a IA o devolve (e como fica guardado).
export const BIKE_KINDS = ['resistencia', 'tempo', 'limiar', 'intervalos', 'recuperacao', 'forca', 'teste'] as const
export const GYM_FOCUS = ['corpo_inteiro', 'superior', 'inferior', 'empurrar', 'puxar', 'pernas', 'core'] as const

export const BIKE_KIND_LABEL: Record<(typeof BIKE_KINDS)[number], string> = {
  resistencia: 'Resistência',
  tempo: 'Tempo',
  limiar: 'Limiar',
  intervalos: 'Intervalos',
  recuperacao: 'Recuperação',
  forca: 'Força (cadência baixa)',
  teste: 'Teste',
}

export const GYM_FOCUS_LABEL: Record<(typeof GYM_FOCUS)[number], string> = {
  corpo_inteiro: 'Corpo inteiro',
  superior: 'Parte de cima',
  inferior: 'Parte de baixo',
  empurrar: 'Empurrar (peito, ombros, tríceps)',
  puxar: 'Puxar (costas, bíceps)',
  pernas: 'Pernas e glúteos',
  core: 'Core',
}

export interface BikeSession {
  titulo: string
  tipo: (typeof BIKE_KINDS)[number]
  minutos: number
  alvo: string
  estrutura: string
  porque: string
}

export interface GymSession {
  titulo: string
  foco: (typeof GYM_FOCUS)[number]
  minutos: number
  nota: string
}

export interface WeekPlan {
  kind: 'semana'
  semana: number
  fase: string
  resumo: string
  evolucao: string
  bicicleta: BikeSession[]
  ginasio: GymSession[]
}

const text = (v: unknown, max: number, fallback = '') =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : fallback

// O que vem da IA (ou da base de dados) fica sempre com a forma certa e com
// o número de sessões pedido (no máximo; a IA pode propor menos).
export function cleanPlan(raw: unknown, prefs: Pick<PlanPrefs, 'bicicleta' | 'ginasio'>, week: number): WeekPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []) as Record<string, unknown>[]
  const bicicleta = list(r.bicicleta)
    .slice(0, prefs.bicicleta)
    .map((b) => ({
      titulo: text(b.titulo, 60, 'Bicicleta'),
      tipo: (BIKE_KINDS as readonly string[]).includes(b.tipo as string) ? (b.tipo as BikeSession['tipo']) : 'resistencia',
      minutos: clampInt(b.minutos, 10, 240, 45),
      alvo: text(b.alvo, 120),
      estrutura: text(b.estrutura, 240),
      porque: text(b.porque, 200),
    }))
  const ginasio = list(r.ginasio)
    .slice(0, prefs.ginasio)
    .map((g) => ({
      titulo: text(g.titulo, 60, 'Ginásio'),
      foco: (GYM_FOCUS as readonly string[]).includes(g.foco as string) ? (g.foco as GymSession['foco']) : 'corpo_inteiro',
      minutos: clampInt(g.minutos, 15, 150, 45),
      nota: text(g.nota, 240),
    }))
  return {
    kind: 'semana',
    semana: week,
    fase: text(r.fase, 40, isDeloadWeek(week) ? 'Descarga' : 'Base'),
    resumo: text(r.resumo, 400),
    evolucao: text(r.evolucao, 400),
    bicicleta,
    ginasio,
  }
}

// O que já foi feito da semana: os treinos de cada tipo, por ordem, vão
// riscando as sessões do plano pela ordem em que estão.
export function planProgress<T extends PlanWorkout>(
  plan: Pick<WeekPlan, 'bicicleta' | 'ginasio'>,
  weekWorkouts: T[],
): { bike: (T | null)[]; gym: (T | null)[] } {
  // Por ordem de início, com as partes seguidas de um treino juntas (os
  // minutos passam a ser os do treino todo).
  const sorted = mergeSessions(weekWorkouts)
  const bikes = sorted.filter((w) => w.type === 'bike')
  const gyms = sorted.filter((w) => w.type === 'strength')
  return {
    bike: plan.bicicleta.map((_, i) => bikes[i] ?? null),
    gym: plan.ginasio.map((_, i) => gyms[i] ?? null),
  }
}
