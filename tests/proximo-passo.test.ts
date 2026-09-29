import { describe, expect, it } from 'vitest'
import { dismissNudge, isNudgeHidden, nextStep, type NextStepInput } from '../api/_lib/rules/proximo-passo'

const base: NextStepInput = {
  today: '2026-09-28',
  minutesOfDay: 14 * 60,
  weighedToday: true,
  yesterdayMeals: 3,
  yesterdayAnswered: false,
  mealsToday: 2,
  kcalToday: 1100,
  proteinToday: 90,
  proteinTarget: 140,
  nudges: {},
}

describe('próximo passo', () => {
  it('medições: de manhã, a cada 14 dias; a primeira depois de 3 pesagens', () => {
    const morning = { ...base, minutesOfDay: 9 * 60 }
    expect(nextStep({ ...morning, measureDaysSince: 15, measureIntervalDays: 14 })).toBe('medir')
    expect(nextStep({ ...morning, measureDaysSince: 10, measureIntervalDays: 14 })).toBeNull()
    expect(nextStep({ ...morning, measureDaysSince: null, weighings: 3 })).toBe('medir')
    expect(nextStep({ ...morning, measureDaysSince: null, weighings: 2 })).toBeNull()
    expect(nextStep({ ...base, minutesOfDay: 18 * 60, measureDaysSince: 30 })).toBeNull()
    expect(nextStep({ ...morning, measureDaysSince: 30, nudges: { medir: { ignored: 1, hiddenOn: base.today } } })).toBeNull()
  })

  it('um print lido à espera de confirmação vem logo a seguir aos erros da comida', () => {
    const morning = { ...base, minutesOfDay: 8 * 60, weighedToday: false }
    expect(nextStep({ ...morning, workoutsToConfirm: 1 })).toBe('treino')
    expect(nextStep({ ...morning, workoutsToConfirm: 1, mealsWithError: 1 })).toBe('erro')
    expect(nextStep({ ...morning, workoutsToConfirm: 0 })).toBe('pesar')
  })

  it('de manhã sem pesagem pede para pesar', () => {
    expect(nextStep({ ...base, minutesOfDay: 8 * 60, weighedToday: false })).toBe('pesar')
    expect(nextStep({ ...base, minutesOfDay: 11 * 60, weighedToday: false })).toBeNull()
    expect(nextStep({ ...base, minutesOfDay: 1 * 60 + 30, weighedToday: false })).toBeNull()
  })

  it('ontem com 1 ou 2 refeições pergunta se foi tudo, até haver resposta', () => {
    expect(nextStep({ ...base, yesterdayMeals: 2 })).toBe('ontem')
    expect(nextStep({ ...base, yesterdayMeals: 2, yesterdayAnswered: true })).toBeNull()
    expect(nextStep({ ...base, yesterdayMeals: 0 })).toBeNull()
  })

  it('depois das 20:00 com pouco comido', () => {
    expect(nextStep({ ...base, minutesOfDay: 20 * 60 + 30 })).toBe('pouco')
    expect(nextStep({ ...base, minutesOfDay: 20 * 60 + 30, mealsToday: 0, kcalToday: 0 })).toBeNull()
  })

  it('depois das 19:00 com menos de 60 % da proteína', () => {
    expect(nextStep({ ...base, minutesOfDay: 19 * 60 + 10, kcalToday: 1500, proteinToday: 80 })).toBe(
      'proteina',
    )
    expect(nextStep({ ...base, minutesOfDay: 19 * 60 + 10, kcalToday: 1500, proteinToday: 90 })).toBeNull()
  })

  it('só um cartão: o primeiro que se aplica', () => {
    expect(
      nextStep({ ...base, minutesOfDay: 8 * 60, weighedToday: false, yesterdayMeals: 1 }),
    ).toBe('pesar')
  })
})

describe('«Agora não»', () => {
  it('esconde até ao dia seguinte', () => {
    const state = dismissNudge({}, 'pesar', '2026-09-28')
    expect(isNudgeHidden(state, 'pesar', '2026-09-28')).toBe(true)
    expect(isNudgeHidden(state, 'pesar', '2026-09-29')).toBe(false)
    expect(
      nextStep({ ...base, minutesOfDay: 8 * 60, weighedToday: false, yesterdayMeals: 1, nudges: state }),
    ).toBe('ontem')
  })

  it('ignorado 2 vezes, pausa 3 dias', () => {
    const once = dismissNudge({}, 'pesar', '2026-09-28')
    const twice = dismissNudge(once, 'pesar', '2026-09-29')
    expect(isNudgeHidden(twice, 'pesar', '2026-10-01')).toBe(true)
    expect(isNudgeHidden(twice, 'pesar', '2026-10-02')).toBe(true)
    expect(isNudgeHidden(twice, 'pesar', '2026-10-03')).toBe(false)
  })
})

describe('próximo passo com fotos', () => {
  it('uma refeição com erro vem antes de tudo e não se esconde', () => {
    const hidden = dismissNudge({}, 'erro' as never, base.today)
    expect(nextStep({ ...base, minutesOfDay: 8 * 60, weighedToday: false, mealsWithError: 1, nudges: hidden })).toBe('erro')
  })

  it('o limite da IA vem a seguir', () => {
    expect(nextStep({ ...base, mealsOverLimit: 1 })).toBe('limite')
  })

  it('depois das 20:00 com refeições por confirmar: rever', () => {
    expect(nextStep({ ...base, minutesOfDay: 20 * 60 + 5, kcalToday: 1500, mealsToReview: 2 })).toBe('rever')
    expect(nextStep({ ...base, minutesOfDay: 19 * 60, kcalToday: 1500, proteinToday: 120, mealsToReview: 2 })).toBeNull()
  })
})
