import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError, requireUser } from '../_lib/supabase'
import { respondError } from '../_lib/http'
import { SaveMealSchema } from '../_lib/schemas'
import { nutritionalDay } from '../_lib/rules/nutritional-day'
import { mealTotals } from '../_lib/rules/meal-totals'
import { learnFoods } from '../_lib/foods'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const body = SaveMealSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Refeição inválida.')
    const meal = body.data

    // O dia nutricional (regra 1) e os totais calculam-se sempre no servidor.
    const { data: profile } = await db
      .from('profile')
      .select('nutrition_day_cutoff_hour')
      .single()
    const cutoff = profile?.nutrition_day_cutoff_hour ?? 4
    // A fila offline envia o logged_at original; sem ele conta o momento atual.
    // Nunca aceitar datas no futuro.
    const loggedMs = meal.logged_at ? Date.parse(meal.logged_at) : NaN
    const loggedAt =
      Number.isFinite(loggedMs) && loggedMs <= Date.now() ? new Date(loggedMs) : new Date()
    const date = nutritionalDay(loggedAt, cutoff)
    const totals = mealTotals(meal.items)

    const { data: saved, error } = await db
      .from('meals')
      .insert({
        user_id: user.id,
        date,
        logged_at: loggedAt.toISOString(),
        input_type: meal.input_type,
        raw_text: meal.raw_text ?? null,
        photo_path: meal.photo_path ?? null,
        items: meal.items,
        kcal: totals.kcal,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        is_estimate: meal.is_estimate || meal.items.some((i) => i.estimated),
        confidence: meal.confidence ?? null,
        prompt_version: meal.prompt_version ?? null,
        model: meal.model ?? null,
        cost_usd: meal.cost_usd ?? null,
      })
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    await learnFoods(db, user.id, meal.items, meal.input_type)

    res.status(200).json({ meal: saved })
  } catch (err) {
    respondError(res, err)
  }
}
