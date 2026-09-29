import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { workoutKcal } from '../_lib/rules/targets.js'
import { nutritionalDay } from '../_lib/rules/nutritional-day.js'
import { pairWorkout } from '../_lib/pairing.js'

const ManualWorkoutSchema = z.object({
  type: z.enum(['bike', 'strength', 'other']),
  minutes: z.number().int().min(1).max(600),
  watts: z.number().int().min(30).max(500).nullable().optional(),
  cadence: z.number().int().min(30).max(200).nullable().optional(),
  sport: z.enum(['caminhada', 'eliptica', 'natacao', 'outro']).optional(),
})

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}


// Sessão manual em 3 toques — sem Strava tudo funciona.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const body = ManualWorkoutSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Sessão inválida.')
    const { type, minutes } = body.data
    const watts = type === 'bike' ? (body.data.watts ?? null) : null
    // O treino conta para o dia nutricional (04:00–04:00), como as refeições.
    const { data: profile } = await db.from('profile').select('nutrition_day_cutoff_hour').single()
    const today = nutritionalDay(new Date(), profile?.nutrition_day_cutoff_hour ?? 4)
    const sport = type === 'other' ? (body.data.sport ?? 'outro') : null

    // Treino «Outro» sem calorias do relógio: estima pelo peso médio dos últimos 7 dias.
    let weightKg: number | null = null
    if (type === 'other') {
      const { data: recent } = await db
        .from('weights')
        .select('kg')
        .gte('date', shiftDays(today, -6))
        .lte('date', today)
      if (recent?.length) weightKg = recent.reduce((acc, w) => acc + Number(w.kg), 0) / recent.length
      else {
        const { data: last } = await db
          .from('weights')
          .select('kg')
          .order('date', { ascending: false })
          .limit(1)
        weightKg = last?.[0] ? Number(last[0].kg) : null
      }
    }

    const { data: workout, error } = await db
      .from('workouts')
      .insert({
        user_id: user.id,
        date: today,
        source: 'manual',
        type,
        minutes,
        watts,
        cadence: type === 'bike' ? (body.data.cadence ?? null) : null,
        kcal_est: workoutKcal({ type, minutes, watts, deviceCalories: null, sport, weightKg }),
        raw: sport ? { sport } : null,
      })
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    await pairWorkout(db, user.id, workout)

    res.status(200).json({ workout })
  } catch (err) {
    respondError(res, err)
  }
}
