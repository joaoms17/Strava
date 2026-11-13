import { describe, expect, it } from 'vitest'
import { oddMeasurement } from '../src/lib/medidas-check'

describe('B6: medidas que pedem confirmação antes de gravar', () => {
  it('medidas normais passam sem perguntas', () => {
    expect(oddMeasurement({ zones: { neck: 40, waist: 95, hips: null }, pct: 24 })).toEqual([])
  })

  it('cintura 8,7 em vez de 87: fora dos limites', () => {
    const w = oddMeasurement({ zones: { neck: 40, waist: 8.7 }, pct: null })
    expect(w.some((t) => t.includes('na cintura') && t.includes('Parece pouco'))).toBe(true)
    expect(w.every((t) => !t.endsWith('Confirma.'))).toBe(true)
  })

  it('pescoço e cintura trocados', () => {
    const w = oddMeasurement({ zones: { neck: 58, waist: 45 }, pct: null })
    expect(w.some((t) => t.includes('trocaste os dois'))).toBe(true)
  })

  it('%G fora de 5–45', () => {
    expect(oddMeasurement({ zones: { neck: 40, waist: 95 }, pct: 3.2 })[0]).toContain('3,2 %')
    expect(oddMeasurement({ zones: { neck: 40, waist: 95 }, pct: 46 })).toHaveLength(1)
    expect(oddMeasurement({ zones: { neck: 40, waist: 95 }, pct: 45 })).toEqual([])
  })

  it('peso escrito longe da última pesagem (824 em vez de 82,4)', () => {
    expect(oddMeasurement({ zones: {}, pct: null, typedKg: 824, lastKg: 82 })[0]).toContain('longe da última pesagem')
    expect(oddMeasurement({ zones: {}, pct: null, typedKg: 82.4, lastKg: 82 })).toEqual([])
    // Sem pesagens nenhumas, não há com que comparar.
    expect(oddMeasurement({ zones: {}, pct: null, typedKg: 82.4, lastKg: null })).toEqual([])
  })
})
