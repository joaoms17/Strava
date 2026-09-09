import type { SupabaseClient } from '@supabase/supabase-js'
import { round1, type MealItem } from './rules/meal-totals'

// Aprendizagem de porções: a porção habitual aproxima-se do que foi usado.
const PORTION_ALPHA = 0.3

function learnedPortion(current: number | null, usedGrams: number): number {
  if (current == null || current <= 0) return round1(usedGrams)
  return round1(current + PORTION_ALPHA * (usedGrams - current))
}

function per100(value: number, grams: number): number {
  return round1((value / grams) * 100)
}

// Depois de guardar uma refeição:
// - itens com food_id: use_count +1 e porção habitual ajustada;
// - itens novos de texto, não estimados: entram em foods com source 'claude'
//   (fotografia não cria alimentos — as estimativas poluíam a biblioteca).
export async function learnFoods(
  db: SupabaseClient,
  userId: string,
  items: MealItem[],
  inputType: string,
): Promise<void> {
  for (const item of items) {
    try {
      if (item.food_id) {
        const { data: food } = await db
          .from('foods')
          .select('id,use_count,default_portion_g')
          .eq('id', item.food_id)
          .maybeSingle()
        if (!food) continue
        await db
          .from('foods')
          .update({
            use_count: food.use_count + 1,
            default_portion_g: learnedPortion(food.default_portion_g, item.grams),
          })
          .eq('id', food.id)
        continue
      }

      if (inputType !== 'text' || item.estimated || item.grams <= 0) continue

      const pattern = item.name.trim().replace(/[%_]/g, '\\$&')
      if (!pattern) continue
      const { data: match } = await db
        .from('foods')
        .select('id,use_count,default_portion_g')
        .ilike('name', pattern)
        .limit(1)
        .maybeSingle()
      if (match) {
        await db
          .from('foods')
          .update({
            use_count: match.use_count + 1,
            default_portion_g: learnedPortion(match.default_portion_g, item.grams),
          })
          .eq('id', match.id)
      } else {
        await db.from('foods').insert({
          user_id: userId,
          name: item.name.trim(),
          default_portion_g: round1(item.grams),
          kcal_100g: per100(item.kcal, item.grams),
          protein_100g: per100(item.protein, item.grams),
          carbs_100g: per100(item.carbs, item.grams),
          fat_100g: per100(item.fat, item.grams),
          source: 'claude',
          use_count: 1,
        })
      }
    } catch (err) {
      // A aprendizagem nunca pode impedir o registo da refeição.
      console.error('learnFoods falhou para', item.name, err)
    }
  }
}
