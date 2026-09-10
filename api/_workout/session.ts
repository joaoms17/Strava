import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { HttpError, requireUser } from '../_lib/supabase.js'
import { respondError } from '../_lib/http.js'
import { workoutKcal } from '../_lib/rules/targets.js'
import { pairWorkout } from '../_lib/pairing.js'

const SetSchema = z.object({
  exercise: z.string().min(1),
  set_index: z.number().int().min(1).max(12),
  reps: z.number().int().min(0).max(50).nullable(),
  load_kg: z.number().min(0).max(300).nullable(),
  rpe: z.number().min(0).max(10).nullable(),
})

const SessionSchema = z.object({
  planned_session_id: z.string().uuid().nullable().optional(),
  minutes: z.number().int().min(5).max(240),
  sets: z.array(SetSchema).min(1).max(60),
})

function localCalendarDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// Sessão de força executada: cria o workout, grava as séries em exercise_log
// e marca a planned_session como feita.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método não suportado.')
    const { user, db } = await requireUser(req)

    const body = SessionSchema.safeParse(req.body)
    if (!body.success) throw new HttpError(400, 'Sessão inválida.')
    const { planned_session_id, minutes, sets } = body.data

    const { data: workout, error } = await db
      .from('workouts')
      .insert({
        user_id: user.id,
        date: localCalendarDate(),
        source: 'manual',
        type: 'strength',
        minutes,
        planned_session_id: planned_session_id ?? null,
        kcal_est: workoutKcal({ type: 'strength', minutes, watts: null, stravaCalories: null }),
      })
      .select()
      .single()
    if (error) throw new HttpError(500, error.message)

    const { error: logsError } = await db.from('exercise_log').insert(
      sets.map((s) => ({
        user_id: user.id,
        workout_id: workout.id,
        exercise: s.exercise,
        set_index: s.set_index,
        reps: s.reps,
        load_kg: s.load_kg,
        rpe: s.rpe,
      })),
    )
    if (logsError) throw new HttpError(500, logsError.message)

    if (planned_session_id) {
      await db
        .from('planned_sessions')
        .update({ status: 'done', workout_id: workout.id })
        .eq('id', planned_session_id)
    } else {
      await pairWorkout(db, user.id, workout)
    }

    res.status(200).json({ workout })
  } catch (err) {
    respondError(res, err)
  }
}
