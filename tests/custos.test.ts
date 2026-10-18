import { describe, expect, it } from 'vitest'
import {
  VISION_KINDS,
  aiLimitsFor,
  dailyVisionCapReached,
  monthlyCapReached,
  nearMonthlyCap,
} from '../api/_lib/rules/custos'

describe('limites da IA', () => {
  it('teto mensal em euros', () => {
    expect(monthlyCapReached(10, 10)).toBe(false) // 9,20 €
    expect(monthlyCapReached(11, 10)).toBe(true) // 10,12 €
    expect(monthlyCapReached(50, 0)).toBe(false) // 0 = sem teto
    expect(nearMonthlyCap(8.8, 10)).toBe(true)
  })

  it('limite diário de fotos', () => {
    expect(dailyVisionCapReached(39, 40)).toBe(false)
    expect(dailyVisionCapReached(40, 40)).toBe(true)
  })

  it('com o Gemini a casa partilha a quota e não há euros; com o Claude é por pessoa', () => {
    expect(aiLimitsFor('gemini')).toEqual({ sharedDaily: true, monthlyEur: false })
    expect(aiLimitsFor('anthropic')).toEqual({ sharedDaily: false, monthlyEur: true })
  })

  it('o áudio do «Dizer o treino» vai para o modelo das fotos e conta como tal', () => {
    expect(VISION_KINDS).toContain('workout_said_audio')
    expect(VISION_KINDS).toContain('menu_pick')
    expect(VISION_KINDS).not.toContain('meal_text')
  })
})
