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

export const ZONE_COLUMN = {
  neck: 'neck_cm',
  waist: 'waist_cm',
  chest: 'chest_cm',
  hips: 'hips_cm',
  arm: 'arm_cm',
  thigh: 'thigh_cm',
  calf: 'calf_cm',
} as const satisfies Record<Zone, string>

// Ordem para mostrar (histórico, zonas): primeiro as da fórmula.
export const ZONE_ORDER: Zone[] = ['waist', 'hips', 'neck', 'chest', 'arm', 'thigh', 'calf']

// Onde se mede a cintura: a fórmula dos homens usa a cintura no umbigo; a das
// mulheres, a parte mais estreita (a cintura natural). Cada medição guarda o
// sítio em readings.waist_site; as antigas, sem ele, foram no umbigo.
export type WaistSite = 'umbigo' | 'natural'

export function waistSiteFor(sex: string | null): WaistSite {
  return sex === 'f' ? 'natural' : 'umbigo'
}

export function measuredWaistSite(readings: unknown): WaistSite {
  const site = readings && typeof readings === 'object' ? (readings as Record<string, unknown>).waist_site : null
  return site === 'natural' ? 'natural' : 'umbigo'
}

// A cintura (e a gordura, que sai dela) só se compara no mesmo sítio.
export function sameWaistSite(a: { readings?: unknown }, b: { readings?: unknown }): boolean {
  return measuredWaistSite(a.readings) === measuredWaistSite(b.readings)
}

// A medição não foi onde a fórmula pede (as medições antigas das mulheres, no
// umbigo): a gordura sai a mais e a cintura alvo não se aplica.
export function wrongWaistSite(m: { readings?: unknown }, sex: string | null): boolean {
  return measuredWaistSite(m.readings) !== waistSiteFor(sex)
}

export const METHOD_ERROR_PP = 4 // erro típico do método (±)
export const DETECTABLE_CHANGE_PP = 1.5 // mínima mudança detetável com 1 leitura
export const LEAN_STABLE_KG = 0.5
export const THIRD_READING_CM = 1
export const REFERENCE_WINDOW_DAYS = 7

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// Marinha dos EUA (Hodgdon e Beckett), em cm, %G = 495 / D − 450.
// Homens: D = 1,0324 − 0,19077 × log10(cintura − pescoço) + 0,15456 × log10(altura).
// Mulheres: D = 1,29579 − 0,35004 × log10(cintura + anca − pescoço) + 0,22100 × log10(altura);
// sem anca não há valor (a fórmula dos homens dava 13 % a uma mulher com 29 %).
export function navyBodyFat(
  heightCm: number,
  neckCm: number,
  waistCm: number,
  hipsCm: number | null = null,
  sex: string | null = 'm',
): number | null {
  if (!(heightCm > 0)) return null
  if (sex === 'f') {
    if (hipsCm == null || !(hipsCm > 0) || !(waistCm + hipsCm > neckCm)) return null
    const density = 1.29579 - 0.35004 * Math.log10(waistCm + hipsCm - neckCm) + 0.221 * Math.log10(heightCm)
    return 495 / density - 450
  }
  if (!(waistCm > neckCm)) return null
  const density = 1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)
  return 495 / density - 450
}

// %G de referência para a cintura alvo: 15 % nos homens, 25 % nas mulheres.
export function targetBodyFatPct(sex: string | null): number {
  return sex === 'f' ? 25 : 15
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
  m: { neck_cm: number; waist_cm: number; hips_cm?: number | null; weight_used_kg: number },
  sex: string | null = 'm',
): Composition | null {
  const pct = navyBodyFat(heightCm, m.neck_cm, m.waist_cm, m.hips_cm ?? null, sex)
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

// Uma medição como vem da base de dados (os numeric podem vir em texto).
type Cm = number | string | null | undefined
export type MeasureRow = { date: string; readings?: unknown } & { [K in (typeof ZONE_COLUMN)[Zone]]?: Cm }

export function measurementComposition(
  heightCm: number,
  m: MeasureRow & { weight_used_kg: number | string },
  sex: string | null,
): Composition | null {
  if (m.neck_cm == null || m.waist_cm == null) return null
  return composition(
    heightCm,
    {
      neck_cm: Number(m.neck_cm),
      waist_cm: Number(m.waist_cm),
      hips_cm: m.hips_cm != null ? Number(m.hips_cm) : null,
      weight_used_kg: Number(m.weight_used_kg),
    },
    sex,
  )
}

export function zoneValue(m: MeasureRow, zone: Zone): number | null {
  const v = m[ZONE_COLUMN[zone]]
  return v == null ? null : Number(v)
}

// Mudança de uma zona desde a medição anterior que a tem (a cintura só no
// mesmo sítio). `rows` da mais antiga para a mais recente.
export function zoneDelta(rows: MeasureRow[], index: number, zone: Zone): number | null {
  const row = rows[index]
  const now = row ? zoneValue(row, zone) : null
  if (row == null || now == null) return null
  for (let i = index - 1; i >= 0; i--) {
    const before = zoneValue(rows[i]!, zone)
    if (before == null) continue
    if (zone === 'waist' && !sameWaistSite(rows[i]!, row)) return null
    return round1(now - before)
  }
  return null
}

// Cada zona medida 2 vezes ou mais: os valores, a primeira e a última (a
// cintura só no sítio da última). `rows` da mais antiga para a mais recente.
export interface ZoneTrend {
  zone: Zone
  values: number[]
  firstDate: string
  last: number
  change: number
}

export function zoneTrends(rows: MeasureRow[]): ZoneTrend[] {
  return ZONE_ORDER.flatMap((zone) => {
    let measured = rows.filter((r) => zoneValue(r, zone) != null)
    const lastRow = measured[measured.length - 1]
    if (zone === 'waist' && lastRow) measured = measured.filter((r) => sameWaistSite(r, lastRow))
    if (measured.length < 2) return []
    const values = measured.map((r) => zoneValue(r, zone)!)
    const last = values[values.length - 1]!
    return [{ zone, values, firstDate: measured[0]!.date, last, change: round1(last - values[0]!) }]
  })
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

// «Desde 18 ago: −4,5 kg, dos quais cerca de 3,6 kg de gordura (80 %);
// massa magra −0,9 kg»: o peso perdido e a parte que foi gordura numa frase
// só, em vez de duas seguidas com a mesma descida (com 3 medições e 3 kg ou
// mais, `lossQuality`). A gordura e a massa magra saem da mesma conta da
// percentagem e somam o peso. Fora de 0–100 % (a gordura subiu, ou desceu
// mais do que o peso) não há frase: ficam as duas de antes.
const NBSP = '\u00a0'

export function lossSentence(loss: { weightKg: number; fatKg: number; fatShare: number }): string | null {
  if (loss.weightKg >= 0 || loss.fatShare < 0 || loss.fatShare > 100) return null
  const weight = round1(loss.weightKg)
  const fat = round1(Math.min(0, Math.max(weight, loss.fatKg)))
  const lean = round1(weight - fat)
  const leanText = Math.abs(lean) <= LEAN_STABLE_KG ? 'massa magra estável' : `massa magra −${fmtKg(lean)}${NBSP}kg`
  return `−${fmtKg(weight)}${NBSP}kg, dos quais cerca de ${fmtKg(fat)}${NBSP}kg de gordura (${loss.fatShare}${NBSP}%); ${leanText}`
}

// Cintura para uma %G alvo, com o mesmo pescoço, altura (e anca, nas mulheres).
export function targetWaist(
  heightCm: number,
  neckCm: number,
  targetPct: number,
  sex: string | null = 'm',
  hipsCm: number | null = null,
): number | null {
  const density = 495 / (targetPct + 450)
  if (sex === 'f') {
    if (hipsCm == null || !(hipsCm > 0)) return null
    return 10 ** ((1.29579 + 0.221 * Math.log10(heightCm) - density) / 0.35004) - hipsCm + neckCm
  }
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
  pescoco_mudou: 'O pescoço mudou mais de 1 cm em relação ao habitual. Confirma o sítio da fita.',
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
  // O pescoço fora do habitual (checkNeck); sem isto, mais de 1,5 cm contra a anterior.
  neckOutlier?: boolean
}): MeasureFlag[] {
  const flags: MeasureFlag[] = []
  if (input.maintenance) flags.push('pausa_dieta')
  if (input.dinnerOutYesterday) flags.push('depois_jantar_fora')
  if (input.pct != null && !isPlausible(input.pct)) flags.push('plausibilidade')
  const prev = input.previous
  if (input.neckOutlier ?? (prev?.neck_cm != null && Math.abs(input.neck - prev.neck_cm) > 1.5)) flags.push('pescoco_mudou')
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

// Categorias da % de gordura (Corpo): seis faixas, diferentes para homens e
// mulheres (as mulheres têm mais gordura essencial). Os cortes seguem as
// tabelas habituais (ACE), arredondados: homens 8 · 14 · 20 · 25 · 30,
// mulheres 15 · 22 · 29 · 34 · 40.
export const FAT_LABELS = [
  'Muito seco',
  'Seco',
  'Saudável',
  'Gordurinha a mais',
  'Excesso de gordura',
  'Muita gordura',
] as const

export function fatCuts(sex: string | null): number[] {
  return sex === 'f' ? [15, 22, 29, 34, 40] : [8, 14, 20, 25, 30]
}

// Os limites da barra no ecrã (onde começa e acaba).
export function fatScaleRange(sex: string | null): [number, number] {
  return sex === 'f' ? [10, 48] : [3, 38]
}

export function fatCategory(pct: number, sex: string | null): { index: number; label: (typeof FAT_LABELS)[number] } {
  const index = fatCuts(sex).filter((cut) => pct >= cut).length
  return { index, label: FAT_LABELS[index]! }
}

// --- O pescoço habitual (decisão 303) -----------------------------------------
//
// O pescoço quase não muda (mesmo a emagrecer, uns milímetros por mês), mas
// entra na fórmula com o peso da cintura: 2 cm a menos no pescoço anulam 2 cm
// a menos na cintura. Uma leitura que foge mais de 1 cm do habitual (a
// mediana das 3 anteriores; com menos, a anterior), sem uma mudança grande de
// peso que a explique, é quase sempre a fita noutro sítio. Até a pessoa dizer
// «Está certo», a %G em todo o lado (cartões, gráfico, cintura alvo,
// projeção, mês) conta com o pescoço habitual, e diz que conta.
// readings.neck_confirmed: true = «Está certo»; false = «Usar o pescoço
// habitual»; sem ele = ainda por confirmar (conta o habitual).

export const NECK_STABLE_CM = 1
export const NECK_BASELINE_COUNT = 3
// Uma mudança de peso que justifica o pescoço: 4 kg por cada cm.
export const NECK_KG_PER_CM = 4

export type NeckChoice = 'confirmado' | 'habitual'

export function neckChoice(readings: unknown): NeckChoice | null {
  const v = readings && typeof readings === 'object' ? (readings as Record<string, unknown>).neck_confirmed : undefined
  return v === true ? 'confirmado' : v === false ? 'habitual' : null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

// O pescoço habitual: a mediana das últimas 3 leituras (da mais antiga para
// a mais recente); com menos de 3, a última.
export function usualNeck(previousNecks: number[]): number | null {
  const valid = previousNecks.filter((n) => Number.isFinite(n) && n > 0)
  if (!valid.length) return null
  if (valid.length < NECK_BASELINE_COUNT) return valid[valid.length - 1]!
  return round1(median(valid.slice(-NECK_BASELINE_COUNT)))
}

export interface NeckCheck {
  measured: number
  usual: number | null
  change: number | null // medido − habitual (cm)
  basis: 'anterior' | 'habitual' // contra a anterior (menos de 3) ou a mediana
  outlier: boolean
}

export function checkNeck(input: { neck: number; previousNecks: number[]; weightKg: number | null; previousWeightKg: number | null }): NeckCheck {
  const usual = usualNeck(input.previousNecks)
  const basis = input.previousNecks.filter((n) => Number.isFinite(n) && n > 0).length < NECK_BASELINE_COUNT ? 'anterior' : 'habitual'
  if (usual == null) return { measured: input.neck, usual: null, change: null, basis, outlier: false }
  const change = round1(input.neck - usual)
  const big = Math.abs(change) > NECK_STABLE_CM + 1e-9
  const weightMove = input.weightKg != null && input.previousWeightKg != null ? Math.abs(input.weightKg - input.previousWeightKg) : 0
  const justified = weightMove >= NECK_KG_PER_CM * Math.abs(change)
  return { measured: input.neck, usual, change, basis, outlier: big && !justified }
}

export interface NeckUse extends NeckCheck {
  choice: NeckChoice | null
  useUsual: boolean // a %G conta com o pescoço habitual
  used: number // o pescoço que entra na conta
}

type WithWeight = MeasureRow & { weight_used_kg?: number | string | null }

// O pescoço de cada medição (`rows` da mais antiga para a mais recente, todas):
// o medido, o habitual e o que entra na %G. O habitual vem das leituras
// medidas (não das substituídas): repetir 35 duas vezes já passa a ser o habitual.
export function neckUses(rows: WithWeight[]): (NeckUse | null)[] {
  const necks: number[] = []
  let lastWeight: number | null = null
  return rows.map((r) => {
    const neck = zoneValue(r, 'neck')
    if (neck == null) return null
    const weight = r.weight_used_kg != null && Number(r.weight_used_kg) > 0 ? Number(r.weight_used_kg) : null
    const check = checkNeck({ neck, previousNecks: necks, weightKg: weight, previousWeightKg: lastWeight })
    necks.push(neck)
    lastWeight = weight
    const choice = neckChoice(r.readings)
    const useUsual = check.outlier && check.usual != null && choice !== 'confirmado'
    return { ...check, choice, useUsual, used: useUsual ? check.usual! : neck }
  })
}

// As medições com o pescoço que conta para a %G (o habitual onde a leitura
// foge e não foi confirmada). As zonas a mostrar usam as originais.
export function withReferenceNeck<T extends WithWeight>(rows: T[]): T[] {
  const uses = neckUses(rows)
  return rows.map((r, i) => (uses[i]?.useUsual ? { ...r, neck_cm: uses[i]!.used } : r))
}

export function usualNeckLabel(cm: number): string {
  return `calculado com o pescoço habitual (${fmtKg(cm)} cm)`
}

// «O pescoço mudou 2 cm desde a última vez. Medir outra vez?»
export function neckQuestion(check: NeckCheck): string {
  const cm = fmtKg(Math.abs(check.change ?? 0))
  const head =
    check.basis === 'anterior'
      ? `O pescoço mudou ${cm} cm desde a última vez.`
      : `O pescoço está ${cm} cm ${(check.change ?? 0) < 0 ? 'abaixo' : 'acima'} do habitual (${fmtKg(check.usual ?? 0)} cm).`
  return `${head} Medir outra vez?`
}

// --- Porque mudou a %G (decisão 303) -----------------------------------------
//
// A mudança da %G entre duas medições, repartida pelas medidas da fórmula
// (cintura, anca nas mulheres, pescoço). Cada parte é o efeito de mudar só
// essa medida, com a fórmula verdadeira, na média de todas as ordens
// possíveis (valor de Shapley): as partes somam exatamente a mudança total,
// sem resto, mesmo com a fórmula em logaritmos.

export type FormulaZone = 'waist' | 'hips' | 'neck'
export interface FormulaCm {
  neck: number
  waist: number
  hips?: number | null
}

export interface FatPart {
  zone: FormulaZone
  cm: number // mudança em cm
  pp: number // pontos de %G
}

export interface FatChangeExplanation {
  before: number
  after: number
  total: number // pontos de %G
  parts: FatPart[] // só as medidas que mudaram
  text: string
}

const MINUS = '−'
function signedPp(n: number): string {
  const r = round1(n)
  return `${r < 0 ? MINUS : r > 0 ? '+' : ''}${Math.abs(r).toFixed(1).replace('.', ',')}`
}
export function pct1(n: number): string {
  return round1(n).toFixed(1).replace('.', ',')
}
function ppText(n: number): string {
  return `${signedPp(n)} pontos`
}

const ZONE_NOUN: Record<FormulaZone, string> = { waist: 'a cintura', hips: 'a anca', neck: 'o pescoço' }

function moved(zone: FormulaZone, cm: number, also: boolean): string {
  const noun = ZONE_NOUN[zone]
  return `${noun}${also ? ' também' : ''} ${cm < 0 ? 'desceu' : 'subiu'} ${fmtKg(cm)} cm`
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function explainFatChange(
  heightCm: number,
  sex: string | null,
  before: FormulaCm,
  after: FormulaCm,
  opts: { neckSuspect?: boolean } = {},
): FatChangeExplanation | null {
  const female = sex === 'f'
  const zones: FormulaZone[] = female ? ['waist', 'hips', 'neck'] : ['waist', 'neck']
  const value = (x: FormulaCm, z: FormulaZone) => (z === 'hips' ? (x.hips ?? null) : x[z])
  for (const z of zones) if (value(before, z) == null || value(after, z) == null) return null
  const f = (set: Set<FormulaZone>) => {
    const pick = (z: FormulaZone) => value(set.has(z) ? after : before, z)!
    return navyBodyFat(heightCm, pick('neck'), pick('waist'), female ? pick('hips') : null, sex)
  }
  const b = f(new Set())
  const a = f(new Set(zones))
  if (b == null || a == null) return null
  const changed = zones.filter((z) => Math.abs(value(after, z)! - value(before, z)!) > 1e-9)
  // Shapley: a média, em todas as ordens, do efeito de cada medida ao mudar.
  const orders: FormulaZone[][] = []
  const permute = (left: FormulaZone[], acc: FormulaZone[]) => {
    if (!left.length) orders.push(acc)
    left.forEach((z, i) => permute([...left.slice(0, i), ...left.slice(i + 1)], [...acc, z]))
  }
  permute(changed, [])
  const sums = new Map<FormulaZone, number>(changed.map((z) => [z, 0]))
  for (const order of orders) {
    const set = new Set<FormulaZone>()
    let prev = b
    for (const z of order) {
      set.add(z)
      const next = f(set)
      if (next == null) return null
      sums.set(z, sums.get(z)! + (next - prev))
      prev = next
    }
  }
  const parts: FatPart[] = changed.map((z) => ({ zone: z, cm: round1(value(after, z)! - value(before, z)!), pp: sums.get(z)! / orders.length }))
  const total = a - b
  return { before: b, after: a, total, parts, text: changeText(parts, total, opts.neckSuspect === true) }
}

function changeText(parts: FatPart[], total: number, neckSuspect: boolean): string {
  const same = Math.abs(round1(total)) === 0
  let text: string
  if (!parts.length) text = 'As medidas da fórmula ficaram iguais: a %G também.'
  else if (parts.length === 1) {
    const p = parts[0]!
    text = `${capital(moved(p.zone, p.cm, false))}: ${same ? 'a %G ficou igual' : ppText(total)}.`
  } else {
    // Cintura, anca, pescoço; «mas» quando uma puxa ao contrário da anterior.
    const rank: Record<FormulaZone, number> = { waist: 0, hips: 1, neck: 2 }
    const sorted = [...parts].sort((x, y) => rank[x.zone] - rank[y.zone])
    const pieces = sorted.map((p, i) => {
      const prev = sorted[i - 1]
      const against = prev != null && Math.sign(round1(prev.pp)) !== 0 && Math.sign(round1(p.pp)) === -Math.sign(round1(prev.pp))
      const also = against && Math.sign(prev!.cm) === Math.sign(p.cm)
      const head = moved(p.zone, p.cm, also)
      const joint = i === 0 ? '' : against ? ', mas ' : i === sorted.length - 1 ? ' e ' : ', '
      return `${joint}${head} (${ppText(p.pp)})`
    })
    text = `${capital(pieces.join(''))}: ${same ? 'ficou igual' : `no total, ${ppText(total)}`}.`
  }
  if (neckSuspect) text += ' O pescoço raramente muda tanto — confirma a medida.'
  return text
}

// A explicação de uma medição contra a anterior comparável (com pescoço e
// cintura no mesmo sítio, e anca nas mulheres). `rows` da mais antiga para a
// mais recente, todas. A anterior entra com o pescoço que contou; a de agora
// com o medido (é isso que a fita disse), e, se conta o habitual, uma nota
// com a %G que fica.
export interface MeasureExplanation {
  previousDate: string
  change: FatChangeExplanation
  neck: NeckUse | null
  usedPct: number | null // a %G que conta (com o pescoço habitual, se for o caso)
  usualNote: string | null // «Com o pescoço habitual (37 cm), conta só a cintura: 18,6 % (−1,4 pontos).»
  askConfirm: boolean // oferecer «Está certo» (o pescoço habitual está a contar)
}

export function explainMeasurement(rows: WithWeight[], index: number, heightCm: number, sex: string | null): MeasureExplanation | null {
  const row = rows[index]
  if (!row) return null
  const uses = neckUses(rows)
  const female = sex === 'f'
  const cm = (r: WithWeight, used: boolean, i: number): FormulaCm | null => {
    const neck = used ? (uses[i]?.used ?? null) : zoneValue(r, 'neck')
    const waist = zoneValue(r, 'waist')
    const hips = zoneValue(r, 'hips')
    if (neck == null || waist == null || (female && hips == null)) return null
    return { neck, waist, hips }
  }
  const now = cm(row, false, index)
  if (!now) return null
  let prevIndex = -1
  for (let i = index - 1; i >= 0; i--) {
    if (cm(rows[i]!, true, i) && sameWaistSite(rows[i]!, row)) {
      prevIndex = i
      break
    }
  }
  if (prevIndex < 0) return null
  const before = cm(rows[prevIndex]!, true, prevIndex)!
  const neck = uses[index] ?? null
  const change = explainFatChange(heightCm, sex, before, now, { neckSuspect: neck?.outlier === true && neck.choice == null })
  if (!change) return null
  let usedPct: number | null = change.after
  let usualNote: string | null = null
  if (neck?.useUsual) {
    usedPct = navyBodyFat(heightCm, neck.used, now.waist, female ? (now.hips ?? null) : null, sex)
    if (usedPct != null) {
      usualNote = `Com o pescoço habitual (${fmtKg(neck.used)} cm), ${female ? 'contam a cintura e a anca' : 'conta só a cintura'}: ${pct1(usedPct)} % (${ppText(usedPct - change.before)}).`
    }
  }
  return { previousDate: rows[prevIndex]!.date, change, neck, usedPct, usualNote, askConfirm: neck?.useUsual === true }
}
