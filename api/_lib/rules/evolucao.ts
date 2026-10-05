// Análise da evolução pela IA (Corpo › Evolução): o resumo dos dados que vai
// para o modelo e a limpeza do que ele devolve. Sem supabase nem node.
import { shiftDate } from './nutritional-day.js'
import { trend7, weeklyRate } from './weight.js'
import { cleanWellness, type WellnessRow } from './plano.js'

export const AREAS = ['peso', 'medidas', 'comida', 'treino', 'sono', 'coracao', 'passos'] as const
export const ESTADOS = ['melhor', 'igual', 'pior', 'sem_dados'] as const
export type Area = (typeof AREAS)[number]
export type Estado = (typeof ESTADOS)[number]

export const AREA_LABEL: Record<Area, string> = {
  peso: 'Peso',
  medidas: 'Medidas',
  comida: 'Comida',
  treino: 'Treino',
  sono: 'Sono',
  coracao: 'FC em repouso',
  passos: 'Passos',
}

export interface Analysis {
  titulo: string
  resumo: string
  areas: { area: Area; estado: Exclude<Estado, 'sem_dados'>; texto: string }[]
  foco: string[]
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const round1 = (n: number) => Math.round(n * 10) / 10
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)

// A resposta da IA, arrumada: só áreas conhecidas, uma vez cada, pela ordem
// fixa; as «sem dados» e as vazias saem (não se mostra o que vem vazio).
export function cleanAnalysis(raw: unknown): Analysis {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = new Map<Area, Analysis['areas'][number]>()
  for (const item of Array.isArray(r.areas) ? r.areas : []) {
    const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const area = AREAS.find((x) => x === a.area)
    const estado = ESTADOS.find((x) => x === a.estado)
    const texto = text(a.texto, 400)
    if (!area || !estado || estado === 'sem_dados' || !texto || seen.has(area)) continue
    seen.set(area, { area, estado, texto })
  }
  return {
    titulo: text(r.titulo, 120),
    resumo: text(r.resumo, 600),
    areas: AREAS.filter((a) => seen.has(a)).map((a) => seen.get(a)!),
    foco: (Array.isArray(r.foco) ? r.foco : [])
      .map((f) => text(f, 240))
      .filter(Boolean)
      .slice(0, 3),
  }
}

// O peso: o último, a média de 7 dias hoje, há 30 e há 90 dias, e o ritmo.
export function weightSummary(weights: { date: string; kg: number }[], today: string) {
  const series = weights.filter((w) => w.date <= today).map((w) => ({ date: w.date, value: Number(w.kg) }))
  if (series.length === 0) return null
  const trend = trend7(series)
  const at = (date: string) => {
    const before = trend.filter((p) => p.date <= date)
    const last = before[before.length - 1]
    // Só vale se houver pesagem perto dessa data (até 7 dias antes).
    return last && last.date >= shiftDate(date, -7) ? last.value : null
  }
  const last = series[series.length - 1]!
  return {
    ultimo: { data: last.date, kg: last.value },
    media_7_dias: { hoje: at(today), ha_30_dias: at(shiftDate(today, -30)), ha_90_dias: at(shiftDate(today, -90)) },
    ritmo_kg_semana: weeklyRate(series),
    pesagens_90_dias: series.filter((w) => w.date > shiftDate(today, -90)).length,
  }
}

// A comida, semana a semana (4 semanas), só com os dias completos.
export interface FoodDay {
  date: string
  kcal_in: number | null
  protein: number | null
  kcal_target: number | null
  kcal_out_est?: number | null
  is_complete: boolean
}
export function foodWeeks(days: FoodDay[], today: string) {
  return [3, 2, 1, 0].map((k) => {
    const end = shiftDate(today, -7 * k - 1)
    const start = shiftDate(end, -6)
    const week = days.filter((d) => d.is_complete && d.date >= start && d.date <= end)
    const avg = (key: keyof FoodDay) => {
      const m = mean(week.map((d) => d[key]).filter((v): v is number => typeof v === 'number').map(Number))
      return m == null ? null : Math.round(m)
    }
    return {
      de: start,
      a: end,
      dias_completos: week.length,
      comeu_kcal: avg('kcal_in'),
      alvo_kcal: avg('kcal_target'),
      proteina_g: avg('protein'),
      gasto_estimado_kcal: avg('kcal_out_est'),
    }
  })
}

// O relógio: os últimos 30 dias contra os 30 antes (FC em repouso só com
// noite registada; os passos sem hoje, que ainda vai a meio).
export function wellnessMonths(all: WellnessRow[], today: string) {
  const rows = cleanWellness(all)
  const block = (from: string, to: string) => {
    const inRange = rows.filter((r) => r.date >= from && r.date <= to)
    const avg = (key: Exclude<keyof WellnessRow, 'date'>, digits = 0) => {
      const m = mean(inRange.map((r) => r[key]).filter((v): v is number => typeof v === 'number'))
      return m == null ? null : digits ? round1(m) : Math.round(m)
    }
    return {
      dias_com_dados: inRange.length,
      passos: avg('steps'),
      sono_minutos: avg('sleep_minutes'),
      sono_pontuacao: avg('sleep_score'),
      sono_qualidade: avg('sleep_quality', 1),
      fc_repouso: avg('resting_hr'),
      hrv: avg('hrv'),
    }
  }
  const yesterday = shiftDate(today, -1)
  return {
    ultimos_30_dias: block(shiftDate(yesterday, -29), yesterday),
    os_30_antes: block(shiftDate(yesterday, -59), shiftDate(yesterday, -30)),
  }
}
