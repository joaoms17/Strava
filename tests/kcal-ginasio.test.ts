import { describe, expect, it } from 'vitest'
import {
  GYM_KCAL_PER_MIN,
  GYM_NET_MET,
  gymPace,
  strengthExplanation,
  strengthKcal,
  strengthReason,
  type GymPaceSession,
} from '../api/_lib/rules/kcal-ginasio'

// Regra 2 revista no ginásio: as calorias do relógio por inteiro, para quem
// as traz; sem elas, os minutos ao ritmo da pessoa, pelo peso ou, sem peso,
// a 4 kcal por minuto. Sem mínimo de 30 min nem 150 fixas.

const TODAY = '2026-10-19'
// Os 4 prints da Joana (o quinto ginásio, de 30 min, não trazia calorias).
const joana: GymPaceSession[] = [
  { date: '2026-10-17', minutes: 47, kcal_device: 210 },
  { date: '2026-10-15', minutes: 47, kcal_device: 207 },
  { date: '2026-10-13', minutes: 41, kcal_device: 164 },
  { date: '2026-10-10', minutes: 35, kcal_device: 108 },
]

describe('strengthKcal', () => {
  it('as calorias do relógio contam por inteiro, com qualquer duração', () => {
    expect(strengthKcal({ minutes: 47, deviceCalories: 210 })).toEqual({ kcal: 210, rule: 'device', estimated: false })
    expect(strengthKcal({ minutes: 20, deviceCalories: 108, pace: 6 })).toEqual({ kcal: 108, rule: 'device', estimated: false })
    expect(strengthKcal({ minutes: 62, deviceCalories: 537.6 }).kcal).toBe(538)
  })

  it('sem calorias do relógio: os minutos ao ritmo da pessoa', () => {
    expect(strengthKcal({ minutes: 30, deviceCalories: null, pace: gymPace(joana, TODAY), weightKg: 60 })).toEqual({
      kcal: 122,
      rule: 'strength_rate',
      estimated: true,
    })
  })

  it('sem ritmo: METs líquidos do treino de força × peso × horas', () => {
    expect(GYM_NET_MET).toBe(4)
    expect(strengthKcal({ minutes: 45, deviceCalories: null, pace: null, weightKg: 84 })).toEqual({
      kcal: 252,
      rule: 'met',
      estimated: true,
    })
  })

  it('sem ritmo nem peso: 4 kcal por minuto, nunca 0 numa sessão a sério', () => {
    expect(GYM_KCAL_PER_MIN).toBe(4)
    expect(strengthKcal({ minutes: 25, deviceCalories: null })).toEqual({ kcal: 100, rule: 'strength_time', estimated: true })
  })

  it('sem mínimo de 30 min nem 150 fixas', () => {
    expect(strengthKcal({ minutes: 20, deviceCalories: null, weightKg: 60 }).kcal).toBe(80)
    expect(strengthKcal({ minutes: 90, deviceCalories: null, weightKg: 60 }).kcal).toBe(360)
  })

  it('calorias a 0 (ou de leitura impossível) não contam como do relógio', () => {
    expect(strengthKcal({ minutes: 30, deviceCalories: 0, weightKg: 60 })).toMatchObject({ kcal: 120, rule: 'met' })
  })
})

describe('gymPace', () => {
  it('kcal por minuto pesadas pelos minutos: 689 kcal em 170 min', () => {
    expect(gymPace(joana, TODAY)).toBeCloseTo(689 / 170, 6)
  })

  it('precisa de pelo menos 2 sessões com calorias do relógio', () => {
    expect(gymPace(joana.slice(0, 1), TODAY)).toBeNull()
    expect(gymPace([], TODAY)).toBeNull()
    expect(gymPace([...joana.slice(0, 1), { date: '2026-10-12', minutes: 30, kcal_device: null }], TODAY)).toBeNull()
  })

  it('só os últimos 120 dias até hoje', () => {
    const old = { date: '2026-06-01', minutes: 60, kcal_device: 900 }
    const future = { date: '2026-10-20', minutes: 60, kcal_device: 900 }
    expect(gymPace([...joana, old, future], TODAY)).toBeCloseTo(689 / 170, 6)
    // 120 dias antes de hoje ainda conta.
    expect(gymPace([{ date: '2026-06-21', minutes: 50, kcal_device: 250 }, joana[0]!], TODAY)).toBeCloseTo(460 / 97, 6)
  })

  it('deixa de fora as sessões fora dos limites (leitura errada, parte curta)', () => {
    const odd = [
      { date: '2026-10-16', minutes: 45, kcal_device: 2100 }, // 47 kcal/min
      { date: '2026-10-14', minutes: 5, kcal_device: 40 }, // 5 min
      { date: '2026-10-12', minutes: 60, kcal_device: 30 }, // 0,5 kcal/min
      { date: '2026-10-11', minutes: 300, kcal_device: 1500 }, // 5 h
    ]
    expect(gymPace([...joana, ...odd], TODAY)).toBeCloseTo(689 / 170, 6)
    expect(gymPace([joana[0]!, ...odd], TODAY)).toBeNull()
  })
})

describe('strengthExplanation', () => {
  it('diz de onde vêm as kcal', () => {
    expect(strengthExplanation({ minutes: 47, kcal: 210, rule: 'device', deviceCalories: 210 })).toBe('As 210 kcal do relógio.')
    expect(strengthExplanation({ minutes: 30, kcal: 122, rule: 'strength_rate', deviceCalories: null })).toBe(
      '≈ 122 kcal: 30 min ao teu ritmo dos últimos ginásios.',
    )
    expect(strengthExplanation({ minutes: 45, kcal: 252, rule: 'met', deviceCalories: null })).toBe(
      '≈ 252 kcal pelo tempo (45 min) e pelo teu peso.',
    )
    expect(strengthExplanation({ minutes: 25, kcal: 100, rule: 'strength_time', deviceCalories: null })).toBe(
      '≈ 100 kcal pelo tempo (25 min): sem pesagens, 4 kcal por minuto.',
    )
  })

  it('as sessões antigas ficam com a regra de antes (não se reescrevem)', () => {
    expect(strengthExplanation({ minutes: 45, kcal: 150, rule: 'strength_flat', deviceCalories: 400 })).toBe(
      '150 fixas por ginásio de 30 min ou mais (a regra de antes).',
    )
    expect(strengthExplanation({ minutes: 20, kcal: 0, rule: null, deviceCalories: null })).toBe(
      'Menos de 30 min de ginásio não somava (a regra de antes).',
    )
  })

  it('a razão curta da folha «O plano de hoje»', () => {
    expect(strengthReason('device')).toBe('as calorias do relógio')
    expect(strengthReason('strength_rate')).toBe('ao teu ritmo dos últimos ginásios')
    expect(strengthReason('strength_flat')).toMatch(/150 fixas/)
  })
})
