import { describe, expect, it } from 'vitest'
import { workoutOrigin } from '../src/lib/treino-origem'

describe('origem no histórico do Treino (T21)', () => {
  it('a «Bicicleta habitual» junta ao relógio não aparece como print', () => {
    expect(workoutOrigin({ source: 'manual', favorite_id: 'f1', merged_from: [{ intervals_id: 'i9' }] })).toBe('teu treino + relógio')
  })
  it('o relógio completado com um print', () => {
    expect(workoutOrigin({ source: 'intervals', merged_from: [{ import_id: 'x' }] })).toBe('Relógio (auto) + print')
  })
  it('sem junções, a origem de sempre', () => {
    expect(workoutOrigin({ source: 'screenshot' })).toBe('print')
    expect(workoutOrigin({ source: 'manual' })).toBe('à mão')
    expect(workoutOrigin({ source: 'strava', merged_from: null })).toBe('Strava')
  })
  it('o ginásio do relógio com as séries ditas', () => {
    expect(workoutOrigin({ source: 'intervals', merged_from: [{ said: true }, { said: true }] })).toBe('Relógio (auto) + dito')
  })
})
