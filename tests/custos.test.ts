import { describe, expect, it } from 'vitest'
import {
  ASK_DAILY_CAP,
  ASK_KIND,
  DEFAULT_DAILY_VISION_CAP,
  DEFAULT_MONTHLY_CAP_EUR,
  VISION_KINDS,
  aiLimitsFor,
  dailyAskCapReached,
  dailyVisionCapReached,
  kindLabel,
  monthlyCapReached,
  nearMonthlyCap,
  quotaMessage,
  quotaOutcome,
  quotaPlan,
} from '../api/_lib/rules/custos'

// M20: reserva atómica da quota (ai_reserve_call, migração 20261113000060).
describe('reserva da quota da IA', () => {
  it('fotos: limite diário do perfil, da casa com o Gemini, sem euros', () => {
    expect(quotaPlan('meal_photo', 'gemini', { ai_daily_vision_cap: 25, ai_monthly_cap_eur: 5 })).toEqual({
      countKinds: VISION_KINDS,
      dailyCap: 25,
      sharedDaily: true,
      monthlyCapEur: 0,
    })
  })

  it('fotos com o Claude: por pessoa e com o teto do mês (por omissão 40 e 10 €)', () => {
    expect(quotaPlan('evolution', 'anthropic', null)).toEqual({
      countKinds: VISION_KINDS,
      dailyCap: DEFAULT_DAILY_VISION_CAP,
      sharedDaily: false,
      monthlyCapEur: DEFAULT_MONTHLY_CAP_EUR,
    })
    expect(DEFAULT_DAILY_VISION_CAP).toBe(40)
    expect(DEFAULT_MONTHLY_CAP_EUR).toBe(10)
  })

  it('perguntas: 60 por dia, só as perguntas contam', () => {
    const plan = quotaPlan(ASK_KIND, 'gemini', { ai_daily_vision_cap: 5 })
    expect(plan.countKinds).toEqual([ASK_KIND])
    expect(plan.dailyCap).toBe(ASK_DAILY_CAP)
  })

  it('texto e correções: só o teto do mês', () => {
    expect(quotaPlan('meal_correct', 'anthropic', { ai_monthly_cap_eur: '7.5' })).toEqual({
      countKinds: [],
      dailyCap: 0,
      sharedDaily: false,
      monthlyCapEur: 7.5,
    })
    expect(quotaPlan('meal_text', 'gemini', null).monthlyCapEur).toBe(0)
  })

  it('0 no perfil = sem limite; a verificação e o «mesmo assim» não têm limites', () => {
    expect(quotaPlan('meal_photo', 'anthropic', { ai_daily_vision_cap: 0, ai_monthly_cap_eur: 0 })).toMatchObject({
      dailyCap: 0,
      monthlyCapEur: 0,
    })
    expect(quotaPlan('ai_check', 'anthropic', null)).toMatchObject({ dailyCap: 0, monthlyCapEur: 0, countKinds: [] })
    expect(quotaPlan('meal_photo', 'anthropic', null, true)).toMatchObject({ dailyCap: 0, monthlyCapEur: 0 })
  })

  it('lê a resposta da função; o que não se percebe fica como antes (null)', () => {
    expect(quotaOutcome({ ok: true, id: 'abc' })).toEqual({ ok: true, id: 'abc' })
    expect(quotaOutcome({ ok: false, reason: 'diario', count: 40 })).toEqual({ ok: false, reason: 'diario' })
    expect(quotaOutcome({ ok: false, reason: 'mensal' })).toEqual({ ok: false, reason: 'mensal' })
    expect(quotaOutcome({ ok: true })).toBeNull()
    expect(quotaOutcome({ ok: false, reason: 'outro' })).toBeNull()
    expect(quotaOutcome(null)).toBeNull()
    expect(quotaOutcome([{ ok: true, id: 'x' }])).toBeNull()
    expect(quotaOutcome('ok')).toBeNull()
  })

  it('a frase para a app diz qual limite', () => {
    expect(quotaMessage('mensal', 'meal_photo', true)).toMatch(/mensal/)
    expect(quotaMessage('diario', ASK_KIND, true)).toMatch(/casa já fez muitas perguntas/)
    expect(quotaMessage('diario', ASK_KIND, false)).toMatch(/Já fizeste/)
    expect(quotaMessage('diario', 'meal_photo', true)).toMatch(/casa/)
    expect(quotaMessage('diario', 'meal_photo', false)).toMatch(/limite diário de fotos/)
  })
})

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

  it('«Pergunta à app»: no máximo 60 perguntas por dia, e não contam como fotos', () => {
    expect(ASK_DAILY_CAP).toBe(60)
    expect(dailyAskCapReached(59)).toBe(false)
    expect(dailyAskCapReached(60)).toBe(true)
    expect(dailyAskCapReached(5, 0)).toBe(false) // 0 = sem limite
    expect(VISION_KINDS).not.toContain(ASK_KIND)
  })

  it('com o Gemini a casa partilha a quota e não há euros; com o Claude é por pessoa', () => {
    expect(aiLimitsFor('gemini')).toEqual({ sharedDaily: true, monthlyEur: false })
    expect(aiLimitsFor('anthropic')).toEqual({ sharedDaily: false, monthlyEur: true })
  })

  it('o áudio do «Dizer o treino» e a foto do que sobrou vão para o modelo das fotos e contam como tal', () => {
    expect(VISION_KINDS).toContain('workout_said_audio')
    expect(VISION_KINDS).toContain('menu_pick')
    expect(VISION_KINDS).toContain('meal_leftovers')
    // S6: também vão para o modelo das fotos
    expect(VISION_KINDS).toContain('evolution')
    expect(VISION_KINDS).toContain('training_week')
    expect(VISION_KINDS).not.toContain('meal_text')
  })

  it('os pedidos do mês no singular quando é 1 («1 menu», não «1 menus»)', () => {
    expect(kindLabel('menus', 1)).toBe('menu')
    expect(kindLabel('verificações', 1)).toBe('verificação')
    expect(kindLabel('refeições por texto', 1)).toBe('refeição por texto')
    expect(kindLabel('menus', 2)).toBe('menus')
    expect(kindLabel('menus', 0)).toBe('menus')
    // Um tipo novo sem singular fica no plural.
    expect(kindLabel('fotos do que sobrou', 1)).toBe('fotos do que sobrou')
  })
})
