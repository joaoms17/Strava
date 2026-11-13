import { describe, expect, it } from 'vitest'
import { SaveSchema, StrengthSchema, UpdateSchema } from '../api/_workout/actions'

// L7: a dor no joelho saiu dos esquemas, mas um cliente antigo que ainda a
// mande não falha — os campos são ignorados (não chegam à base de dados).
describe('dor no joelho fora dos esquemas (L7)', () => {
  const id = '00000000-0000-4000-8000-000000000001'

  it('guardar um treino com pain_during: aceita e ignora', () => {
    const parsed = SaveSchema.parse({ client_id: id, type: 'bike', minutes: 30, pain_during: 3 })
    expect(parsed).not.toHaveProperty('pain_during')
    expect(parsed.minutes).toBe(30)
  })

  it('editar com pain_during e pain_next_day: aceita e ignora', () => {
    const parsed = UpdateSchema.parse({ workout_id: id, minutes: 40, pain_during: 2, pain_next_day: 7 })
    expect(parsed).not.toHaveProperty('pain_during')
    expect(parsed).not.toHaveProperty('pain_next_day')
    expect(parsed.minutes).toBe(40)
  })

  it('ginásio com pain_during: aceita e ignora', () => {
    const parsed = StrengthSchema.parse({ client_id: id, minutes: 45, sets: [], pain_during: 1 })
    expect(parsed).not.toHaveProperty('pain_during')
  })
})
