import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, requireUser } from '../../_lib/supabase'
import { respondError } from '../../_lib/http'
import { round1 } from '../../_lib/rules/meal-totals'

const OFF_USER_AGENT = 'EpocaDoRegresso/0.1 (https://github.com/joaoms17/Strava)'

interface OffProduct {
  product_name?: string
  product_name_pt?: string
  brands?: string
  serving_quantity?: number | string
  nutriments?: Record<string, number | string>
}

function nutriment(product: OffProduct, key: string): number {
  const value = Number(product.nutriments?.[key])
  return Number.isFinite(value) && value >= 0 ? round1(value) : 0
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const ean = String(req.query.ean ?? '')
    if (!/^\d{8,14}$/.test(ean)) throw new HttpError(400, 'Código de barras inválido.')

    // Já conhecido? Devolve o alimento pessoal sem ir ao Open Food Facts.
    const { data: existing } = await db.from('foods').select('*').eq('barcode', ean).maybeSingle()
    if (existing) {
      res.status(200).json({ food: existing, from: 'pessoal' })
      return
    }

    const offRes = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_pt,brands,serving_quantity,nutriments`,
      { headers: { 'User-Agent': OFF_USER_AGENT } },
    )
    if (offRes.status === 404) throw new HttpError(404, 'Produto não encontrado no Open Food Facts.')
    if (!offRes.ok) throw new HttpError(502, 'O Open Food Facts não respondeu. Tenta outra vez.')
    const json = (await offRes.json()) as { status?: number | string; product?: OffProduct }
    const product = json.product
    if (!product || json.status === 0) {
      throw new HttpError(404, 'Produto não encontrado no Open Food Facts.')
    }

    // kcal por 100 g; alguns produtos só têm energia em kJ.
    let kcal100 = Number(product.nutriments?.['energy-kcal_100g'])
    if (!Number.isFinite(kcal100)) {
      const kj = Number(product.nutriments?.['energy_100g'])
      kcal100 = Number.isFinite(kj) ? kj / 4.184 : NaN
    }
    if (!Number.isFinite(kcal100)) {
      throw new HttpError(422, 'O produto existe mas não tem informação nutricional.')
    }

    const name =
      [product.product_name_pt || product.product_name, product.brands?.split(',')[0]?.trim()]
        .filter(Boolean)
        .join(' — ') || `EAN ${ean}`
    const serving = Number(product.serving_quantity)

    const { data: food, error } = await db
      .from('foods')
      .insert({
        user_id: user.id,
        name,
        default_portion_g: Number.isFinite(serving) && serving > 0 ? round1(serving) : null,
        kcal_100g: round1(kcal100),
        protein_100g: nutriment(product, 'proteins_100g'),
        carbs_100g: nutriment(product, 'carbohydrates_100g'),
        fat_100g: nutriment(product, 'fat_100g'),
        source: 'off',
        barcode: ean,
      })
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    res.status(200).json({ food, from: 'off' })
  } catch (err) {
    respondError(res, err)
  }
}
