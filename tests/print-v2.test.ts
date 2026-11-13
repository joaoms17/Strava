import { describe, expect, it } from 'vitest'
import { WorkoutShotAiSchema, WorkoutShotSchema, fullShot } from '../api/_lib/schemas'
import { PROMPT_WORKOUT_SHOT, readPrompt } from '../api/_lib/prompts'
import { outputSchema } from '../api/_lib/rules/resposta-ia'

// T18: o que se lia dos prints e nunca se mostrava deixa de se pedir à IA.
describe('leitura dos prints v2 (T18)', () => {
  const dropped = ['np_w', 'max_power_w', 'max_cadence', 'anaerobic_te', 'laps']

  it('o schema pedido à IA não tem os campos que não se mostram', () => {
    const json = outputSchema(WorkoutShotAiSchema) as { properties: { activity: { properties: Record<string, unknown> } } }
    for (const field of dropped) expect(json.properties.activity.properties[field]).toBeUndefined()
    expect(json.properties.activity.properties.avg_power_w).toBeDefined()
    expect(JSON.stringify(json)).not.toMatch(/"np_w"|"max_cadence"/)
  })

  it('a leitura guardada fica com a forma completa (campos vazios)', () => {
    const ai = WorkoutShotAiSchema.parse({
      images: [{ index: 0, app: 'garmin_connect', screen: 'summary', date_shown: null }],
      same_activity: true,
      mismatch_reason: null,
      activity: {
        sport: 'indoor_bike',
        sport_label_raw: null,
        title: null,
        date: '2026-11-12',
        start_time: '07:10',
        total_time_s: 2700,
        moving_time_s: 2700,
        distance_km: null,
        avg_hr: 128,
        max_hr: 141,
        avg_power_w: 140,
        avg_cadence: 85,
        calories_device: 420,
        elevation_gain_m: null,
        aerobic_te: 2.8,
        training_load: null,
        training_load_kind: null,
        rpe: null,
        hr_zones: [],
        strength_sets: [],
      },
      field_confidence: [{ field: 'avg_hr', confidence: 'alta', image_index: 0 }],
      notes: null,
    })
    const full = WorkoutShotSchema.parse(fullShot(ai))
    expect(full.activity.laps).toEqual([])
    expect(full.activity.np_w).toBeNull()
    expect(full.activity.avg_power_w).toBe(140)
  })

  it('o prompt em uso é a v2 e não pede as voltas', () => {
    expect(PROMPT_WORKOUT_SHOT).toBe('workout-shot.v2.md')
    const text = readPrompt(PROMPT_WORKOUT_SHOT)
    expect(text).not.toMatch(/`laps`|`np_w`|`max_cadence`|`anaerobic_te`|`max_power_w`/)
  })
})
