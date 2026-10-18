import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_LABEL_READ, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import {
  OFF_USER_AGENT,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  labelFood,
  offFood,
  offSearchResults,
  searchKey,
  withoutExtras,
  type FoodValues,
  type OffHit,
  type OffProduct,
} from '../_lib/rules/off.js'

// Produtos de marca, sem IA sempre que possível:
// - GET /api/food/barcode/:ean — primeiro os alimentos da pessoa, depois os
//   das outras pessoas da casa (copiado para a conta de quem lê), por fim o
//   Open Food Facts (com fibra, açúcares, saturada, sal, Nutri-Score e dose);
// - POST /api/meal/label — o produto não está no Open Food Facts: a IA lê a
//   foto do rótulo e o alimento fica ligado ao código (a leitura seguinte é
//   logo, também para a outra pessoa);
// - GET /api/meal/food-search?q= — pesquisa pelo nome no Open Food Facts, só
//   ao carregar em «Procurar», com cache e no máximo 5 pesquisas por minuto
//   (o Open Food Facts aceita 10 por minuto por IP).

const EAN = /^\d{8,14}$/
const BASIC_COLUMNS = 'name,default_portion_g,kcal_100g,protein_100g,carbs_100g,fat_100g,source'
const FOOD_COLUMNS = `${BASIC_COLUMNS},fiber_100g,sugars_100g,sat_fat_100g,salt_100g,nutriscore,serving_label`

async function fetchJson(url: string, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers: { 'User-Agent': OFF_USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) })
  return { status: res.status, json: res.ok ? await res.json().catch(() => null) : null }
}

// Grava o alimento na conta de quem lê. Sem a migração das colunas extra,
// grava só o essencial; dois pedidos ao mesmo tempo ficam com o primeiro.
async function saveFood(
  db: SupabaseClient,
  userId: string,
  ean: string,
  values: FoodValues | Record<string, unknown>,
  source: 'off' | 'user',
  replace = false,
): Promise<Record<string, unknown>> {
  const row = { user_id: userId, ...values, source, barcode: ean }
  const write = async (data: Record<string, unknown>) => {
    if (replace) {
      const { data: updated } = await db.from('foods').update(data).eq('barcode', ean).select()
      if (updated?.[0]) return { data: updated[0] as Record<string, unknown>, error: null }
    }
    return db.from('foods').insert(data).select().single()
  }
  let { data, error } = await write(row)
  if (error && (error.code === '42703' || error.code === 'PGRST204')) ({ data, error } = await write(withoutExtras(row)))
  if (error?.code === '23505') {
    const { data: existing } = await db.from('foods').select('*').eq('barcode', ean).maybeSingle()
    if (existing) return existing as Record<string, unknown>
  }
  if (error || !data) throw new HttpError(500, error?.message ?? 'Não consegui guardar o produto.')
  return data
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const ean = String(req.query.ean ?? '')
    if (!EAN.test(ean)) throw new HttpError(400, 'Código de barras inválido.')

    // Já conhecido? Devolve o alimento pessoal sem ir ao Open Food Facts.
    const { data: existing } = await db.from('foods').select('*').eq('barcode', ean).maybeSingle()
    if (existing) {
      res.status(200).json({ food: existing, from: 'pessoal' })
      return
    }

    // Outra pessoa da casa já o leu (ou fotografou o rótulo): copia para esta.
    const admin = adminClient()
    const household = (columns: string) =>
      admin
        .from('foods')
        .select(columns)
        .eq('barcode', ean)
        .neq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
    let found = await household(FOOD_COLUMNS)
    // Sem a migração das colunas extra, só o essencial.
    if (found.error) found = await household(BASIC_COLUMNS)
    const known = (found.data?.[0] ?? null) as Record<string, unknown> | null
    if (known) {
      const { source, ...values } = known
      const food = await saveFood(db, user.id, ean, values, source === 'user' ? 'user' : 'off')
      res.status(200).json({ food, from: 'casa' })
      return
    }

    const fields = 'product_name,product_name_pt,brands,serving_quantity,serving_size,nutriscore_grade,nutriments'
    let off: { status: number; json: unknown }
    try {
      off = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=${fields}`, 10_000)
    } catch {
      throw new HttpError(502, 'O Open Food Facts não respondeu. Tenta outra vez.')
    }
    if (off.status === 404) throw new HttpError(404, 'Este produto não está no Open Food Facts.')
    if (off.status < 200 || off.status >= 300) throw new HttpError(502, 'O Open Food Facts não respondeu. Tenta outra vez.')
    const json = (off.json ?? {}) as { status?: number | string; product?: OffProduct }
    if (!json.product || json.status === 0) throw new HttpError(404, 'Este produto não está no Open Food Facts.')

    const values = offFood(json.product, ean)
    if (!values) throw new HttpError(422, 'O produto está no Open Food Facts, mas sem a tabela nutricional.')
    const food = await saveFood(db, user.id, ean, values, 'off')
    res.status(200).json({ food, from: 'off' })
  } catch (err) {
    respondError(res, err)
  }
}

// ---------------------------------------------------------------------
// Rótulo fotografado: a foto (JPEG até 2048 px) sobe antes para
// <user>/rotulo/ e apaga-se depois de lida.
// ---------------------------------------------------------------------
const LabelBody = z.object({
  ean: z.string().regex(EAN),
  photo_path: z.string().max(200),
  name: z.string().trim().max(80).optional(),
})

const n = () => z.number().nullable()
const LabelSchema = z.object({
  legivel: z.boolean(),
  nome: z.string().nullable(),
  marca: z.string().nullable(),
  kcal_100g: n(),
  proteina_100g: n(),
  hidratos_100g: n(),
  gordura_100g: n(),
  fibra_100g: n(),
  acucares_100g: n(),
  saturada_100g: n(),
  sal_100g: n(),
  dose_g: n(),
})

export async function label(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = LabelBody.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Pedido inválido.')
    const { ean, photo_path: path, name } = body.data
    // O download usa service role (o bucket é privado): só fotos da pessoa.
    if (!path.startsWith(`${user.id}/rotulo/`) || path.includes('..')) throw new HttpError(403, 'Foto inválida.')

    const admin = adminClient()
    try {
      if (await aiLimitReached(admin, user.id, true)) {
        throw new HttpError(429, 'Chegaste ao limite da IA (Definições › Avançado).')
      }
      const { data: blob, error } = await admin.storage.from('meal-photos').download(path)
      if (error || !blob) throw new HttpError(404, 'Não encontrei a foto do rótulo. Tenta outra vez.')
      const { output } = await structuredCall(
        admin,
        { userId: user.id, kind: 'label_read', request: REQUEST_VISION },
        {
          model: MODELS.vision,
          max_tokens: 1024,
          thinking: NO_THINKING,
          system: readPrompt(PROMPT_LABEL_READ),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: Buffer.from(await blob.arrayBuffer()).toString('base64'),
                  },
                },
                { type: 'text', text: JSON.stringify({ nome_escrito: name || null }) },
              ],
            },
          ],
        },
        LabelSchema,
      )
      const values = labelFood(output, name || `Produto ${ean}`)
      if (!values) {
        throw new HttpError(422, 'Não consegui ler a tabela nutricional. Tira outra foto, de frente e com luz.')
      }
      if (name) values.name = name
      // Um rótulo lido à mão manda: substitui o que houvesse com este código.
      const food = await saveFood(db, user.id, ean, values, 'user', true)
      res.status(200).json({ food })
    } finally {
      await admin.storage.from('meal-photos').remove([path]).catch(() => undefined)
    }
  } catch (err) {
    respondError(res, err)
  }
}

// ---------------------------------------------------------------------
// Pesquisa pelo nome: cache na memória da função e em off_searches (7 dias),
// e um limite partilhado pelas pessoas da casa. Cada pesquisa faz no máximo
// 2 pedidos (a nova e, sem resultados, a antiga): 5 por minuto ficam dentro
// dos 10 do Open Food Facts.
// ---------------------------------------------------------------------
const CACHE_MS = 7 * 86_400_000
const SEARCHES_PER_MINUTE = 5
const memory = new Map<string, { at: number; results: OffHit[] }>()
const recent: number[] = []

async function searchOff(query: string): Promise<OffHit[]> {
  const q = encodeURIComponent(query)
  const fields = 'code,product_name,product_name_pt,brands,nutriments'
  try {
    const found = await fetchJson(`https://search.openfoodfacts.org/search?q=${q}&langs=pt,en&page_size=15&fields=${fields}`, 8_000)
    const hits = found.status >= 200 && found.status < 300 ? offSearchResults(found.json) : []
    if (hits.length) return hits
  } catch {
    // tenta a pesquisa antiga
  }
  const old = await fetchJson(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=15&fields=${fields}`,
    8_000,
  )
  if (old.status === 429 || old.status === 503) throw new HttpError(503, 'O Open Food Facts está ocupado. Tenta daqui a um minuto.')
  if (old.status < 200 || old.status >= 300) throw new HttpError(502, 'O Open Food Facts não respondeu. Tenta outra vez.')
  return offSearchResults(old.json)
}

export async function foodSearch(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    await requireUser(req)
    const key = searchKey(String(req.query.q ?? ''))
    if (key.length < SEARCH_MIN_CHARS) throw new HttpError(400, 'Escreve pelo menos 3 letras.')
    if (key.length > SEARCH_MAX_CHARS) throw new HttpError(400, 'Escreve um nome mais curto.')
    const now = Date.now()

    const cached = memory.get(key)
    if (cached && now - cached.at < CACHE_MS) {
      res.status(200).json({ results: cached.results })
      return
    }
    const admin = adminClient()
    const { data: stored, error: storeError } = await admin
      .from('off_searches')
      .select('results,fetched_at')
      .eq('q', key)
      .maybeSingle()
    if (stored && now - Date.parse(stored.fetched_at as string) < CACHE_MS) {
      const results = stored.results as OffHit[]
      memory.set(key, { at: now, results })
      res.status(200).json({ results })
      return
    }

    // Limite: as pesquisas feitas no último minuto (na cache, ou nesta função
    // quando a tabela não existe).
    while (recent.length && now - recent[0]! > 60_000) recent.shift()
    let lastMinute = recent.length
    if (!storeError) {
      const { count } = await admin
        .from('off_searches')
        .select('q', { count: 'exact', head: true })
        .gte('fetched_at', new Date(now - 60_000).toISOString())
      lastMinute = Math.max(lastMinute, count ?? 0)
    }
    if (lastMinute >= SEARCHES_PER_MINUTE) {
      throw new HttpError(429, 'Muitas pesquisas seguidas. Espera um minuto e tenta outra vez.')
    }
    recent.push(now)

    let results: OffHit[]
    try {
      results = await searchOff(key)
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(502, 'O Open Food Facts não respondeu. Tenta outra vez.')
    }
    memory.set(key, { at: now, results })
    if (memory.size > 200) memory.delete(memory.keys().next().value!)
    if (!storeError) {
      await admin.from('off_searches').upsert({ q: key, results, fetched_at: new Date(now).toISOString() })
    }
    res.status(200).json({ results })
  } catch (err) {
    respondError(res, err)
  }
}
