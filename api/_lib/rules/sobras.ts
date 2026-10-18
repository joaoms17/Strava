// «Foto do antes e do depois»: a pessoa fotografa o prato cheio (a refeição
// por foto de sempre) e, depois de comer, o que sobrou. A IA compara as fotos
// e diz, por item, que parte foi comida; aqui aplica-se isso aos itens (nada
// de novo entra) e decide-se quando perguntar, no ＋, se uma foto nova é o que
// sobrou de uma refeição de há pouco. Sem imports de servidor: o telemóvel
// usa este ficheiro diretamente.
import { round1, type MealItem } from './meal-totals.js'
import { scaleItems } from './favoritos.js'
import type { Confidence } from './analise.js'
import { SLOT_LABEL, type Slot } from './momentos.js'
import { shiftDate } from './nutritional-day.js'

// ---------------------------------------------------------------------
// A resposta da IA → itens comidos
// ---------------------------------------------------------------------

export interface LeftoversAnswer {
  same_plate: boolean
  reason: string | null
  empty_plate: boolean
  items: { index: number; name: string; eaten: number; confidence: Confidence }[]
}

// Fração comida de 0 a 1, em passos de 5 %. O que vem fora (1,2, −0,1, NaN)
// fica no limite (sem número, conta como tudo comido: nunca se desconta às
// cegas). Perto de tudo conta como tudo e perto de nada como nada, para não
// aparecer «Arroz 150 → 143 g» por ruído.
export const NEAR_ALL = 0.95
export const NEAR_NONE = 0.05

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 1
  const stepped = Math.round(Math.min(1, Math.max(0, value)) * 20) / 20
  if (stepped >= NEAR_ALL) return 1
  if (stepped <= NEAR_NONE) return 0
  return stepped
}

export interface EatenShare {
  fraction: number
  confidence: Confidence | null // null: a IA não disse nada deste item
}

const fold = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Por item da refeição (pela ordem dela), a parte comida. Um item de que a IA
// não fala fica todo comido; um índice que não existe (ou repetido) procura-se
// pelo nome; o que não corresponde a nenhum item fica de fora (nada de novo
// entra). Com o prato vazio, tudo fica como estava.
export function eatenShares(
  items: Pick<MealItem, 'name'>[],
  answer: Pick<LeftoversAnswer, 'items' | 'empty_plate'>,
): EatenShare[] {
  const shares: EatenShare[] = items.map(() => ({ fraction: 1, confidence: null }))
  if (answer.empty_plate) return shares
  const seen = new Set<number>()
  for (const said of answer.items) {
    let i = Number.isInteger(said.index) && said.index >= 0 && said.index < items.length && !seen.has(said.index) ? said.index : -1
    if (i < 0) i = items.findIndex((item, j) => !seen.has(j) && fold(item.name) === fold(said.name ?? ''))
    if (i < 0) continue
    seen.add(i)
    shares[i] = { fraction: clampFraction(said.eaten), confidence: said.confidence }
  }
  return shares
}

// - outro_prato: a foto do depois não é este prato (não se muda nada);
// - igual: o prato está como no antes (a mesma foto, ou nada comido);
// - tudo: comeu tudo, os números ficam (a foto do depois guarda-se);
// - aplicado: desconta-se o que sobrou.
export type LeftoversOutcome = 'outro_prato' | 'igual' | 'tudo' | 'aplicado'

export function leftoversOutcome(answer: Pick<LeftoversAnswer, 'same_plate'>, shares: EatenShare[]): LeftoversOutcome {
  if (!answer.same_plate) return 'outro_prato'
  if (shares.every((s) => s.fraction >= 1)) return 'tudo'
  if (shares.every((s) => s.fraction <= 0)) return 'igual'
  return 'aplicado'
}

const RANK: Record<Confidence, number> = { baixa: 0, media: 1, alta: 2 }

export function lowerConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b
}

// Os itens com o que foi comido: gramas, kcal e macros na mesma proporção
// (scaleItems, arredondados a 1 casa), um item que ficou todo no prato sai, e
// o que se descontou passa a estimado, com a confiança mais baixa das duas
// (a do item e a da IA a ver o que sobrou). `leftKcal`: as kcal que ficaram
// no prato.
export function applyLeftovers(items: MealItem[], shares: EatenShare[]): { items: MealItem[]; leftKcal: number } {
  const eaten: MealItem[] = []
  items.forEach((item, i) => {
    const share = shares[i] ?? { fraction: 1, confidence: null }
    if (share.fraction >= 1) {
      eaten.push(item)
      return
    }
    if (share.fraction <= 0) return
    const scaled = scaleItems([item], share.fraction)[0]!
    const before: Confidence = item.confidence ?? (item.estimated ? 'media' : 'alta')
    eaten.push({ ...scaled, estimated: true, confidence: lowerConfidence(before, share.confidence ?? 'media') })
  })
  const kcal = (list: MealItem[]) => list.reduce((acc, i) => acc + i.kcal, 0)
  return { items: eaten, leftKcal: round1(Math.max(0, kcal(items) - kcal(eaten))) }
}

// Um item descontado que a IA viu mal («baixa») põe a refeição por rever;
// senão o estado não muda. Só conta o que a foto do depois mexeu: um item
// «baixa» que a pessoa já confirmou («Está certo») e que ficou igual não volta
// a pôr por rever uma refeição confirmada.
export function statusAfterLeftovers(current: 'ok' | 'por_rever', shares: EatenShare[]): 'ok' | 'por_rever' {
  return shares.some((s) => s.fraction < 1 && s.confidence === 'baixa') ? 'por_rever' : current
}

// «Juntar foto» ou «Analisar outra vez» numa refeição já descontada: as
// fotos do antes ainda mostram o prato cheio, e a IA (prompt de juntar) podia
// devolver um item descontado com os gramas todos (os descontados ficam
// «estimados», e mergeAdded troca os estimados) ou voltar a pôr o que ficou
// no prato. Aqui só entra o que tem um nome novo; os itens que lá estão ficam
// como estão.
export function mergeAfterLeftovers(current: MealItem[], added: MealItem[]): MealItem[] {
  const merged = [...current]
  for (const item of added) {
    if (!merged.some((m) => fold(m.name) === fold(item.name))) merged.push(item)
  }
  return merged
}

// O aviso que vai com os itens para o prompt de juntar foto, numa refeição já
// descontada (os prompts são ficheiros fixos; isto segue no JSON).
export const LEFTOVERS_ADD_HINT =
  'Esta refeição já tem descontado o que sobrou no prato: itens_atuais é o que foi COMIDO. As fotografias antigas mostram o prato cheio, antes de comer. Não devolvas outra vez itens que já lá estão nem o que ficou no prato; devolve só o que é novo nas fotografias novas.'

// ---------------------------------------------------------------------
// Que refeições levam a foto do depois
// ---------------------------------------------------------------------

export interface PlateMeal {
  id: string
  user_id: string
  client_id: string | null
  status: string
  deleted_at: string | null
  items: unknown[] | null
  photo_paths: string[] | null
  leftover_photo_path?: string | null // migração 20261018200000
}

// A pasta das fotos desta refeição (a da captura, ou a do «Juntar foto»).
export function mealFolder(meal: Pick<PlateMeal, 'id' | 'user_id' | 'client_id'>): string {
  return `${meal.user_id}/${meal.client_id ?? meal.id}/`
}

// As fotos do prato desta refeição: as da pasta dela. As de uma refeição
// repetida, de uma favorita ou partilhada são de outro prato.
export function platePhotos(meal: Pick<PlateMeal, 'id' | 'user_id' | 'client_id' | 'photo_paths'>): string[] {
  const folder = mealFolder(meal)
  return (meal.photo_paths ?? []).filter((p) => p.startsWith(folder))
}

// Analisada (ok ou por rever), com itens e com a foto do prato, e ainda sem a
// foto do depois (uma de cada vez; Anular tira-a).
export function canTakeLeftovers(meal: PlateMeal): boolean {
  return (
    (meal.status === 'ok' || meal.status === 'por_rever') &&
    meal.deleted_at == null &&
    (meal.items?.length ?? 0) > 0 &&
    platePhotos(meal).length > 0 &&
    meal.leftover_photo_path == null
  )
}

// O «Sobrou comida?» na folha só aparece nas refeições de hoje e de ontem
// (a foto do depois tira-se logo a seguir; nas antigas era só mais um botão).
export const LEFTOVERS_MAX_DAYS_AGO = 1

export function offersLeftovers(meal: PlateMeal & { date: string }, today: string): boolean {
  return canTakeLeftovers(meal) && meal.date >= shiftDate(today, -LEFTOVERS_MAX_DAYS_AGO)
}

// ---------------------------------------------------------------------
// No ＋: «Isto é o que sobrou do almoço?»
// ---------------------------------------------------------------------

// Uma foto tirada 5 min a 3 h depois de uma refeição por foto do mesmo dia.
// Sem conseguir comparar as cores do prato, só até 1 h 30.
export const LEFTOVERS_MIN_GAP_MS = 5 * 60_000
export const LEFTOVERS_WINDOW_MS = 3 * 3_600_000
export const LEFTOVERS_BLIND_WINDOW_MS = 90 * 60_000

export interface CandidateMeal extends PlateMeal {
  date: string
  logged_at: string
}

// A refeição de que a foto pode ser o que sobrou: do mesmo dia nutricional,
// que leva a foto do depois (canTakeLeftovers) e comida entre 5 min e 3 h
// antes da foto. Havendo várias, a mais recente.
export function leftoversCandidate<T extends CandidateMeal>(meals: T[], photo: { date: string; at: Date }): T | null {
  const at = photo.at.getTime()
  let best: T | null = null
  for (const meal of meals) {
    if (meal.date !== photo.date || !canTakeLeftovers(meal)) continue
    const gap = at - Date.parse(meal.logged_at)
    if (!(gap >= LEFTOVERS_MIN_GAP_MS && gap <= LEFTOVERS_WINDOW_MS)) continue
    if (!best || Date.parse(meal.logged_at) > Date.parse(best.logged_at)) best = meal
  }
  return best
}

// Cores do prato, sem IA: um histograma das cores da zona do meio da foto
// (o prato costuma estar ao centro; a mesa nas bordas diz pouco). Os píxeis
// com cor contam por tom (12 tons de 30°); os cinzentos, brancos e escuros (o
// prato, o arroz, a sombra) contam à parte. `chroma`: a parte com cor.
export const HUE_BINS = 12
export const GREY_BINS = 4

export interface PlateSignature {
  hues: number[] // soma 1 entre os píxeis com cor
  greys: number[] // soma 1 entre os cinzentos
  chroma: number // 0 a 1
}

export function plateSignature(rgba: ArrayLike<number>, width: number, height: number): PlateSignature | null {
  const hues = new Array<number>(HUE_BINS).fill(0)
  const greys = new Array<number>(GREY_BINS).fill(0)
  const x0 = Math.floor(width * 0.2)
  const x1 = Math.ceil(width * 0.8)
  const y0 = Math.floor(height * 0.2)
  const y1 = Math.ceil(height * 0.8)
  let coloured = 0
  let grey = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      if ((rgba[i + 3] ?? 255) < 128) continue
      const r = (rgba[i] ?? 0) / 255
      const g = (rgba[i + 1] ?? 0) / 255
      const b = (rgba[i + 2] ?? 0) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const saturation = max === 0 ? 0 : (max - min) / max
      if (saturation < 0.25 || max < 0.2) {
        greys[Math.min(GREY_BINS - 1, Math.floor(max * GREY_BINS))]! += 1
        grey++
        continue
      }
      const d = max - min
      let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      hue = (hue * 60 + 360) % 360
      hues[Math.min(HUE_BINS - 1, Math.floor(hue / (360 / HUE_BINS)))]! += 1
      coloured++
    }
  }
  const total = coloured + grey
  if (total === 0) return null
  return {
    hues: hues.map((n) => (coloured ? n / coloured : 0)),
    greys: greys.map((n) => (grey ? n / grey : 0)),
    chroma: coloured / total,
  }
}

// Quanto da foto do depois cabe no prato do antes (0 a 1). O que sobra é uma
// parte do que lá estava: as mesmas cores, e nunca mais de uma cor do que
// havia (com 25 % de folga para a foto tirada um pouco mais perto). Outro
// prato com as mesmas cores, mas mais, não conta. null quando uma das fotos
// quase não tem cor (prato vazio, comida toda clara): aí as cores não dizem
// nada.
export const MIN_CHROMA = 0.08
export const AREA_TOLERANCE = 1.25

export function signatureSimilarity(before: PlateSignature, after: PlateSignature): number | null {
  if (before.chroma < MIN_CHROMA || after.chroma < MIN_CHROMA) return null
  let kept = 0
  for (let i = 0; i < after.hues.length; i++) {
    const area = after.hues[i]! * after.chroma
    kept += Math.min(area, AREA_TOLERANCE * (before.hues[i] ?? 0) * before.chroma)
  }
  return Math.round((kept / after.chroma) * 100) / 100
}

// Perguntar se a foto é o que sobrou: cores parecidas até 3 h depois; sem as
// poder comparar, só até 1 h 30. Cores diferentes: não pergunta (é outra
// refeição, e o «Sobrou comida?» da refeição continua lá).
export const SAME_PLATE_MIN = 0.7

export function askLeftovers(input: { gapMs: number; similarity: number | null }): boolean {
  if (input.gapMs < LEFTOVERS_MIN_GAP_MS || input.gapMs > LEFTOVERS_WINDOW_MS) return false
  if (input.similarity == null) return input.gapMs <= LEFTOVERS_BLIND_WINDOW_MS
  return input.similarity >= SAME_PLATE_MIN
}

// «do almoço», «da ceia».
export function ofSlot(slot: Slot): string {
  return `${slot === 'ceia' ? 'da' : 'do'} ${SLOT_LABEL[slot].toLowerCase()}`
}
