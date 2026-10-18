// Produtos de marca (Open Food Facts e rótulos): o produto do código de
// barras, os resultados da pesquisa pelo nome e o rótulo lido pela IA passam
// a um alimento da biblioteca, com valores por 100 g plausíveis. Sem
// supabase nem node.
import { round1 } from './meal-totals.js'
import { implausibleItem } from './analise.js'

// O Open Food Facts pede um User-Agent que identifique a app.
export const OFF_USER_AGENT = 'EpocaDoRegresso/0.2 (https://github.com/joaoms17/strava)'

export const NUTRISCORES = ['a', 'b', 'c', 'd', 'e'] as const
export type NutriScore = (typeof NUTRISCORES)[number]

// O que fica em foods (as colunas extra vêm da migração de 18/10; sem ela
// gravam-se só as calorias e os macros).
export interface FoodValues {
  name: string
  default_portion_g: number | null
  kcal_100g: number
  protein_100g: number
  carbs_100g: number
  fat_100g: number
  fiber_100g: number | null
  sugars_100g: number | null
  sat_fat_100g: number | null
  salt_100g: number | null
  nutriscore: NutriScore | null
  serving_label: string | null
}

export const EXTRA_FOOD_COLUMNS = ['fiber_100g', 'sugars_100g', 'sat_fat_100g', 'salt_100g', 'nutriscore', 'serving_label'] as const

function num(v: unknown, max: number, digits = 1): number | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

const clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''

// Texto de um campo que pode vir como texto, lista ou por língua ({pt, main, en}).
function pickText(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(pickText).find(Boolean) ?? ''
  if (v && typeof v === 'object') {
    const byLang = v as Record<string, unknown>
    for (const lang of ['pt', 'main', 'en']) {
      const text = pickText(byLang[lang])
      if (text) return text
    }
    return Object.values(byLang).map(pickText).find(Boolean) ?? ''
  }
  return ''
}

// kcal por 100 g; alguns produtos só têm a energia em kJ.
function kcalOf(nutriments: Record<string, unknown>): number | null {
  const kcal = num(nutriments['energy-kcal_100g'], 900)
  if (kcal != null) return kcal
  const kj = num(nutriments['energy-kj_100g'], 3800) ?? num(nutriments['energy_100g'], 3800)
  return kj != null ? round1(kj / 4.184) : null
}

export interface OffProduct {
  product_name?: unknown
  product_name_pt?: unknown
  brands?: unknown
  serving_quantity?: unknown
  serving_size?: unknown
  nutriscore_grade?: unknown
  nutriments?: Record<string, unknown>
}

export function productName(product: OffProduct, fallback: string): string {
  const name = pickText(product.product_name_pt) || pickText(product.product_name)
  const brand = pickText(product.brands).split(',')[0]?.trim()
  return clip([name, brand].filter(Boolean).join(' — '), 120) || fallback
}

// Um produto do Open Food Facts como alimento; null sem informação nutricional.
export function offFood(product: OffProduct, ean: string): FoodValues | null {
  const nutriments = product.nutriments ?? {}
  const kcal = kcalOf(nutriments)
  if (kcal == null) return null
  const salt = num(nutriments.salt_100g, 100, 2)
  const sodium = num(nutriments.sodium_100g, 40, 3)
  const grade = clip(product.nutriscore_grade, 1).toLowerCase()
  return {
    name: productName(product, `EAN ${ean}`),
    default_portion_g: num(product.serving_quantity, 2000) || null,
    kcal_100g: kcal,
    protein_100g: num(nutriments.proteins_100g, 100) ?? 0,
    carbs_100g: num(nutriments.carbohydrates_100g, 100) ?? 0,
    fat_100g: num(nutriments.fat_100g, 100) ?? 0,
    fiber_100g: num(nutriments.fiber_100g, 100),
    sugars_100g: num(nutriments.sugars_100g, 100),
    sat_fat_100g: num(nutriments['saturated-fat_100g'], 100),
    // Sem sal, o sódio × 2,5.
    salt_100g: salt ?? (sodium != null ? Math.round(sodium * 250) / 100 : null),
    nutriscore: (NUTRISCORES as readonly string[]).includes(grade) ? (grade as NutriScore) : null,
    serving_label: clip(product.serving_size, 40) || null,
  }
}

// ---------------------------------------------------------------------
// Pesquisa pelo nome (só ao carregar em «Procurar»; no máximo 10 por minuto
// no Open Food Facts, por isso com cache e limite no servidor).
// ---------------------------------------------------------------------
export interface OffHit {
  code: string
  name: string
  kcal_100g: number | null
  protein_100g: number | null
}

export const SEARCH_MIN_CHARS = 3
export const SEARCH_MAX_CHARS = 80

// A chave da cache: sem acentos, minúsculas, espaços simples.
export function searchKey(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%.,' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_MAX_CHARS)
}

// Os resultados da pesquisa (search.openfoodfacts.org devolve `hits`, a
// pesquisa antiga `products`): código válido e nome, sem repetidos.
export function offSearchResults(json: unknown, max = 10): OffHit[] {
  const body = (json ?? {}) as { hits?: unknown; products?: unknown }
  const list = Array.isArray(body.hits) ? body.hits : Array.isArray(body.products) ? body.products : []
  const seen = new Set<string>()
  const out: OffHit[] = []
  for (const raw of list as (OffProduct & { code?: unknown })[]) {
    if (!raw || typeof raw !== 'object') continue
    const code = String(raw.code ?? '').replace(/\D/g, '')
    if (!/^\d{8,14}$/.test(code) || seen.has(code)) continue
    const name = productName(raw, '')
    if (!name) continue
    seen.add(code)
    const nutriments = raw.nutriments && typeof raw.nutriments === 'object' ? raw.nutriments : {}
    out.push({ code, name, kcal_100g: kcalOf(nutriments), protein_100g: num(nutriments.proteins_100g, 100) })
    if (out.length >= max) break
  }
  return out
}

// ---------------------------------------------------------------------
// Rótulo lido pela IA (o produto não está no Open Food Facts): valores por
// 100 g. Um rótulo ilegível ou com números impossíveis não entra.
// ---------------------------------------------------------------------
export interface LabelRead {
  legivel: boolean
  nome: string | null
  marca: string | null
  kcal_100g: number | null
  proteina_100g: number | null
  hidratos_100g: number | null
  gordura_100g: number | null
  fibra_100g: number | null
  acucares_100g: number | null
  saturada_100g: number | null
  sal_100g: number | null
  dose_g: number | null
}

export function labelFood(raw: LabelRead, fallbackName: string): FoodValues | null {
  if (!raw.legivel) return null
  const protein = num(raw.proteina_100g, 100) ?? 0
  const carbs = num(raw.hidratos_100g, 100) ?? 0
  const fat = num(raw.gordura_100g, 100) ?? 0
  const kcal = num(raw.kcal_100g, 900) ?? (protein + carbs + fat > 0 ? round1(4 * protein + 4 * carbs + 9 * fat) : null)
  if (kcal == null || protein + carbs + fat > 105) return null
  if (implausibleItem({ grams: 100, kcal, protein, carbs, fat })) return null
  const sugars = num(raw.acucares_100g, 100)
  const satFat = num(raw.saturada_100g, 100)
  return {
    name: clip([raw.nome, raw.marca].filter(Boolean).join(' — '), 120) || fallbackName,
    default_portion_g: num(raw.dose_g, 2000) || null,
    kcal_100g: kcal,
    protein_100g: protein,
    carbs_100g: carbs,
    fat_100g: fat,
    fiber_100g: num(raw.fibra_100g, 100),
    // Os açúcares fazem parte dos hidratos e a saturada da gordura.
    sugars_100g: sugars != null && sugars <= carbs + 0.5 ? sugars : null,
    sat_fat_100g: satFat != null && satFat <= fat + 0.5 ? satFat : null,
    salt_100g: num(raw.sal_100g, 100, 2),
    nutriscore: null,
    serving_label: null,
  }
}

// Sem a migração, as colunas extra não existem: grava-se só o essencial.
export function withoutExtras<T extends Record<string, unknown>>(row: T): Partial<T> {
  const copy: Record<string, unknown> = { ...row }
  for (const column of EXTRA_FOOD_COLUMNS) delete copy[column]
  return copy as Partial<T>
}
