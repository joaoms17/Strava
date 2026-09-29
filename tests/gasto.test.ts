import { describe, expect, it } from 'vitest'
import {
  COHERENCE_TEXT,
  baseSuggestion,
  coherence,
  dailyBase,
  formulaBase,
  kcalOut,
  lossQuality,
  measuredVsFormula,
  mifflinBase,
  paceFromDiff,
  persistentGap,
  weekSentence,
} from '../api/_lib/rules/gasto'
import { smoothTdee, tdeeRaw, type ClosedDay } from '../api/_lib/rules/adaptativo'

describe('gasto: fórmula e base sem treino', () => {
  it('Mifflin-St Jeor × 1,2 (homem, 183 cm)', () => {
    // 10×85 + 6,25×183 − 5×40 + 5 = 1798,75 → × 1,2 = 2158,5
    expect(mifflinBase({ weightKg: 85, heightCm: 183, age: 40, sex: 'm' })).toBe(2159)
  })

  it('sem ano de nascimento fica o valor fixo', () => {
    expect(formulaBase({ weightKg: 85, heightCm: 183, birthYear: null, sex: 'm', date: '2026-09-29', fallback: 2200 })).toBe(2200)
    expect(formulaBase({ weightKg: 85, heightCm: 183, birthYear: 1986, sex: 'm', date: '2026-09-29', fallback: 2200 })).toBe(2159)
  })

  it('antes de 10 dias completos usa a fórmula («a aprender»)', () => {
    expect(dailyBase({ completeDays: 4, tdeeFrozen: 2400, avgTrainingKcal: 200, formula: 2159 })).toEqual({ base: 2159, learning: true })
  })

  it('depois, o gasto medido menos a média do treino', () => {
    expect(dailyBase({ completeDays: 12, tdeeFrozen: 2400, avgTrainingKcal: 200, formula: 2159 })).toEqual({ base: 2200, learning: false })
  })

  it('gasto de hoje: 2 200 + 378 = 2 578 (mostrado «cerca de 2 580»)', () => {
    expect(kcalOut(2200, 378)).toBe(2578)
  })
})

describe('frases do Balanço', () => {
  it('600 por dia menos do que gastaste e o peso a descer 0,4', () => {
    expect(weekSentence(1900, 2500, -0.4)).toBe(
      'Esta semana comeste cerca de 600 kcal por dia menos do que gastaste. O peso médio está a descer 0,4 kg por semana.',
    )
  })

  it('sem peso, só a primeira frase; perto de zero, «cerca do que gastaste»', () => {
    expect(weekSentence(2480, 2500, null)).toBe('Esta semana comeste cerca do que gastaste.')
    expect(weekSentence(2800, 2500, 0.01)).toBe(
      'Esta semana comeste cerca de 300 kcal por dia mais do que gastaste. O peso médio está estável.',
    )
  })

  it('ritmo previsto: 600 por dia a menos ≈ 0,55 kg por semana', () => {
    expect(paceFromDiff(-600)).toBe(-0.55)
  })

  it('coerência: «Bate certo» dentro de 0,25 kg por semana', () => {
    expect(coherence(1900, 2500, -0.45)).toBe('bate_certo')
    expect(coherence(1900, 2500, -0.1)).toBe('ainda_nao')
    expect(COHERENCE_TEXT.ainda_nao).toMatch(/água e sal/)
  })

  it('sugestão de plano base, a 50 e nunca abaixo de 1 500', () => {
    expect(baseSuggestion(2400, 250, 1500)).toBe(1600)
    expect(baseSuggestion(2320, 250, 1500)).toBeNull() // 1 500 → 1 500 (muda menos de 100)
    expect(baseSuggestion(1900, 300, 1600)).toBe(1500)
  })
})

describe('circularidade: o gasto medido não confirma o subregisto', () => {
  // Gasto real 2 500, come 2 000 mas regista 1 600 (20 % a menos).
  const TRUE_TDEE = 2500
  const TRUE_IN = 2000
  const LOGGED = 1600
  const kgPerDay = (TRUE_IN - TRUE_TDEE) / 7700
  const days: ClosedDay[] = Array.from({ length: 28 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
    kcal_in: LOGGED,
    weight_trend: Math.round((85 + kgPerDay * i) * 100) / 100,
  }))

  function measured(untilIndex: number): number {
    let tdee: number | null = null
    for (let i = 13; i <= untilIndex; i++) {
      const raw = tdeeRaw(days.slice(i - 13, i + 1))!
      tdee = smoothTdee(tdee, raw)
    }
    return tdee!
  }

  it('a formulação antiga (gasto medido contra o mesmo peso) diz sempre «Bate certo»', () => {
    const tdee = measured(20)
    const rate = kgPerDay * 7
    expect(tdee).toBeCloseTo(LOGGED + (TRUE_TDEE - TRUE_IN), -1) // ≈ 2 100, não 2 500
    expect(coherence(LOGGED, tdee, rate)).toBe('bate_certo')
  })

  it('o gasto medido contra a fórmula mostra a nota ao fim de 3 semanas', () => {
    const formula = TRUE_TDEE // a fórmula não depende do que se come
    const gaps = [13, 20, 27].map((i) => measuredVsFormula(measured(i), formula, 0))
    expect(gaps.every((g) => g < -300)).toBe(true)
    expect(persistentGap(gaps)).toBe(true)
    expect(persistentGap(gaps.slice(0, 2))).toBe(false)
  })
})

describe('qualidade da perda', () => {
  it('só com 3 medições e 3 kg ou mais', () => {
    expect(lossQuality([{ weight_used_kg: 88, fatKg: 19 }, { weight_used_kg: 84, fatKg: 16 }])).toBeNull()
    expect(
      lossQuality([
        { weight_used_kg: 88, fatKg: 19 },
        { weight_used_kg: 86, fatKg: 17.6 },
        { weight_used_kg: 84.5, fatKg: 16.2 },
      ]),
    ).toEqual({ fatShare: 80, weightKg: -3.5 })
  })
})
