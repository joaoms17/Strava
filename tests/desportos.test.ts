import { describe, expect, it } from 'vitest'
import { NET_METS, OTHER_SPORTS, SPORT_LABEL, isOtherSport, workoutKcal } from '../api/_lib/rules/targets'
import { exerciseKcal } from '../api/_lib/rules/treino'

// Mais desportos no «Já fiz» e nos teus treinos: cada um com os seus METs.
describe('desportos', () => {
  it('cada desporto tem nome e METs', () => {
    for (const s of OTHER_SPORTS) {
      expect(SPORT_LABEL[s]).toBeTruthy()
      expect(NET_METS[s]).toBeGreaterThan(0)
    }
    expect(isOtherSport('padel')).toBe(true)
    expect(isOtherSport('VirtualRide')).toBe(false)
  })

  it('45 min de corrida a 86 kg ≈ 484 kcal; um desporto desconhecido conta como «outro»', () => {
    expect(workoutKcal({ type: 'other', minutes: 45, watts: null, deviceCalories: null, sport: 'corrida', weightKg: 86 })).toBe(484)
    expect(
      workoutKcal({ type: 'other', minutes: 60, watts: null, deviceCalories: null, sport: 'VirtualRun' as never, weightKg: 80 }),
    ).toBe(240)
    expect(exerciseKcal({ type: 'other', minutes: 60, watts: null, wattsSource: null, deviceCalories: null, sport: 'padel', weightKg: 80 }).kcal).toBe(400)
  })
})
