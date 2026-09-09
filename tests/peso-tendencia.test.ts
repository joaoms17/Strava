import { describe, expect, it } from 'vitest'
import { linearSlope, projectWeight, trend7 } from '../api/_lib/rules/weight'

// Regra 3: média móvel de 7 dias + projeção linear sobre 21 dias.
describe('trend7', () => {
  it('faz a média das pesagens na janela de 7 dias', () => {
    const trend = trend7([
      { date: '2026-09-01', value: 86 },
      { date: '2026-09-04', value: 85 },
      { date: '2026-09-07', value: 84 },
    ])
    expect(trend).toEqual([
      { date: '2026-09-01', value: 86 },
      { date: '2026-09-04', value: 85.5 },
      { date: '2026-09-07', value: 85 }, // 01, 04 e 07 estão todos na janela [01..07]
    ])
  })

  it('ignora pesagens fora da janela', () => {
    const trend = trend7([
      { date: '2026-09-01', value: 90 },
      { date: '2026-09-10', value: 84 },
    ])
    expect(trend[1]).toEqual({ date: '2026-09-10', value: 84 })
  })
})

describe('linearSlope', () => {
  it('recupera o declive de uma série linear', () => {
    const slope = linearSlope([
      { date: '2026-09-01', value: 86 },
      { date: '2026-09-08', value: 85.3 },
      { date: '2026-09-15', value: 84.6 },
    ])
    expect(slope).toBeCloseTo(-0.1, 5)
  })

  it('com menos de 2 pontos o declive é 0', () => {
    expect(linearSlope([{ date: '2026-09-01', value: 86 }])).toBe(0)
  })
})

describe('projectWeight', () => {
  const trend = [
    { date: '2026-09-01', value: 86 },
    { date: '2026-09-11', value: 85 },
    { date: '2026-09-21', value: 84 }, // -0,1 kg/dia
  ]

  it('projeta 4 semanas à frente com o declive dos últimos 21 dias', () => {
    const projection = projectWeight(trend, 75)
    expect(projection.slopePerDay).toBeCloseTo(-0.1, 5)
    expect(projection.projected).toHaveLength(28)
    expect(projection.projected[0]?.date).toBe('2026-09-22')
    expect(projection.projected[27]?.value).toBeCloseTo(84 - 2.8, 1)
  })

  it('prevê a data de chegada ao alvo', () => {
    const projection = projectWeight(trend, 75)
    // faltam 9 kg a 0,1 kg/dia = 90 dias a partir de 21 de setembro
    expect(projection.targetDate).toBe('2026-12-20')
  })

  it('sem descida não há data prevista', () => {
    const flat = [
      { date: '2026-09-01', value: 85 },
      { date: '2026-09-21', value: 85 },
    ]
    expect(projectWeight(flat, 75).targetDate).toBeNull()
  })

  it('já no alvo, a data prevista é hoje', () => {
    const done = [{ date: '2026-09-21', value: 74.8 }]
    expect(projectWeight(done, 75).targetDate).toBe('2026-09-21')
  })
})
