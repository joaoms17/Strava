import { describe, expect, it } from 'vitest'
import {
  averageReadings,
  changeSentence,
  checkZone,
  compareCompositions,
  composition,
  confirmationSentence,
  daysSinceMeasure,
  earlyDietWeeks,
  isPlausible,
  measureFlags,
  navyBodyFat,
  navyBodyFatInches,
  needsThirdReading,
  referenceWeight,
  roundHalf,
  scaleFatAverage,
  targetWaist,
} from '../api/_lib/rules/composicao'

// Vetores do plano (docs/redesenho-2026-09.md › Composição corporal).
const HEIGHT = 183
const first = { neck_cm: 40, waist_cm: 94, weight_used_kg: 85 }
const second = { neck_cm: 40, waist_cm: 91.5, weight_used_kg: 83 }

describe('fórmula da Marinha (métrica)', () => {
  it('medição 1: 20,71 %', () => {
    expect(navyBodyFat(HEIGHT, 40, 94)).toBeCloseTo(20.71, 2)
  })

  it('medição 2: 18,96 %', () => {
    expect(navyBodyFat(HEIGHT, 40, 91.5)).toBeCloseTo(18.96, 2)
  })

  it('bate com a versão em polegadas a menos de 0,2 pp', () => {
    for (const [neck, waist] of [
      [40, 94],
      [40, 91.5],
      [38, 86],
      [42, 102],
    ] as const) {
      const metric = navyBodyFat(HEIGHT, neck, waist)!
      const inches = navyBodyFatInches(HEIGHT, neck, waist)!
      expect(Math.abs(metric - inches)).toBeLessThan(0.2)
    }
  })

  it('cintura igual ou menor do que o pescoço não dá valor', () => {
    expect(navyBodyFat(HEIGHT, 40, 40)).toBeNull()
    expect(navyBodyFat(HEIGHT, 42, 40)).toBeNull()
  })

  it('plausibilidade entre 5 e 45 %', () => {
    expect(isPlausible(20)).toBe(true)
    expect(isPlausible(4.9)).toBe(false)
    expect(isPlausible(45.1)).toBe(false)
    expect(isPlausible(null)).toBe(false)
  })
})

describe('gordura e massa magra', () => {
  it('medição 1: gordura 17,61 kg, magra 67,39 kg; no ecrã 17,5 kg (cerca de 21 %) e 67,5 kg', () => {
    const c = composition(HEIGHT, first)!
    expect(c.fatKg).toBeCloseTo(17.61, 2)
    expect(c.leanKg).toBeCloseTo(67.39, 2)
    expect(c.shown).toEqual({ pct: 21, fatKg: 17.5, leanKg: 67.5 })
  })

  it('intervalo de ±4 pp: 17–25 % e 14,2–21,0 kg', () => {
    const c = composition(HEIGHT, first)!
    expect(c.range.pct).toEqual([17, 25])
    expect(c.range.fatKg).toEqual([14.2, 21])
  })

  it('medição 2 no ecrã: gordura 15,5 kg, magra 67,5 kg, cerca de 19 %', () => {
    expect(composition(HEIGHT, second)!.shown).toEqual({ pct: 19, fatKg: 15.5, leanKg: 67.5 })
  })

  it('diferenças a partir dos valores mostrados: 2 kg de gordura a menos, magra estável, confirmada', () => {
    const change = compareCompositions(composition(HEIGHT, first)!, composition(HEIGHT, second)!)
    expect(change.fatKg).toBe(-2)
    expect(change.leanKg).toBe(0)
    expect(change.leanStable).toBe(true)
    expect(change.confirmed).toBe(true)
    expect(change.pctExact).toBeCloseTo(-1.75, 2)
    expect(changeSentence(change)).toBe('cerca de 2 kg de gordura a menos, massa magra estável')
    expect(confirmationSentence(change)).toBe('a fita já confirma esta descida')
  })

  it('abaixo de 1,5 pp fica dentro da margem da fita', () => {
    const a = composition(HEIGHT, first)!
    const b = composition(HEIGHT, { ...first, waist_cm: 93, weight_used_kg: 84.5 })!
    const change = compareCompositions(a, b)
    expect(change.confirmed).toBe(false)
    expect(confirmationSentence(change)).toMatch(/margem da fita/)
  })

  it('arredonda os kg a 0,5', () => {
    expect(roundHalf(17.61)).toBe(17.5)
    expect(roundHalf(67.26)).toBe(67.5)
    expect(roundHalf(15.74)).toBe(15.5)
  })

  it('a pesagem crua inventaria músculo: 86,5 kg daria 68,58 kg de magra', () => {
    const raw = composition(HEIGHT, { ...first, weight_used_kg: 86.5 })!
    expect(raw.leanKg).toBeCloseTo(68.58, 2)
  })
})

describe('cintura alvo', () => {
  it('com pescoço 40: 15 % → 86,2 cm; 20 % → 93,0 cm', () => {
    expect(targetWaist(HEIGHT, 40, 15)).toBeCloseTo(86.2, 1)
    expect(targetWaist(HEIGHT, 40, 20)).toBeCloseTo(93.0, 1)
  })

  it('é a inversa da fórmula', () => {
    const waist = targetWaist(HEIGHT, 41, 18)!
    expect(navyBodyFat(HEIGHT, 41, waist)).toBeCloseTo(18, 6)
  })
})

describe('peso usado e leituras', () => {
  const weights = [
    { date: '2026-09-20', kg: 86 },
    { date: '2026-09-24', kg: 85.2 },
    { date: '2026-09-27', kg: 84.8 },
    { date: '2026-09-28', kg: 85 },
  ]

  it('média das pesagens nos 7 dias até ao dia da medição', () => {
    expect(referenceWeight(weights, '2026-09-28')).toBe(85)
    expect(referenceWeight(weights, '2026-09-26')).toBe(85.6)
  })

  it('sem pesagens na janela, pede o peso', () => {
    expect(referenceWeight(weights, '2026-09-10')).toBeNull()
  })

  it('média das leituras e 3.ª leitura só acima de 1 cm de diferença', () => {
    expect(averageReadings([94, 94.5])).toBe(94.3)
    expect(averageReadings([94])).toBe(94)
    expect(averageReadings([])).toBeNull()
    expect(needsThirdReading(94, 95)).toBe(false)
    expect(needsThirdReading(94, 95.2)).toBe(true)
  })

  it('validação com texto simples', () => {
    expect(checkZone('waist', 40)).toBe('40 cm na cintura? Parece pouco. Confirma.')
    expect(checkZone('neck', 40)).toBeNull()
    expect(checkZone('neck', 70)).toMatch(/Parece muito/)
  })
})

describe('avisos e lembretes', () => {
  it('marca pausa da dieta, jantar fora, pescoço e cintura que mudaram muito', () => {
    const flags = measureFlags({
      pct: 21,
      neck: 42,
      waist: 90,
      previous: { date: '2026-09-20', neck_cm: 40, waist_cm: 94 },
      date: '2026-09-28',
      maintenance: true,
      dinnerOutYesterday: true,
    })
    expect(flags).toEqual(['pausa_dieta', 'depois_jantar_fora', 'pescoco_mudou', 'cintura_mudou'])
  })

  it('gordura fora de 5–45 % fica marcada (não bloqueia)', () => {
    expect(
      measureFlags({ pct: 3, neck: 40, waist: 60, previous: null, date: '2026-09-28', maintenance: false, dinnerOutYesterday: false }),
    ).toEqual(['plausibilidade'])
  })

  it('dias desde a última medição e primeiras semanas de dieta', () => {
    expect(daysSinceMeasure('2026-09-13', '2026-09-28')).toBe(15)
    expect(daysSinceMeasure(null, '2026-09-28')).toBeNull()
    expect(earlyDietWeeks('2026-09-15', '2026-09-28')).toBe(true)
    expect(earlyDietWeeks('2026-09-01', '2026-09-28')).toBe(false)
  })

  it('balança: média suavizada à parte', () => {
    expect(scaleFatAverage([24, 22, 23, 25])).toBe(23.8)
    expect(scaleFatAverage([])).toBeNull()
  })
})

// Mulheres: a fórmula leva a anca (com a dos homens a Joana dava 13 %).
describe('navyBodyFat (mulheres)', () => {
  const inchesFemale = (h: number, neck: number, waist: number, hips: number) => {
    const inch = (cm: number) => cm / 2.54
    return 163.205 * Math.log10(inch(waist) + inch(hips) - inch(neck)) - 97.684 * Math.log10(inch(h)) - 78.387
  }

  it('usa cintura + anca − pescoço e bate com a versão em polegadas', () => {
    const pct = navyBodyFat(161, 30.5, 70, 100, 'f')!
    expect(pct).toBeGreaterThan(28)
    expect(pct).toBeLessThan(31)
    expect(Math.abs(pct - inchesFemale(161, 30.5, 70, 100))).toBeLessThan(1)
  })

  it('sem anca não há valor', () => {
    expect(navyBodyFat(161, 30.5, 70, null, 'f')).toBeNull()
  })

  it('a cintura alvo devolve a %G alvo', () => {
    const waist = targetWaist(161, 30.5, 25, 'f', 100)!
    expect(navyBodyFat(161, 30.5, waist, 100, 'f')).toBeCloseTo(25, 1)
    expect(targetWaist(161, 30.5, 25, 'f', null)).toBeNull()
  })
})

describe('fatCategory', () => {
  it('homens: 8 · 14 · 20 · 25 · 30', async () => {
    const { fatCategory } = await import('../api/_lib/rules/composicao')
    expect(fatCategory(6, 'm').label).toBe('Muito seco')
    expect(fatCategory(12, 'm').label).toBe('Seco')
    expect(fatCategory(18, 'm').label).toBe('Saudável')
    expect(fatCategory(22, 'm').label).toBe('Gordurinha a mais')
    expect(fatCategory(27, 'm').label).toBe('Excesso de gordura')
    expect(fatCategory(33, 'm').label).toBe('Muita gordura')
  })

  it('mulheres: 15 · 22 · 29 · 34 · 40 (os mesmos 29 % são outra categoria)', async () => {
    const { fatCategory } = await import('../api/_lib/rules/composicao')
    expect(fatCategory(13, 'f').label).toBe('Muito seco')
    expect(fatCategory(25, 'f').label).toBe('Saudável')
    expect(fatCategory(29.3, 'f').label).toBe('Gordurinha a mais')
    expect(fatCategory(29.3, 'm').label).toBe('Excesso de gordura')
    expect(fatCategory(41, 'f').label).toBe('Muita gordura')
  })
})

// O sítio da cintura: umbigo nos homens, parte mais estreita nas mulheres.
// As medições antigas (sem sítio) foram no umbigo.
describe('sítio da cintura', () => {
  it('nas mulheres a cintura natural dá menos gordura do que no umbigo', async () => {
    const { navyBodyFat } = await import('../api/_lib/rules/composicao')
    // altura 165, pescoço 32, anca 98: 80 cm no umbigo contra 73 cm na parte mais estreita
    expect(navyBodyFat(165, 32, 80, 98, 'f')).toBeCloseTo(31.4, 1)
    expect(navyBodyFat(165, 32, 73, 98, 'f')).toBeCloseTo(27.9, 1)
  })

  it('o sítio de cada sexo e o de cada medição', async () => {
    const { measuredWaistSite, sameWaistSite, waistSiteFor, wrongWaistSite } = await import('../api/_lib/rules/composicao')
    expect(waistSiteFor('m')).toBe('umbigo')
    expect(waistSiteFor('f')).toBe('natural')
    expect(measuredWaistSite(null)).toBe('umbigo')
    expect(measuredWaistSite({ waist: [80] })).toBe('umbigo')
    expect(measuredWaistSite({ waist: [73], waist_site: 'natural' })).toBe('natural')
    expect(sameWaistSite({ readings: null }, { readings: { waist_site: 'umbigo' } })).toBe(true)
    expect(sameWaistSite({ readings: null }, { readings: { waist_site: 'natural' } })).toBe(false)
    expect(wrongWaistSite({ readings: null }, 'f')).toBe(true)
    expect(wrongWaistSite({ readings: { waist_site: 'natural' } }, 'f')).toBe(false)
    expect(wrongWaistSite({ readings: null }, 'm')).toBe(false)
  })
})

describe('zonas', () => {
  const rows = [
    { date: '2026-09-01', waist_cm: 80, hips_cm: 100, neck_cm: 32, thigh_cm: 58, readings: null },
    { date: '2026-09-15', waist_cm: 79, hips_cm: 99, neck_cm: 32, readings: null },
    { date: '2026-10-01', waist_cm: 73, hips_cm: '98.5', neck_cm: 32, thigh_cm: 57, readings: { waist_site: 'natural' } },
  ]

  it('mudança desde a medição anterior que tem a zona; a cintura só no mesmo sítio', async () => {
    const { zoneDelta } = await import('../api/_lib/rules/composicao')
    expect(zoneDelta(rows, 1, 'waist')).toBe(-1)
    expect(zoneDelta(rows, 2, 'waist')).toBeNull()
    expect(zoneDelta(rows, 2, 'hips')).toBe(-0.5)
    expect(zoneDelta(rows, 2, 'thigh')).toBe(-1)
    expect(zoneDelta(rows, 2, 'neck')).toBe(0)
    expect(zoneDelta(rows, 0, 'hips')).toBeNull()
    expect(zoneDelta(rows, 1, 'thigh')).toBeNull()
  })

  it('zonas com 2 medições ou mais, com a mudança desde a primeira', async () => {
    const { zoneTrends } = await import('../api/_lib/rules/composicao')
    const trends = zoneTrends(rows)
    expect(trends.map((t) => t.zone)).toEqual(['hips', 'neck', 'thigh'])
    expect(trends[0]).toEqual({ zone: 'hips', values: [100, 99, 98.5], firstDate: '2026-09-01', last: 98.5, change: -1.5 })
    expect(trends[2]).toMatchObject({ zone: 'thigh', values: [58, 57], change: -1 })
    // duas cinturas no mesmo sítio já aparecem
    const more = [...rows, { date: '2026-10-15', waist_cm: 72, readings: { waist_site: 'natural' } }]
    expect(zoneTrends(more)[0]).toMatchObject({ zone: 'waist', values: [73, 72], firstDate: '2026-10-01', change: -1 })
  })

  it('composição de uma medição guardada (os numeric podem vir em texto)', async () => {
    const { measurementComposition } = await import('../api/_lib/rules/composicao')
    expect(measurementComposition(183, { date: '2026-10-01', neck_cm: '40', waist_cm: 94, weight_used_kg: '85' }, 'm')!.pct).toBeCloseTo(
      20.71,
      2,
    )
    expect(measurementComposition(183, { date: '2026-10-01', neck_cm: null, waist_cm: 94, weight_used_kg: 85 }, 'm')).toBeNull()
  })
})
