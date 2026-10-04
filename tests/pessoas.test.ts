import { describe, expect, it } from 'vitest'
import { MAX_PEOPLE, initialOf, personName, startingTargets } from '../api/_lib/rules/pessoas'

describe('várias pessoas', () => {
  it('alvos de partida de uma mulher: fórmula menos o défice, proteína pelo peso alvo', () => {
    // 64,5 kg, 165 cm, 34 anos: Mifflin 1 345 × 1,2 = 1 614; − 550 → 1 064 → mínimo 1 200.
    const t = startingTargets({ sex: 'f', heightCm: 165, birthYear: 1992, weightKg: 64.5, targetWeightKg: 60 }, 2026)
    expect(t.base_kcal).toBe(1200)
    expect(t.protein_g).toBe(110)
    expect(t.protein_per_meal_g).toBe(30)
    expect(t.kcal_floor_week).toBe(1100)
    expect(t.expected_tdee).toBe(1610)
  })

  it('alvos de um homem mais pesado ficam acima do mínimo', () => {
    const t = startingTargets({ sex: 'm', heightCm: 183, birthYear: 1985, weightKg: 95, targetWeightKg: 80 }, 2026)
    // Mifflin 10×95 + 6,25×183 − 5×41 + 5 = 1 893,75 × 1,2 = 2 273 → − 550 = 1 723 → 1 700.
    expect(t.base_kcal).toBe(1700)
    expect(t.protein_g).toBe(145)
  })

  it('sem peso de hoje usa o alvo; sem ano assume 35', () => {
    const a = startingTargets({ sex: 'f', heightCm: 170, birthYear: null, weightKg: null, targetWeightKg: 70 }, 2026)
    const b = startingTargets({ sex: 'f', heightCm: 170, birthYear: 1991, weightKg: 70, targetWeightKg: 70 }, 2026)
    expect(a).toEqual(b)
  })

  it('proteína entre 60 e 220 g', () => {
    expect(startingTargets({ sex: 'f', heightCm: 150, birthYear: 2000, weightKg: 32, targetWeightKg: 30 }, 2026).protein_g).toBe(60)
    expect(startingTargets({ sex: 'm', heightCm: 200, birthYear: 1990, weightKg: 200, targetWeightKg: 150 }, 2026).protein_g).toBe(220)
  })

  it('nome no separador: o escolhido ou o início do email', () => {
    expect(personName('  Joana  ', 'x@y.pt')).toBe('Joana')
    expect(personName(null, 'joao.ms17@hotmail.com')).toBe('Joao')
    expect(personName('', null)).toBe('Eu')
    expect(personName('Um nome muito comprido que não cabe no separador', null)).toHaveLength(30)
    expect(initialOf('joana')).toBe('J')
    expect(MAX_PEOPLE).toBeGreaterThanOrEqual(2)
  })
})
