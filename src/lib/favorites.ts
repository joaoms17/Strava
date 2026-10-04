import { supabase } from './supabase'
import { prepareImage } from './image'
import { favoriteName } from '../../api/_lib/rules/favoritos'
import { mealTotals, type MealItem } from '../../api/_lib/rules/meal-totals'
import type { Meal, Slot } from './types'

// Refeições favoritas criadas no telemóvel (RLS): a partir de uma refeição
// registada ou de raiz (texto ou foto analisados pela IA), sempre com a foto
// em {uid}/fav/… — é essa foto que aparece sempre que a favorita é usada.

async function userId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  return user.id
}

// Foto nova de uma favorita: caminho novo de cada vez (as refeições antigas
// ficam com a foto que tinham).
export async function uploadFavoritePhoto(file: Blob, favoriteId: string): Promise<string> {
  const uid = await userId()
  const { full } = await prepareImage(file)
  const path = `${uid}/fav/${favoriteId}-${Date.now().toString(36)}.jpg`
  const { error } = await supabase.storage
    .from('meal-photos')
    .upload(path, full, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error('Não consegui enviar a foto. Tenta outra vez.')
  return path
}

export async function setFavoritePhoto(favoriteId: string, path: string | null): Promise<void> {
  const { error } = await supabase
    .from('favorites')
    .update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq('id', favoriteId)
  if (error) throw new Error('Não consegui guardar a foto.')
}

export async function insertFavorite(input: {
  id?: string
  name: string
  items: MealItem[]
  slot: Slot | null
  photoPath: string | null
  sourceMealId?: string | null
}): Promise<string> {
  const uid = await userId()
  const id = input.id ?? crypto.randomUUID()
  const totals = mealTotals(input.items)
  const { error } = await supabase.from('favorites').insert({
    id,
    user_id: uid,
    kind: 'meal',
    name: input.name.trim() || favoriteName(input.items),
    items: input.items,
    kcal: Math.round(totals.kcal),
    protein: totals.protein,
    carbs: totals.carbs,
    fat: totals.fat,
    photo_path: input.photoPath,
    default_slot: input.slot,
    source_meal_id: input.sourceMealId ?? null,
  })
  if (error) throw new Error('Não consegui guardar a favorita.')
  return id
}

// A partir de uma refeição registada: a foto é copiada para a pasta das
// favoritas (a da refeição pode ser apagada um dia).
export async function favoriteFromMeal(
  meal: Pick<Meal, 'id' | 'items' | 'photo_path' | 'photo_paths'>,
  name: string,
  slot: Slot | null,
): Promise<{ id: string; photoPath: string | null }> {
  const uid = await userId()
  const id = crypto.randomUUID()
  let photoPath: string | null = null
  const source = meal.photo_paths?.[0] ?? meal.photo_path
  if (source) {
    const target = `${uid}/fav/${id}.jpg`
    const { error } = await supabase.storage.from('meal-photos').copy(source, target)
    if (!error) photoPath = target
  }
  try {
    await insertFavorite({ id, name, items: meal.items, slot, photoPath, sourceMealId: meal.id })
  } catch (err) {
    if (photoPath) await supabase.storage.from('meal-photos').remove([photoPath])
    throw err
  }
  return { id, photoPath }
}

// Anular uma favorita acabada de criar.
export async function deleteFavorite(id: string, photoPath: string | null): Promise<void> {
  await supabase.from('favorites').delete().eq('id', id)
  if (photoPath) await supabase.storage.from('meal-photos').remove([photoPath])
}
