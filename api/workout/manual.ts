import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { HttpError, requireUser } from '../_lib/supabase'
import { respondError } from '../_lib/http'
import { workoutKcal } from '../_lib/rules/targets'

const ManualWorkoutSchema = z.object({
  type: z.enum(['bike', 'strength', 'other']),
  minutes: z.number().int().min(1).max(600),
  watts: z.number().int().min(30).max(500).nullable().optional(),
  cadence: z.number().int().min(30).max(200).nullable().optional(),
})

function localCalendarDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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

    const { data: workout, error } = await db
      .from('workouts')
      .insert({
        user_id: user.id,
        date: localCalendarDate(),
        source: 'manual',
        type,
        minutes,
        watts,
        cadence: type === 'bike' ? (body.data.cadence ?? null) : null,
        kcal_est: workoutKcal({ type, minutes, watts, stravaCalories: null }),
      })
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    res.status(200).json({ workout })
  } catch (err) {
    respondError(res, err)
  }
}
