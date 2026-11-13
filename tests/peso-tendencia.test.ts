import { describe, expect, it } from 'vitest'
import { linearSlope, trend7 } from '../api/_lib/rules/weight'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

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

// «Meta: cerca de <mês>»: só com o ritmo da semana (8 pesagens em 14 dias).
// P4: a janela deslizante dá o mesmo que a conta antiga (filtro por pesagem).
describe('trend7 linear', () => {
  const naive = (weights: { date: string; value: number }[]) => {
    const n = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000
    const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
    return sorted.map((e) => {
      const w = sorted.filter((x) => n(x.date) >= n(e.date) - 6 && n(x.date) <= n(e.date))
      return { date: e.date, value: Math.round((w.reduce((a, x) => a + x.value, 0) / w.length) * 100) / 100 }
    })
  }
  it('o mesmo resultado, com buracos e duas pesagens no mesmo dia', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const weights: { date: string; value: number }[] = []
    let d = '2026-01-01'
    for (let i = 0; i < 400; i++) {
      d = shiftDate(d, Math.floor(rnd() * 4))
      weights.push({ date: d, value: Math.round((80 + rnd() * 5) * 10) / 10 })
    }
    expect(trend7(weights)).toEqual(naive(weights))
  })
})
