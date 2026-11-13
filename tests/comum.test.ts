import { describe, expect, it } from 'vitest'
import { KCAL_PER_KG, fold, mean, round1, stripAccents } from '../api/_lib/rules/comum'
import { KCAL_PER_KG as KCAL_GASTO } from '../api/_lib/rules/gasto'
import { KCAL_PER_KG as KCAL_PROJECAO } from '../api/_lib/rules/projecao'
import { round1 as round1Totais } from '../api/_lib/rules/meal-totals'
import { mean as meanSono } from '../api/_lib/rules/sono'
import { lisbonClock, lisbonDay } from '../api/_lib/rules/momentos'
import { lisbonDay as lisbonDayGraficos } from '../api/_lib/rules/graficos'
import { nutritionalDay } from '../api/_lib/rules/nutritional-day'

// L20: as contas pequenas vivem num só sítio; quem as reexporta dá o mesmo.
describe('módulo comum das regras (L20)', () => {
  it('uma só energia por quilo', () => {
    expect(KCAL_PER_KG).toBe(7700)
    expect(KCAL_GASTO).toBe(KCAL_PER_KG)
    expect(KCAL_PROJECAO).toBe(KCAL_PER_KG)
  })

  it('round1 e mean', () => {
    expect(round1(81.24)).toBe(81.2)
    expect(round1(81.25)).toBe(81.3)
    expect(round1Totais).toBe(round1)
    expect(mean([1, 2, null, undefined, Number.NaN, 3])).toBe(2)
    expect(mean([])).toBeNull()
    expect(meanSono).toBe(mean)
  })

  it('fold e stripAccents', () => {
    expect(stripAccents('Pão-de-ló')).toBe('Pao-de-lo')
    expect(fold('  Açúcar Mascavado ')).toBe('acucar mascavado')
  })
})

describe('um só «dia em Lisboa» (L20)', () => {
  const instants = [
    '2026-07-01T23:30:00Z', // verão: já é dia 2 em Lisboa
    '2026-11-01T23:30:00Z', // inverno: ainda é dia 1
    '2026-10-24T23:30:00Z',
    '2026-03-29T00:59:00Z', // mudança da hora
    '2026-03-29T01:00:00Z',
  ].map((s) => new Date(s))

  it('lisbonDay = lisbonClock().date = dia nutricional com corte às 0 h', () => {
    for (const instant of instants) {
      expect(lisbonDay(instant)).toBe(lisbonClock(instant).date)
      expect(lisbonDay(instant)).toBe(nutritionalDay(instant, 0))
      expect(lisbonDayGraficos(instant)).toBe(lisbonDay(instant))
    }
  })
})
