import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { adminClient, HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { MODELS, NO_THINKING, REQUEST_VISION, structuredCall } from '../_lib/anthropic.js'
import { PROMPT_MENU_PICK, promptVersion, readPrompt } from '../_lib/prompts.js'
import { aiLimitReached } from '../_lib/meal-analysis.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { isMaintenanceWeek } from '../_lib/rules/manutencao.js'
import { storedExerciseKcal, type WorkoutType } from '../_lib/rules/targets.js'
import { MAX_DISHES, MENU_TYPES, cleanMenu, dayLeft, rankDishes } from '../_lib/rules/menu.js'

// ＋ › «Escolher pelo menu»: a pessoa fotografa o menu (até 3 fotos) e a IA
// estima cada prato; a app mostra os 3 melhores para o que falta comer hoje
// (calorias e proteína) e os outros por baixo. Não grava nada: «Vou comer
// este» grava pelo /api/meal/save.

// As fotos (JPEG até 2048 px) sobem antes para o Storage, em <user>/menu/:
// no corpo do pedido não caberiam (o Vercel corta acima de 4,5 MB e o
// iPhone só diz «Load failed»). Depois de lidas, apagam-se.
const Body = z.object({
  photo_paths: z.array(z.string().max(200)).min(1).max(3),
  note: z.string().trim().max(300).optional(),
})

const AiSchema = z.object({
  e_menu: z.boolean(),
  motivo: z.string().nullable(),
  pratos: z.array(
    z.object({
      nome: z.string(),
      tipo: z.enum(MENU_TYPES),
      descricao: z.string().nullable(),
      gramas: z.number().nullable(),
      kcal: z.number(),
      proteina: z.number(),
      hidratos: z.number(),
      gordura: z.number(),
      preco: z.number().nullable(),
    }),
  ),
})

export default async function menu(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)
    const body = Body.safeParse(req.body ?? {})
    if (!body.success) throw new HttpError(400, 'Tira uma foto ao menu (até 3).')
    const { photo_paths: paths, note } = body.data
    // O download usa service role (o bucket é privado): só fotos da pessoa.
    if (paths.some((p) => !p.startsWith(`${user.id}/menu/`) || p.includes('..'))) {
      throw new HttpError(403, 'Foto inválida.')
    }

    const admin = adminClient()
    try {
      res.status(200).json(await pick(admin, db, user.id, paths, note))
    } finally {
      await admin.storage.from('meal-photos').remove(paths).catch(() => undefined)
    }
  } catch (err) {
    respondError(res, err)
  }
}

async function pick(
  admin: SupabaseClient,
  db: SupabaseClient,
  userId: string,
  paths: string[],
  note: string | undefined,
) {
  if (await aiLimitReached(admin, userId, true)) {
    throw new HttpError(429, 'Chegaste ao limite da IA (Definições › Avançado).')
  }
  const photos = await Promise.all(
    paths.map(async (path) => {
      const { data: blob, error } = await admin.storage.from('meal-photos').download(path)
      if (error || !blob) throw new HttpError(404, 'Não encontrei a foto do menu. Tenta outra vez.')
      return Buffer.from(await blob.arrayBuffer()).toString('base64')
    }),
  )

  const { data: profile } = await db
    .from('profile')
    .select('base_kcal,protein_g,nutrition_day_cutoff_hour,maintenance_enabled,maintenance_anchor')
    .single()
  if (!profile) throw new HttpError(400, 'Perfil não encontrado.')
  const today = nutritionalDay(new Date(), Number(profile.nutrition_day_cutoff_hour ?? 4))

  const [{ output, model, cost }, meals, workouts, tdee] = await Promise.all([
    structuredCall(
      admin,
      { userId, kind: 'menu_pick', request: REQUEST_VISION },
      {
        model: MODELS.vision,
        max_tokens: 8000,
        thinking: NO_THINKING,
        system: readPrompt(PROMPT_MENU_PICK),
        messages: [
          {
            role: 'user',
            content: [
              ...photos.map((data) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
              })),
              { type: 'text' as const, text: JSON.stringify({ preferencias: note || null }) },
            ],
          },
        ],
      },
      AiSchema,
    ),
    db.from('meals_counted').select('kcal,protein').eq('date', today),
    db.from('workouts_active').select('type,minutes,watts,raw,kcal_est').eq('date', today),
    db
      .from('days')
      .select('tdee_est')
      .lt('date', today)
      .not('tdee_est', 'is', null)
      .order('date', { ascending: false })
      .limit(1),
  ])

  const dishes = output.e_menu ? cleanMenu(output.pratos) : []
  if (dishes.length === 0) {
    throw new HttpError(422, output.motivo?.trim() || 'Não consegui ler pratos nesta foto. Tira outra mais perto.')
  }

  const exerciseKcal = storedExerciseKcal(
    (workouts.data ?? []).map((w) => ({
      type: w.type as WorkoutType,
      minutes: w.minutes as number | null,
      watts: w.watts as number | null,
      deviceCalories:
        typeof (w.raw as { calories?: unknown } | null)?.calories === 'number'
          ? (w.raw as { calories: number }).calories
          : null,
      kcal_est: w.kcal_est as number | null,
    })),
  )
  const counted = meals.data ?? []
  const left = dayLeft({
    baseKcal: Number(profile.base_kcal),
    exerciseKcal,
    maintenance:
      profile.maintenance_enabled !== false &&
      profile.maintenance_anchor != null &&
      isMaintenanceWeek(profile.maintenance_anchor as string, today),
    tdee: tdee.data?.[0]?.tdee_est != null ? Number(tdee.data[0].tdee_est) : null,
    kcalIn: counted.reduce((a, m) => a + Number(m.kcal), 0),
    proteinIn: counted.reduce((a, m) => a + Number(m.protein), 0),
    proteinTarget: profile.protein_g != null ? Number(profile.protein_g) : null,
  })
  const ranked = rankDishes(dishes, left.kcal)

  return {
    today,
    kcal_left: left.kcal,
    protein_left: left.protein,
    ranked,
    // Os que não entram na escolha (bebidas, sobremesas…), para a lista toda.
    others: dishes.filter((d) => !ranked.some((r) => r.name === d.name)).slice(0, MAX_DISHES),
    prompt_version: promptVersion(PROMPT_MENU_PICK),
    model,
    cost_usd: cost,
  }
}
