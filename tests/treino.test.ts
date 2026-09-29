import { describe, expect, it } from 'vitest'
import {
  checkShotNumbers,
  countedMinutes,
  durationsMatch,
  estimatedStart,
  exerciseKcal,
  findMergeCandidate,
  kcalExplanation,
  mergePatch,
  pickWatts,
  typeOfSport,
} from '../api/_lib/rules/treino'
import { bikeSuggestion, nextBikeTarget, type BikeSessionSummary } from '../api/_lib/rules/progressao-bike'

// Fase 3 — treino: watts, kcal, mesma sessão e junção do print.
describe('pickWatts (regra 2 revista)', () => {
  it('segue a ordem dispositivo, consola, à mão, favorito, última sessão', () => {
    expect(pickWatts({ device: 150, console: 140, manual: 130 })).toEqual({ watts: 150, source: 'device' })
    expect(pickWatts({ console: 140, manual: 130, favorite: 120 })).toEqual({ watts: 140, source: 'console' })
    expect(pickWatts({ favorite: 140, lastConfirmed: 130 })).toEqual({ watts: 140, source: 'favorite' })
    expect(pickWatts({ lastConfirmed: 130 })).toEqual({ watts: 130, source: 'prefill' })
    expect(pickWatts({})).toEqual({ watts: null, source: null })
  })
})

describe('exerciseKcal', () => {
  it('bicicleta: 140 W × 45 min = 378 pela potência', () => {
    expect(exerciseKcal({ type: 'bike', minutes: 45, watts: 140, wattsSource: 'favorite', deviceCalories: 520 })).toEqual({
      kcal: 378,
      rule: 'watts',
      estimated: false,
    })
  })

  it('bicicleta com watts supostos fica estimativa', () => {
    expect(exerciseKcal({ type: 'bike', minutes: 45, watts: 140, wattsSource: 'prefill', deviceCalories: null })).toEqual({
      kcal: 378,
      rule: 'watts_prefill',
      estimated: true,
    })
  })

  it('bicicleta sem potência conta 0 (nunca as calorias do relógio)', () => {
    expect(exerciseKcal({ type: 'bike', minutes: 45, watts: null, wattsSource: null, deviceCalories: 520 }).kcal).toBe(0)
  })

  it('ginásio: 150 fixas a partir de 30 min', () => {
    expect(exerciseKcal({ type: 'strength', minutes: 40, watts: null, wattsSource: null, deviceCalories: 300 }).kcal).toBe(150)
    expect(exerciseKcal({ type: 'strength', minutes: 20, watts: null, wattsSource: null, deviceCalories: 300 }).kcal).toBe(0)
  })

  it('outro com calorias do relógio: 70 %', () => {
    expect(exerciseKcal({ type: 'other', minutes: 40, watts: null, wattsSource: null, deviceCalories: 300 })).toEqual({
      kcal: 210,
      rule: 'device_x0.7',
      estimated: false,
    })
  })

  it('caminhada de 40 min sem relógio conta mais de 0', () => {
    const result = exerciseKcal({
      type: 'other',
      minutes: 40,
      watts: null,
      wattsSource: null,
      deviceCalories: null,
      sport: 'caminhada',
      weightKg: 85,
    })
    expect(result.kcal).toBe(142)
    expect(result).toMatchObject({ rule: 'met', estimated: true })
  })
})

describe('kcalExplanation', () => {
  it('diz porque não conta as calorias do relógio na bicicleta', () => {
    expect(
      kcalExplanation({ type: 'bike', minutes: 45, watts: 140, kcal: 378, rule: 'watts', deviceCalories: 520 }),
    ).toBe('O relógio diz 520 kcal. Contamos 378 pela potência (140 W × 45 min), porque os relógios exageram na bicicleta.')
  })

  it('sem potência pede a foto da consola', () => {
    expect(kcalExplanation({ type: 'bike', minutes: 45, watts: null, kcal: 0, rule: 'watts', deviceCalories: null })).toMatch(
      /foto da consola/,
    )
  })
})

describe('mesma sessão', () => {
  const habitual = {
    id: 'fav',
    type: 'bike' as const,
    date: '2026-09-29',
    minutes: 45,
    // Registada às 07:55 (fim), começou às 07:10.
    started_at: estimatedStart(new Date('2026-09-29T06:55:00Z'), 45),
  }

  it('a Bicicleta habitual das 07:10 junta-se ao print do Garmin', () => {
    const draft = { type: 'bike' as const, date: '2026-09-29', minutes: 44, started_at: '2026-09-29T06:12:00Z' }
    expect(findMergeCandidate(draft, [habitual])?.id).toBe('fav')
  })

  it('duração muito diferente não é a mesma sessão', () => {
    const draft = { type: 'bike' as const, date: '2026-09-29', minutes: 60, started_at: '2026-09-29T06:10:00Z' }
    expect(findMergeCandidate(draft, [habitual])).toBeNull()
  })

  it('início a mais de 30 min não é a mesma sessão', () => {
    const draft = { type: 'bike' as const, date: '2026-09-29', minutes: 45, started_at: '2026-09-29T17:00:00Z' }
    expect(findMergeCandidate(draft, [habitual])).toBeNull()
  })

  it('outro dia ou outro tipo não junta', () => {
    expect(findMergeCandidate({ ...habitual, date: '2026-09-28' }, [habitual])).toBeNull()
    expect(findMergeCandidate({ ...habitual, type: 'other' }, [habitual])).toBeNull()
  })

  it('sem hora de início, decide pela duração', () => {
    const draft = { type: 'bike' as const, date: '2026-09-29', minutes: 47, started_at: null }
    expect(findMergeCandidate(draft, [habitual])?.id).toBe('fav')
  })

  it('tolerância de max(3 min, 10 %)', () => {
    expect(durationsMatch(30, 33)).toBe(true)
    expect(durationsMatch(30, 34)).toBe(false)
    expect(durationsMatch(90, 100)).toBe(true)
    expect(durationsMatch(90, 101)).toBe(false)
  })
})

describe('mergePatch', () => {
  const existing = {
    watts: 140,
    watts_source: 'favorite',
    minutes: 45,
    avg_hr: null,
    max_hr: null,
    pain_during: 1,
    favorite_id: 'fav',
    started_at: '2026-09-29T06:10:00Z',
  }

  it('junta os batimentos sem mexer no joelho, na duração nem nos watts do favorito', () => {
    const { patch } = mergePatch(existing, {
      avg_hr: 132,
      max_hr: 141,
      minutes: 44,
      watts: 150,
      watts_source: 'device',
      pain_during: 7,
      started_at: '2026-09-29T06:12:00Z',
    })
    expect(patch).toEqual({ avg_hr: 132, max_hr: 141 })
  })

  it('watts do dispositivo substituem os supostos', () => {
    const { patch } = mergePatch({ ...existing, watts_source: 'prefill' }, { watts: 150, watts_source: 'device' })
    expect(patch).toEqual({ watts: 150, watts_source: 'device' })
  })
})

describe('leitura dos prints', () => {
  it('valores impossíveis ficam vazios e marcados', () => {
    const { activity, low } = checkShotNumbers({ avg_hr: 250, max_hr: 140, avg_power_w: 140, avg_cadence: 88 })
    expect(activity).toEqual({ avg_hr: null, max_hr: 140, avg_power_w: 140, avg_cadence: 88 })
    expect(low).toEqual(['avg_hr'])
  })

  it('máximo abaixo da média fica vazio', () => {
    const { activity, low } = checkShotNumbers({ avg_hr: 132, max_hr: 120 })
    expect(activity.max_hr).toBeNull()
    expect(low).toContain('max_hr')
  })

  it('tipos e minutos que contam', () => {
    expect(typeOfSport('indoor_bike')).toEqual({ type: 'bike', sport: null })
    expect(typeOfSport('walk')).toEqual({ type: 'other', sport: 'caminhada' })
    expect(countedMinutes('bike', 2760, 2700)).toBe(45)
    expect(countedMinutes('strength', 3000, 1800)).toBe(50)
    expect(countedMinutes('other', null, null)).toBeNull()
  })
})

describe('regra 10 revista', () => {
  const OPTIONS = [130, 140, 150]
  const CAPS = { avgHr: 112, maxHr: 125 }
  const session = (partial: Partial<BikeSessionSummary>): BikeSessionSummary => ({
    watts: 130,
    minutes: 60,
    avg_hr: 105,
    max_hr: 118,
    status: 'green',
    ...partial,
  })

  it('watts supostos não contam para subir a potência', () => {
    const history = [session({ watts_source: 'prefill' }), session({ watts_source: 'prefill' })]
    expect(nextBikeTarget(history, OPTIONS, CAPS).kind).toBe('hold')
  })

  it('sem batimentos, a 60 min e tudo verde, pede os batimentos', () => {
    const history = [session({ avg_hr: null, max_hr: null }), session({ avg_hr: null, max_hr: null })]
    const target = nextBikeTarget(history, OPTIONS, CAPS)
    expect(target).toEqual({ watts: 130, minutes: 60, kind: 'need-hr' })
    expect(bikeSuggestion(target, true)).toMatch(/preciso dos batimentos/)
  })

  it('sem batimentos o tempo continua a subir', () => {
    expect(nextBikeTarget([session({ minutes: 30, avg_hr: null, max_hr: null })], OPTIONS, CAPS)).toMatchObject({
      minutes: 45,
      kind: 'progress-time',
    })
  })

  it('frases da sugestão', () => {
    expect(bikeSuggestion({ watts: 130, minutes: 30, kind: 'start' }, false)).toBe(
      'Começa com 30 min a 130 W e diz como ficou o joelho.',
    )
    expect(bikeSuggestion({ watts: 140, minutes: 60, kind: 'progress-time' }, true)).toBe(
      'Próxima bicicleta: 60 min a 140 W.',
    )
    expect(bikeSuggestion({ watts: 150, minutes: 30, kind: 'validate-next-watts' }, true)).toBe(
      'Próxima vez: 150 W durante 30 min, para testar.',
    )
    expect(bikeSuggestion({ watts: 140, minutes: 45, kind: 'hold' }, false)).toMatch(/joelho/)
  })
})
