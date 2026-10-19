// Pedidos de entrega por captura de ecrã (Glovo, Uber Eats, Bolt Food, um
// talão de restaurante): o resumo do pedido passa a uma refeição com os pratos
// e as quantidades. A IA lê os pratos (prompts/meal-photo.v3.md); aqui ficam as
// guardas que não dependem dela e a dica «Pedido para 2». Sem imports de
// servidor: o telemóvel usa este ficheiro diretamente.
import { sharedFrom } from './partilha.js'
import { factorOf, sameFactor } from './porcoes.js'

// O bloco do pedido que a análise da foto devolve (só no meal-photo v3).
export interface Order {
  app: string | null
  restaurant: string | null
  people: number | null
}

const fold = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

// Linhas que nunca são comida, mesmo que a IA as deixe passar: taxas,
// gorjeta, descontos, totais, a entrega e o estafeta (em português e em
// inglês). Os nomes já vêm sem acentos e em minúsculas.
const NEVER_FOOD = [
  /^taxas?\b/,
  /\btaxas? (de|do|da|por) /,
  /\bgorjeta\b/,
  /\bgratificacao\b/,
  /\bdescontos?\b/,
  /\bcupao\b/,
  /\bvoucher\b/,
  /^(sub ?)?total\b/,
  /\biva\b/,
  /\bportes\b/,
  /^entrega\b/,
  /\bentrega (gratis|gratuita)\b/,
  /^servico\b/,
  /\bestafeta\b/,
  /\bmorada\b/,
  /\bpagamento\b/,
  /\bfees?\b/,
  /^tips?\b/,
  /\btip (for|to)\b/,
  /\bdiscount\b/,
  /\bpromo code\b/,
  /\bcourier\b/,
  /^delivery\b/,
]

// Coisas que vêm no saco e não se comem: só saem com (quase) zero kcal, para
// um «Saco de gomas» continuar a contar.
const PACKAGING = [
  /\bsacos?\b/,
  /\btalheres\b/,
  /\bpauzinhos\b/,
  /\bhashis?\b/,
  /\bguardanapos?\b/,
  /\bpalhinhas?\b/,
  /\bembalage(m|ns)\b/,
  /\bcutlery\b/,
  /\bchopsticks\b/,
  /\bnapkins?\b/,
  /\bstraws?\b/,
  /\bbags?\b/,
  /\bpackaging\b/,
]

const PACKAGING_MAX_KCAL = 10

export function nonFoodLine(item: { name: string; grams: number; kcal: number }): boolean {
  const name = fold(item.name)
  if (!name) return true
  if (NEVER_FOOD.some((re) => re.test(name))) return true
  if (PACKAGING.some((re) => re.test(name)) && !(item.kcal >= PACKAGING_MAX_KCAL)) return true
  // Nada para contar: uma linha que a IA escreveu sem gramas nem kcal.
  return !(item.grams > 0) && !(item.kcal > 0)
}

// A guarda de todas as fotos (também a juntar e na Nova favorita): o que é
// obviamente uma linha de taxa, gorjeta, saco ou total sai.
export function dropNonFood<T extends { name: string; grams: number; kcal: number }>(items: readonly T[]): T[] {
  return items.filter((item) => !nonFoodLine(item))
}

// Duas capturas do mesmo pedido que se sobrepõem mostram a mesma linha duas
// vezes. Se a IA a contar duas vezes (o mesmo nome, os mesmos gramas e kcal),
// fica uma. Só num pedido com mais de uma imagem.
export function dedupeOrderLines<T extends { name: string; grams: number; kcal: number }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${fold(item.name)}|${item.grams}|${item.kcal}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Quantas pessoas o pedido serve, só quando são 2 ou mais (com 1, ou sem
// saber, não há nada a dividir). A coluna aceita de 2 a 12.
export const MAX_ORDER_PEOPLE = 12

export function orderPeople(people: unknown): number | null {
  const n = typeof people === 'string' ? Number(people) : people
  return typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= MAX_ORDER_PEOPLE ? n : null
}

interface SplitState {
  source_meal_id?: string | null
  share_with?: readonly string[] | null
  share_split?: unknown
  tags?: readonly string[] | null
  portion_factor?: unknown
}

// «Pedido para 2» fica à espera só quando a pessoa não disse como o dividiu:
// sem «Também para …» (nem divisão), sem «Comi metade» e na porção 1. Se já
// disse, o pedido conta como ela escolheu e não há dica. Numa cópia
// partilhada (`source_meal_id`) também não: a porção dela já vem da divisão,
// mesmo que a reanalise ou mude a nota.
export function pendingSplit(people: number | null, meal: SplitState): number | null {
  if (people == null) return null
  if (meal.source_meal_id) return null
  if ((meal.share_with?.length ?? 0) > 0 || meal.share_split != null) return null
  if (meal.tags?.includes('comi_metade')) return null
  if (!sameFactor(factorOf(meal.portion_factor), 1)) return null
  return people
}

// A dica numa refeição gravada (Hoje, folha da refeição, Rever, aviso):
// `meals.order_people` (migração 20261018220000), por rever, não apagada, e
// sem a pessoa ter dividido entretanto (porção, partilha, «Comi metade»).
// Numa cópia partilhada não: a porção dela já vem da divisão.
export function orderSplitHint(
  meal: SplitState & { order_people?: unknown; status: string; deleted_at?: string | null; note?: string | null },
): number | null {
  if (meal.status !== 'por_rever' || meal.deleted_at != null || sharedFrom(meal.note)) return null
  return pendingSplit(orderPeople(meal.order_people), meal)
}

// «Pedido para 2 · divide em Porção ½ ou partilha a meias» (a 2); a 3 ou
// mais, a porção de cada um.
export function orderHintText(people: number): string {
  return people === 2
    ? 'Pedido para 2 · divide em Porção ½ ou partilha a meias'
    : `Pedido para ${people} · escolhe a tua porção`
}

// A quantidade de uma linha do pedido no nome («2× Poke de salmão», «3x
// Coca-Cola»); sem ela, 1.
export function orderQuantity(name: string): number {
  const match = /^\s*(\d{1,2})\s*[×xX]\s/.exec(name)
  return match ? Number(match[1]) : 1
}

// Num pedido, uma linha de 2 ou mais doses não se liga a um alimento da
// biblioteca: ao confirmar, a porção habitual dele aprendia as 2 doses juntas
// («Poke de salmão» passava a 900 g).
export function unlinkMultiples<T extends { name: string; food_ref: string | null }>(items: readonly T[]): T[] {
  return items.map((item) => (item.food_ref && orderQuantity(item.name) > 1 ? { ...item, food_ref: null } : item))
}
