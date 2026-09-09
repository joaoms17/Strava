import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionDate } from './rules/plan-dates'

// Emparelha um workout com a planned_session do dia (mesmo tipo, +-1 dia).
// Nunca falha o registo do treino — erros ficam no log.
export async function pairWorkout(
  client: SupabaseClient,
  userId: string,
  workout: { id: string; date: string; type: string; planned_session_id: string | null },
): Promise<void> {
  try {
    if (workout.planned_session_id || workout.type === 'other') return

    const { data: blocks } = await client
      .from('plan_blocks')
      .select('id,start_date')
      .eq('user_id', userId)
      .eq('status', 'active')
    if (!blocks?.length) return

    const workoutMs = Date.parse(`${workout.date}T00:00:00Z`)
    let best: { id: string; diff: number } | null = null
    for (const block of blocks) {
      const { data: sessions } = await client
        .from('planned_sessions')
        .select('id,week,day_index,type,status')
        .eq('block_id', block.id)
        .eq('status', 'planned')
        .eq('type', workout.type)
      for (const session of sessions ?? []) {
        const date = sessionDate(block.start_date, session.week, session.day_index)
        const diff = Math.abs(Date.parse(`${date}T00:00:00Z`) - workoutMs) / 86_400_000
        if (diff <= 1 && (!best || diff < best.diff)) best = { id: session.id, diff }
      }
    }
    if (!best) return

    await client
      .from('planned_sessions')
      .update({ status: 'done', workout_id: workout.id })
      .eq('id', best.id)
    await client.from('workouts').update({ planned_session_id: best.id }).eq('id', workout.id)
  } catch (err) {
    console.error('pairWorkout falhou:', err)
  }
}
