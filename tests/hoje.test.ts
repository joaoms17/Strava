import { describe, expect, it } from 'vitest'
import { kcalLeftShown } from '../src/lib/format'

const round10 = (n: number) => Math.round(n / 10) * 10

// O cartão do Hoje: Plano − Comido tem de dar o «Podes comer» que se vê.
describe('cartão do Hoje', () => {
  it('Plano − Comido = «Podes comer», com os números já arredondados (K16)', () => {
    // Antes: 1 504 − 66 = 1 438 → «1 440», com Plano 1 500 e Comido 70.
    expect(kcalLeftShown(1504, 66)).toBe(1430)
    for (let plan = 1400; plan < 1600; plan += 7) {
      for (let eaten = 0; eaten < 400; eaten += 13) {
        const shown = kcalLeftShown(plan, eaten)
        expect(round10(shown)).toBe(round10(plan) - round10(eaten))
      }
    }
    // Acima do plano dá negativo.
    expect(kcalLeftShown(1500, 1612)).toBe(-110)
  })
})
