// «Escolher pelo menu»: a IA lê a foto do menu e estima cada prato; aqui
// arrumam-se os números e escolhem-se os 3 melhores para o que falta comer
// hoje (calorias e proteína). Sem supabase nem node.
import { kcalTarget } from './targets.js'
import { maintenanceTarget } from './manutencao.js'

export const MENU_TYPES = ['prato', 'entrada', 'sopa', 'sobremesa', 'bebida', 'acompanhamento', 'outro'] as const
export type MenuType = (typeof MENU_TYPES)[number]
export const MAX_DISHES = 40

export interface Dish {
  name: string
  type: MenuType
  description: string | null
  grams: number | null
  kcal: number
  protein: number
  carbs: number
  fat: number
  price: number | null
}

export interface RankedDish extends Dish {
  // Gramas de proteína por cada 100 kcal.
  proteinPer100: number
  // Cabe no que falta comer hoje.
  fits: boolean
  // O que fica para o resto do dia (negativo = passa).
  kcalAfter: number | null
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
function num(v: unknown, min: number, max: number, digits = 0): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < min || n > max) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// O que a IA devolveu, com nomes e números plausíveis: sem nome ou sem
// calorias o prato sai; a proteína nunca dá mais calorias do que o prato
// (4 kcal por grama); nomes repetidos ficam uma vez.
export function cleanMenu(raw: unknown): Dish[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: Dish[] = []
  for (const r of list as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue
    const name = text(r.nome, 120)
    const kcal = num(r.kcal, 1, 4000)
    if (!name || kcal == null) continue
    const key = fold(name)
    if (seen.has(key)) continue
    seen.add(key)
    const type = (MENU_TYPES as readonly string[]).includes(r.tipo as string) ? (r.tipo as MenuType) : 'outro'
    out.push({
      name,
      type,
      description: text(r.descricao, 200) || null,
      grams: num(r.gramas, 1, 3000),
      kcal,
      protein: Math.min(num(r.proteina, 0, 300, 1) ?? 0, Math.floor(kcal / 4)),
      carbs: num(r.hidratos, 0, 600, 1) ?? 0,
      fat: num(r.gordura, 0, 300, 1) ?? 0,
      price: num(r.preco, 0, 1000, 2),
    })
    if (out.length >= MAX_DISHES) break
  }
  return out
}

// O que falta comer hoje, como no Hoje: a meta é a base mais o treino (na
// semana de pausa da dieta, o gasto estimado) menos o que já contou.
export function dayLeft(input: {
  baseKcal: number
  exerciseKcal: number
  maintenance: boolean
  tdee: number | null
  kcalIn: number
  proteinIn: number
  proteinTarget: number | null
}): { kcal: number; protein: number | null } {
  const target = input.maintenance ? maintenanceTarget(input.tdee) : kcalTarget(input.baseKcal, input.exerciseKcal)
  return {
    kcal: Math.round(target - input.kcalIn),
    protein: input.proteinTarget != null ? Math.max(0, Math.round(input.proteinTarget - input.proteinIn)) : null,
  }
}

// Por ordem: primeiro os que cabem no que falta hoje, pela proteína por
// caloria (empate: o mais leve); depois os que passam, do mais leve para o
// mais pesado. Contam os pratos (e as sopas, saladas e afins classificadas
// como prato); sem 3 pratos entram também as entradas, sopas e o resto, mas
// nunca bebidas nem sobremesas.
export function rankDishes(dishes: Dish[], kcalLeft: number | null): RankedDish[] {
  const mains = dishes.filter((d) => d.type === 'prato')
  const pool =
    mains.length >= 3 ? mains : dishes.filter((d) => d.type !== 'bebida' && d.type !== 'sobremesa')
  const ranked = pool.map((d) => ({
    ...d,
    proteinPer100: Math.round((d.protein / d.kcal) * 1000) / 10,
    fits: kcalLeft == null || d.kcal <= kcalLeft,
    kcalAfter: kcalLeft == null ? null : Math.round(kcalLeft - d.kcal),
  }))
  return ranked.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1
    if (a.fits) return b.proteinPer100 - a.proteinPer100 || a.kcal - b.kcal
    return a.kcal - b.kcal || b.proteinPer100 - a.proteinPer100
  })
}

// O prato escolhido como item de refeição (estimativa).
export function dishItem(d: Pick<Dish, 'name' | 'grams' | 'kcal' | 'protein' | 'carbs' | 'fat'>) {
  return {
    name: d.name,
    grams: d.grams ?? 0,
    kcal: d.kcal,
    protein: d.protein,
    carbs: d.carbs,
    fat: d.fat,
    food_id: null,
    estimated: true,
  }
}
