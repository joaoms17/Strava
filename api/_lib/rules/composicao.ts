// Fase 4 — composição corporal pela fita (método da Marinha dos EUA,
// Hodgdon & Beckett, versão métrica para homens). A gordura e a massa magra
// calculam-se sempre a partir da medição guardada (weight_used_kg) e nunca se
// projetam entre medições. Sem imports: o telemóvel usa as mesmas funções.

export type Zone = 'neck' | 'waist' | 'chest' | 'hips' | 'arm' | 'thigh' | 'calf'

// A única constante de limites: validação no telemóvel e plausibilidade.
export const LIMITS = {
  neck: [25, 60],
  waist: [50, 180],
  chest: [60, 180],
  hips: [60, 180],
  arm: [15, 60],
  thigh: [30, 100],
  calf: [20, 60],
  bodyFatPct: [5, 45],
} as const

export const ZONE_LABEL: Record<Zone, string> = {
  neck: 'Pescoço',
  waist: 'Cintura',
  chest: 'Peito',
  hips: 'Anca',
  arm: 'Braço',
  thigh: 'Coxa',
  calf: 'Gémeo',
}

export const METHOD_ERROR_PP = 4 // erro típico do método (±)
export const DETECTABLE_CHANGE_PP = 1.5 // mínima mudança detetável com 1 leitura
export const LEAN_STABLE_KG = 0.5
export const THIRD_READING_CM = 1
export const REFERENCE_WINDOW_DAYS = 7

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// D = 1,0324 − 0,19077 × log10(cintura − pescoço) + 0,15456 × log10(altura)
// %G = 495 / D − 450. Só vale com a cintura maior do que o pescoço.
export function navyBodyFat(heightCm: number, neckCm: number, waistCm: number): number | null {
  if (!(waistCm > neckCm) || !(heightCm > 0)) return null
  const density = 1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)
  return 495 / density - 450
}

// Versão em polegadas, só para verificar a métrica nos testes.
export function navyBodyFatInches(heightCm: number, neckCm: number, waistCm: number): number | null {
  if (!(waistCm > neckCm)) return null
  const inch = (cm: number) => cm / 2.54
  return 86.01 * Math.log10(inch(waistCm) - inch(neckCm)) - 70.041 * Math.log10(inch(heightCm)) + 36.76
}

export function isPlausible(pct: number | null): boolean {
  return pct != null && pct >= LIMITS.bodyFatPct[0] && pct <= LIMITS.bodyFatPct[1]
}

export function roundHalf(kg: number): number {
  return Math.round(kg * 2) / 2
}

export interface Composition {
  pct: number // exato
  fatKg: number
  leanKg: number
  // Como aparece no ecrã: %G inteiro, kg a 0,5.
  shown: { pct: number; fatKg: number; leanKg: number }
  range: { pct: [number, number]; fatKg: [number, number] }
}

export function composition(
  heightCm: number,
  m: { neck_cm: number; waist_cm: number; weight_used_kg: number },
): Composition | null {
  const pct = navyBodyFat(heightCm, m.neck_cm, m.waist_cm)
  if (pct == null) return null
  const fatKg = (m.weight_used_kg * pct) / 100
  const leanKg = m.weight_used_kg - fatKg
  const low = Math.max(0, pct - METHOD_ERROR_PP)
  const high = pct + METHOD_ERROR_PP
  return {
    pct,
    fatKg,
    leanKg,
    shown: { pct: Math.round(pct), fatKg: roundHalf(fatKg), leanKg: roundHalf(leanKg) },
    range: {
      pct: [Math.round(low), Math.round(high)],
      fatKg: [round1((m.weight_used_kg * low) / 100), round1((m.weight_used_kg * high) / 100)],
    },
  }
}

// Diferenças a partir dos valores já arredondados, para o texto bater certo
// com os números mostrados; a confirmação usa a %G exata.
export interface CompositionChange {
  fatKg: number // mostrado (negativo = menos)
  leanKg: number
  leanStable: boolean
  confirmed: boolean
  pctExact: number
}

export function compareCompositions(before: Composition, after: Composition): CompositionChange {
  const leanKg = after.shown.leanKg - before.shown.leanKg
  const pctExact = after.pct - before.pct
  return {
    fatKg: after.shown.fatKg - before.shown.fatKg,
    leanKg,
    leanStable: Math.abs(leanKg) <= LEAN_STABLE_KG,
    confirmed: Math.abs(pctExact) >= DETECTABLE_CHANGE_PP,
    pctExact,
  }
}

function fmtKg(kg: number): string {
  const abs = Math.abs(kg)
  return Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',')
}

// «cerca de 2 kg de gordura a menos, massa magra estável»
export function changeSentence(change: CompositionChange): string {
  const fat =
    change.fatKg === 0
      ? 'gordura estável'
      : `cerca de ${fmtKg(change.fatKg)} kg de gordura ${change.fatKg < 0 ? 'a menos' : 'a mais'}`
  const lean = change.leanStable
    ? 'massa magra estável'
    : `massa magra ${change.leanKg < 0 ? 'a descer' : 'a subir'} ${fmtKg(change.leanKg)} kg`
  return `${fat}, ${lean}`
}

export function confirmationSentence(change: CompositionChange): string {
  if (!change.confirmed) return 'ainda dentro da margem da fita, confirma na próxima medição'
  return change.pctExact < 0 ? 'a fita já confirma esta descida' : 'a fita já confirma esta subida'
}

// Cintura para uma %G alvo, com o mesmo pescoço e altura.
export function targetWaist(heightCm: number, neckCm: number, targetPct: number): number {
  const density = 495 / (targetPct + 450)
  return neckCm + 10 ** ((1.0324 + 0.15456 * Math.log10(heightCm) - density) / 0.19077)
}

// Peso usado numa medição: média das pesagens nos 7 dias até esse dia
// (a mesma janela do peso médio). Sem pesagens, null: a folha pede o peso.
export function referenceWeight(weights: { date: string; kg: number }[], date: string): number | null {
  const day = Date.parse(`${date}T00:00:00Z`)
  const window = weights.filter((w) => {
    const d = Date.parse(`${w.date}T00:00:00Z`)
    return d <= day && d > day - REFERENCE_WINDOW_DAYS * 86_400_000
  })
  if (!window.length) return null
  return Math.round((window.reduce((a, w) => a + w.kg, 0) / window.length) * 100) / 100
}

// Média das leituras de uma zona (1, 2 ou 3), a 0,1 cm.
export function averageReadings(readings: number[]): number | null {
  const valid = readings.filter((r) => Number.isFinite(r) && r > 0)
  if (!valid.length) return null
  return round1(valid.reduce((a, r) => a + r, 0) / valid.length)
}

export function needsThirdReading(first: number | null, second: number | null): boolean {
  return first != null && second != null && Math.abs(first - second) > THIRD_READING_CM
}

// Texto simples quando um valor parece errado (nunca um erro técnico).
export function checkZone(zone: Zone, cm: number): string | null {
  const [min, max] = LIMITS[zone]
  if (cm < min) return `${fmtKg(cm)} cm ${zone === 'waist' ? 'na cintura' : `em ${ZONE_LABEL[zone].toLowerCase()}`}? Parece pouco. Confirma.`
  if (cm > max) return `${fmtKg(cm)} cm ${zone === 'waist' ? 'na cintura' : `em ${ZONE_LABEL[zone].toLowerCase()}`}? Parece muito. Confirma.`
  return null
}

export type MeasureFlag = 'pausa_dieta' | 'depois_jantar_fora' | 'plausibilidade' | 'pescoco_mudou' | 'cintura_mudou'

export const FLAG_TEXT: Record<MeasureFlag, string> = {
  pausa_dieta: 'Estás na semana de pausa da dieta: a cintura pode estar um pouco maior.',
  depois_jantar_fora: 'Ontem jantaste fora: o sal e a comida podem inchar a cintura esta manhã.',
  plausibilidade: 'A gordura estimada está fora do habitual (5–45 %). Verifica as medidas.',
  pescoco_mudou: 'O pescoço mudou mais de 1,5 cm desde a última vez. Confirma o sítio da fita.',
  cintura_mudou: 'A cintura mudou mais de 3 cm em 14 dias. Confirma a medida.',
}

// Avisos que não bloqueiam; a medição fica marcada com eles.
export function measureFlags(input: {
  pct: number | null
  neck: number
  waist: number
  previous: { date: string; neck_cm: number | null; waist_cm: number | null } | null
  date: string
  maintenance: boolean
  dinnerOutYesterday: boolean
}): MeasureFlag[] {
  const flags: MeasureFlag[] = []
  if (input.maintenance) flags.push('pausa_dieta')
  if (input.dinnerOutYesterday) flags.push('depois_jantar_fora')
  if (input.pct != null && !isPlausible(input.pct)) flags.push('plausibilidade')
  const prev = input.previous
  if (prev?.neck_cm != null && Math.abs(input.neck - prev.neck_cm) > 1.5) flags.push('pescoco_mudou')
  if (prev?.waist_cm != null) {
    const days = (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / 86_400_000
    if (days <= 14 && Math.abs(input.waist - prev.waist_cm) > 3) flags.push('cintura_mudou')
  }
  return flags
}

// Dias desde a última medição (null = nunca mediu).
export function daysSinceMeasure(lastDate: string | null, today: string): number | null {
  if (!lastDate) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000)
}

// Primeiras 3 semanas de dieta: a massa magra desce por água e glicogénio.
export function earlyDietWeeks(dietStart: string | null, today: string): boolean {
  const days = daysSinceMeasure(dietStart, today)
  return days != null && days >= 0 && days < 21
}

// Balança de bioimpedância: série à parte, suavizada (EWMA α 0,1).
export function scaleFatAverage(values: number[], alpha = 0.1): number | null {
  if (!values.length) return null
  let avg = values[0]!
  for (const v of values.slice(1)) avg = avg + alpha * (v - avg)
  return round1(avg)
}
