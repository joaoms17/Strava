import { describe, expect, it } from 'vitest'
import { nextBikeTarget, type BikeSessionSummary } from '../api/_lib/rules/progressao-bike'

const OPTIONS = [130, 140, 150]
const CAPS = { avgHr: 112, maxHr: 125 }

const session = (partial: Partial<BikeSessionSummary>): BikeSessionSummary => ({
  watts: 130,
  minutes: 30,
  avg_hr: 105,
  max_hr: 118,
  status: 'green',
  ...partial,
})

// Regra 10: tempo primeiro (30 -> 45 -> 60), depois watts com validação.
describe('nextBikeTarget', () => {
  it('sem histórico começa no W mais baixo, 30 min', () => {
    expect(nextBikeTarget([], OPTIONS, CAPS)).toEqual({ watts: 130, minutes: 30, kind: 'start' })
  })

  it('verde sobe o tempo: 30 -> 45 -> 60', () => {
    expect(nextBikeTarget([session({ minutes: 30 })], OPTIONS, CAPS)).toMatchObject({
      watts: 130,
      minutes: 45,
      kind: 'progress-time',
    })
    expect(nextBikeTarget([session({ minutes: 45 })], OPTIONS, CAPS)).toMatchObject({
      minutes: 60,
      kind: 'progress-time',
    })
  })

  it('2 sessões seguidas nos caps de FC, verdes e já a 60 min: validação de 30 min no W seguinte', () => {
    const history = [
      session({ minutes: 60, avg_hr: 110, max_hr: 122 }),
      session({ minutes: 60, avg_hr: 108, max_hr: 120 }),
    ]
    expect(nextBikeTarget(history, OPTIONS, CAPS)).toEqual({
      watts: 140,
      minutes: 30,
      kind: 'validate-next-watts',
    })
  })

  it('FC acima do cap segura os watts mesmo a 60 min', () => {
    const history = [
      session({ minutes: 60, avg_hr: 113 }), // acima do cap de média
      session({ minutes: 60, avg_hr: 110 }),
    ]
    expect(nextBikeTarget(history, OPTIONS, CAPS)).toMatchObject({ watts: 130, kind: 'hold' })
  })

  it('só uma sessão dentro dos caps não chega', () => {
    const history = [session({ minutes: 60, max_hr: 130 }), session({ minutes: 60 })]
    expect(nextBikeTarget(history, OPTIONS, CAPS)).toMatchObject({ watts: 130, kind: 'hold' })
  })

  it('a validação verde continua no W novo', () => {
    const history = [
      session({ minutes: 60 }),
      session({ minutes: 60 }),
      session({ watts: 140, minutes: 30 }), // validação a 140 W, verde
    ]
    expect(nextBikeTarget(history, OPTIONS, CAPS)).toMatchObject({
      watts: 140,
      minutes: 45,
      kind: 'progress-time',
    })
  })

  it('amarelo ou vermelho: bike leve (W mais baixo, 30 min)', () => {
    expect(nextBikeTarget([session({ status: 'yellow', minutes: 60 })], OPTIONS, CAPS)).toEqual({
      watts: 130,
      minutes: 30,
      kind: 'ease',
    })
    expect(nextBikeTarget([session({ status: 'red' })], OPTIONS, CAPS)).toMatchObject({
      kind: 'ease',
    })
  })

  it('no W máximo com tudo verde segura os 60 min', () => {
    const history = [
      session({ watts: 150, minutes: 60 }),
      session({ watts: 150, minutes: 60 }),
    ]
    expect(nextBikeTarget(history, OPTIONS, CAPS)).toMatchObject({ watts: 150, minutes: 60 })
  })

  it('sem check-in repete o alvo', () => {
    expect(nextBikeTarget([session({ status: null, minutes: 45 })], OPTIONS, CAPS)).toMatchObject({
      watts: 130,
      minutes: 45,
      kind: 'hold',
    })
  })
})
