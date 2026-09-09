import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { HttpError, requireUser } from '../_lib/supabase'
import { respondError } from '../_lib/http'
import { painStatus } from '../_lib/rules/semaforo'
import { workoutKcal, type WorkoutType } from '../_lib/rules/targets'

const CheckinSchema = z.object({
  workout_id: z.string().uuid(),
  pain_during: z.number().int().min(0).max(10).nullable().optional(),
  pain_next_day: z.number().int().min(0).max(10).nullable().optional(),
  // dados da sessão de bike vindos da consola/relógio — sem Strava, é aqui
  // que entram os valores de que a regra 10 precisa
  watts: z.number().int().min(30).max(500).nullable().optional(),
  avg_hr: z.number().int().min(40).max(230).nullable().optional(),
  max_hr: z.number().int().min(40).max(240).nullable().optional(),
  cadence: z.number().int().min(30).max(200).nullable().optional(),
})

// Check-in de dor (regra 9) e confirmação de watts. O semáforo e as kcal
// recalculam-se sempre no servidor.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { db } = await requireUser(req)

    const body = CheckinSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Check-in inválido.')
    const { workout_id, pain_during, pain_next_day, watts, avg_hr, max_hr, cadence } = body.data

    const { data: workout, error: findError } = await db
      .from('workouts')
      .select('*')
      .eq('id', workout_id)
      .maybeSingle()
    if (findError || !workout) throw new HttpError(404, 'Sessão não encontrada.')

    const patch: Record<string, unknown> = {}
    if (pain_during !== undefined) patch.pain_during = pain_during
    if (pain_next_day !== undefined) patch.pain_next_day = pain_next_day
    if (workout.type === 'bike') {
      if (avg_hr !== undefined) patch.avg_hr = avg_hr
      if (max_hr !== undefined) patch.max_hr = max_hr
      if (cadence !== undefined) patch.cadence = cadence
      if (watts !== undefined) {
        patch.watts = watts
        patch.kcal_est = workoutKcal({
          type: workout.type as WorkoutType,
          minutes: workout.minutes,
          watts,
          stravaCalories: null,
        })
      }
    }

    patch.status = painStatus(
      (patch.pain_during ?? workout.pain_during) as number | null,
      (patch.pain_next_day ?? workout.pain_next_day) as number | null,
    )

    const { data: updated, error } = await db
      .from('workouts')
      .update(patch)
      .eq('id', workout_id)
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    res.status(200).json({ workout: updated })
  } catch (err) {
    respondError(res, err)
  }
}
