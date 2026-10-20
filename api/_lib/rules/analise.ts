// Resultado de uma análise de refeição → itens, estado e estimativa.
import { round1, type MealItem } from './meal-totals.js'
import { retryDelayMs } from './falhas.js'

export type Confidence = 'alta' | 'media' | 'baixa'
export type MealStatus = 'a_analisar' | 'por_rever' | 'ok' | 'erro' | 'sem_analise'

export interface AnalysedItem {
  name: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  confidence: Confidence
  food_ref: string | null
}

// Os alimentos pessoais vão para o prompt com referências curtas (a1…a40).
export function foodRefs(foodIds: string[]): { refs: Record<string, string>; byId: Map<string, string> } {
  const refs: Record<string, string> = {}
  const byId = new Map<string, string>()
  foodIds.forEach((id, i) => {
    refs[`a${i + 1}`] = id
    byId.set(id, `a${i + 1}`)
  })
  return { refs, byId }
}

const nonNegative = (n: number) => (Number.isFinite(n) && n > 0 ? round1(n) : 0)

// Números que não podem estar certos (um rótulo lido por embalagem, um zero a
// mais ou a menos): mais de 1,5 kg num item, mais de 9 kcal por grama (o
// azeite tem 8,8) ou macros que dão bem mais calorias do que as escritas. O
// contrário (kcal acima dos macros) é normal no álcool, por isso não conta.
export const MAX_ITEM_GRAMS = 1500
export const MAX_KCAL_PER_GRAM = 9

export function implausibleItem(
  item: Pick<MealItem, 'grams' | 'kcal' | 'protein' | 'carbs' | 'fat'>,
  maxGrams = MAX_ITEM_GRAMS,
): boolean {
  if (item.grams > maxGrams) return true
  if (item.grams > 0 && item.kcal > item.grams * MAX_KCAL_PER_GRAM) return true
  const fromMacros = 4 * item.protein + 4 * item.carbs + 9 * item.fat
  return fromMacros > item.kcal * 1.25 + 20
}

// Um item com números impossíveis fica com confiança baixa (e a refeição por
// rever): os números não mudam, mas aparece «confirma» em vez de entrar
// como certo. Numa receita inteira (várias doses) cabem mais gramas.
export function toMealItems(
  items: AnalysedItem[],
  refs: Record<string, string>,
  maxGrams = MAX_ITEM_GRAMS,
): MealItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => {
      const numbers = {
        grams: nonNegative(item.grams),
        kcal: nonNegative(item.kcal),
        protein: nonNegative(item.protein),
        carbs: nonNegative(item.carbs),
        fat: nonNegative(item.fat),
      }
      const confidence: Confidence = implausibleItem(numbers, maxGrams) ? 'baixa' : item.confidence
      return {
        name: item.name.trim(),
        ...numbers,
        food_id: item.food_ref ? (refs[item.food_ref] ?? null) : null,
        estimated: confidence !== 'alta',
        confidence,
      }
    })
}

const foldName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Fotos juntas a uma refeição já analisada («Juntar foto»): o que lá estava
// fica (valores do código de barras, da favorita, as correções, os × e os
// −/+) e entra só o que é novo. Um item estimado com o mesmo nome dá lugar ao
// que a IA leu no rótulo; um item exato nunca muda nem se repete.
export function mergeAdded(current: MealItem[], added: MealItem[]): MealItem[] {
  const merged = [...current]
  for (const item of added) {
    const i = merged.findIndex((m) => foldName(m.name) === foldName(item.name))
    if (i < 0) merged.push(item)
    else if (i < current.length && merged[i]!.estimated) merged[i] = item
  }
  return merged
}

// Por rever quando algum item tem confiança baixa ou a refeição não é «alta».
// Contam as duas (ok e por_rever); as por rever aparecem com ≈ e «confirma».
export function analysedStatus(items: { confidence?: Confidence }[], mealConfidence: Confidence): MealStatus {
  if (items.length === 0) return 'erro'
  if (mealConfidence !== 'alta' || items.some((i) => i.confidence === 'baixa')) return 'por_rever'
  return 'ok'
}

// Escrita final protegida: só grava se a análise ainda for a mesma
// (analysis_started_at) e a nota não tiver mudado entretanto. Se a nota mudou,
// aplica a correção com a nota nova e tenta outra vez (no máximo 2 vezes).
export interface GuardedWriteDeps<T> {
  write: (items: MealItem[], noteUsed: string | null) => Promise<T | null>
  reread: () => Promise<{ note: string | null; startedAt: string | null; deleted: boolean } | null>
  correct: (items: MealItem[], note: string) => Promise<MealItem[]>
}

export async function guardedWrite<T>(
  items: MealItem[],
  noteUsed: string | null,
  claimedAt: string,
  deps: GuardedWriteDeps<T>,
  maxCorrections = 2,
): Promise<T | null> {
  let current = items
  let note = noteUsed
  for (let attempt = 0; attempt <= maxCorrections; attempt++) {
    const written = await deps.write(current, note)
    if (written) return written
    const fresh = await deps.reread()
    // Apagada, ou outra tentativa reivindicou a análise: essa é que manda.
    if (!fresh || fresh.deleted || fresh.startedAt !== claimedAt) return null
    if (fresh.note === note) return null
    note = fresh.note
    if (note) current = await deps.correct(current, note)
  }
  return null
}

// Análise parada: a reivindicação (90 s no servidor; a função morre aos 60 s)
// expirou, nem começou, ou o servidor soltou-a depois de um erro passageiro
// (a IA demorou, sobrecarga) à espera de outra tentativa. O telemóvel pede-a
// sozinho enquanto houver tentativas (3) e a refeição for das últimas 12 h,
// com a app aberta ou quando se abre depois. «Tentar outra vez» só aparece
// depois da 3.ª tentativa, com um erro que se repetiria (estado «erro», do
// servidor), sem rede, ou quando os pedidos do telemóvel não chegam ao servidor.
export const ANALYSIS_LEASE_MS = 95_000
export const ANALYSIS_START_GRACE_MS = 25_000
export const AUTO_RETRY_WINDOW_MS = 12 * 3_600_000
// Pedidos do telemóvel para a mesma tentativa (o servidor não a reivindicou:
// o pedido perdeu-se na rede, ao voltar à app) antes de mostrar o botão.
export const PHONE_TRIES_PER_ATTEMPT = 3

export interface AnalysisProgress {
  status: string
  analysis_started_at: string | null
  analysis_attempts: number
  created_at: string
}

export function analysisStalled(meal: AnalysisProgress, now: number): boolean {
  if (meal.status !== 'a_analisar') return false
  const started = meal.analysis_started_at ? Date.parse(meal.analysis_started_at) : null
  return started == null ? now - Date.parse(meal.created_at) > ANALYSIS_START_GRACE_MS : now - started > ANALYSIS_LEASE_MS
}

// Ainda vale outra tentativa automática: menos de 3 e das últimas 12 h.
export function autoRetryable(meal: AnalysisProgress, now: number): boolean {
  return meal.status === 'a_analisar' && meal.analysis_attempts < 3 && now - Date.parse(meal.created_at) < AUTO_RETRY_WINDOW_MS
}

// A tentativa em que a análise está: muda quando o servidor a reivindica
// (sobe o número, fica a hora) ou a solta (a hora volta a nada).
export function attemptKey(meal: AnalysisProgress & { id: string }): string {
  return `${meal.id}:${meal.analysis_attempts}:${meal.analysis_started_at ?? '-'}`
}

// O que o telemóvel guarda dos seus pedidos de outra tentativa (por refeição).
export interface PhoneTries {
  key: string
  tries: number
  at: number
}

export interface RetryContext {
  online: boolean
  tries?: PhoneTries | null
}

function triesFor(meal: AnalysisProgress & { id: string }, ctx: RetryContext): PhoneTries | null {
  return ctx.tries && ctx.tries.key === attemptKey(meal) ? ctx.tries : null
}

// Já não há tentativa automática: a linha mostra o motivo e «Tentar outra vez».
export function analysisStuck(meal: AnalysisProgress & { id: string }, now: number, ctx: RetryContext): boolean {
  if (!analysisStalled(meal, now)) return false
  if (!autoRetryable(meal, now) || !ctx.online) return true
  return (triesFor(meal, ctx)?.tries ?? 0) >= PHONE_TRIES_PER_ATTEMPT
}

// Pedir outra tentativa agora? Parada, com tentativas, com rede; uma vez por
// tentativa. Um pedido que não mudou nada (não chegou ao servidor) volta a ir
// com a espera da fila das fotos (10 s, 30 s, 2 min), até 3 por tentativa:
// sem tempestades de pedidos, mesmo a recarregar a app.
export function autoRetryDue(meal: AnalysisProgress & { id: string }, now: number, ctx: RetryContext): boolean {
  if (!ctx.online || !analysisStalled(meal, now) || !autoRetryable(meal, now)) return false
  const same = triesFor(meal, ctx)
  if (!same) return true
  if (same.tries >= PHONE_TRIES_PER_ATTEMPT) return false
  return now - same.at >= retryDelayMs(same.tries)
}

// O que fazer com um pedido de outra tentativa (`meal/analyse`). «Tentar de
// novo» e «Reanalisar foto» (`reset`), e uma refeição sem análise ou com erro,
// repõem as tentativas. A tentativa que o telemóvel pede sozinho (`auto`) vem
// de uma vista que pode estar atrasada: só vale para uma análise ainda em
// 'a_analisar' e nunca repõe nada (um erro que se repetiria, a 3.ª tentativa
// gasta ou o limite da IA ficam como estão, à espera do toque da pessoa).
export function analyseRequest(
  input: { reset?: boolean; auto?: boolean },
  status: string,
): { skip: boolean; reset: boolean } {
  if (input.auto) return { skip: status !== 'a_analisar', reset: false }
  return { skip: false, reset: input.reset === true || status === 'sem_analise' || status === 'erro' }
}
