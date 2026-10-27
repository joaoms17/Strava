import { describe, expect, it } from 'vitest'
import {
  checkNeck,
  explainFatChange,
  explainMeasurement,
  measureFlags,
  measurementComposition,
  navyBodyFat,
  neckChoice,
  neckQuestion,
  neckUses,
  targetWaist,
  usualNeck,
  usualNeckLabel,
  withReferenceNeck,
} from '../api/_lib/rules/composicao'
import { fatMarks, fatReading } from '../api/_lib/rules/leituras'

// O caso do João (183 cm): 29/9 cintura 94 pescoço 37; 13/10 90/37; 27/10 88/35.
const joao = [
  { date: '2026-09-29', waist_cm: 94, neck_cm: 37, weight_used_kg: 92.4, readings: { waist_site: 'umbigo' } },
  { date: '2026-10-13', waist_cm: 90, neck_cm: 37, weight_used_kg: 91.2, readings: { waist_site: 'umbigo' } },
  { date: '2026-10-27', waist_cm: 88, neck_cm: 35, weight_used_kg: 90.3, readings: { waist_site: 'umbigo' }, flags: ['pescoco_mudou'] },
]
const H = 183
const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10)

describe('o caso do João', () => {
  it('a fórmula dá 22,7 · 20,0 · 20,0 e 18,6 com o pescoço 37', () => {
    expect(r1(navyBodyFat(H, 37, 94))).toBe(22.7)
    expect(r1(navyBodyFat(H, 37, 90))).toBe(20)
    expect(r1(navyBodyFat(H, 35, 88))).toBe(20)
    expect(r1(navyBodyFat(H, 37, 88))).toBe(18.6)
  })

  it('a cintura desceu 2 cm (−1,4) e o pescoço 2 cm (+1,4): ficou igual', () => {
    const e = explainFatChange(H, 'm', { neck: 37, waist: 90 }, { neck: 35, waist: 88 }, { neckSuspect: true })!
    expect(e.parts.map((p) => [p.zone, p.cm, r1(p.pp)])).toEqual([
      ['waist', -2, -1.4],
      ['neck', -2, 1.4],
    ])
    // As partes somam a mudança total, sem resto.
    expect(e.parts.reduce((a, p) => a + p.pp, 0)).toBeCloseTo(e.total, 10)
    expect(e.text).toBe(
      'A cintura desceu 2 cm (−1,4 pontos), mas o pescoço também desceu 2 cm (+1,4 pontos): ficou igual. O pescoço raramente muda tanto — confirma a medida.',
    )
  })

  it('29/9 → 13/10: só a cintura', () => {
    const e = explainFatChange(H, 'm', { neck: 37, waist: 94 }, { neck: 37, waist: 90 })!
    expect(e.text).toBe('A cintura desceu 4 cm: −2,7 pontos.')
  })

  it('o 27/10 (sem escolha) é um pescoço fora do habitual por confirmar: conta 37 e dá 18,6 %', () => {
    const uses = neckUses(joao)
    expect(uses[0]).toMatchObject({ outlier: false, useUsual: false, used: 37 })
    expect(uses[2]).toMatchObject({ measured: 35, usual: 37, change: -2, basis: 'anterior', outlier: true, choice: null, useUsual: true, used: 37 })
    const rows = withReferenceNeck(joao)
    expect(rows[2]!.neck_cm).toBe(37)
    expect(r1(measurementComposition(H, rows[2]!, 'm')!.pct)).toBe(18.6)
    // A cintura alvo também conta com o habitual.
    expect(Math.round(targetWaist(H, rows[2]!.neck_cm, 15)!)).toBe(Math.round(targetWaist(H, 37, 15)!))
    expect(usualNeckLabel(37)).toBe('calculado com o pescoço habitual (37 cm)')
  })

  it('a explicação do 27/10 oferece «Está certo» e diz a %G com o habitual', () => {
    const x = explainMeasurement(joao, 2, H, 'm')!
    expect(x.previousDate).toBe('2026-10-13')
    expect(x.askConfirm).toBe(true)
    expect(r1(x.usedPct)).toBe(18.6)
    expect(x.change.text).toMatch(/ficou igual\. O pescoço raramente muda tanto/)
    expect(x.usualNote).toBe('Com o pescoço habitual (37 cm), conta só a cintura: 18,6 % (−1,4 pontos).')
  })

  it('«Está certo» aceita 35: volta aos 20,0 % e sem aviso', () => {
    const confirmed = joao.map((r, i) => (i === 2 ? { ...r, readings: { ...r.readings, neck_confirmed: true } } : r))
    expect(neckChoice(confirmed[2]!.readings)).toBe('confirmado')
    expect(withReferenceNeck(confirmed)[2]!.neck_cm).toBe(35)
    const x = explainMeasurement(confirmed, 2, H, 'm')!
    expect(x.askConfirm).toBe(false)
    expect(x.usualNote).toBeNull()
    expect(r1(x.usedPct)).toBe(20)
    expect(x.change.text).not.toMatch(/raramente/)
  })

  it('«Usar o pescoço habitual» conta 37, sem o aviso de confirmar', () => {
    const usual = joao.map((r, i) => (i === 2 ? { ...r, readings: { ...r.readings, neck_confirmed: false } } : r))
    const x = explainMeasurement(usual, 2, H, 'm')!
    expect(neckChoice(usual[2]!.readings)).toBe('habitual')
    expect(r1(x.usedPct)).toBe(18.6)
    expect(x.change.text).not.toMatch(/raramente/)
    expect(x.askConfirm).toBe(true)
  })

  it('a pergunta ao guardar', () => {
    const c = checkNeck({ neck: 35, previousNecks: [37, 37], weightKg: 90.3, previousWeightKg: 91.2 })
    expect(c.outlier).toBe(true)
    expect(neckQuestion(c)).toBe('O pescoço mudou 2 cm desde a última vez. Medir outra vez?')
    expect(measureFlags({ pct: 20, neck: 35, waist: 88, previous: null, date: '2026-10-27', maintenance: false, dinnerOutYesterday: false, neckOutlier: true })).toEqual([
      'pescoco_mudou',
    ])
  })
})

describe('o pescoço habitual', () => {
  it('mediana das 3 anteriores; com menos, a anterior', () => {
    expect(usualNeck([])).toBeNull()
    expect(usualNeck([38, 37])).toBe(37)
    expect(usualNeck([40, 37, 37.4, 37.2])).toBe(37.2)
  })

  it('até 1 cm não é nada; uma mudança grande de peso justifica', () => {
    expect(checkNeck({ neck: 36, previousNecks: [37], weightKg: 90, previousWeightKg: 90 }).outlier).toBe(false)
    expect(checkNeck({ neck: 35.9, previousNecks: [37], weightKg: 90, previousWeightKg: 90 }).outlier).toBe(true)
    expect(checkNeck({ neck: 35, previousNecks: [37], weightKg: 82, previousWeightKg: 90 }).outlier).toBe(false)
    const c = checkNeck({ neck: 39, previousNecks: [37, 37.2, 36.8], weightKg: 90, previousWeightKg: 90 })
    expect(c).toMatchObject({ usual: 37, change: 2, basis: 'habitual', outlier: true })
    expect(neckQuestion(c)).toBe('O pescoço está 2 cm acima do habitual (37 cm). Medir outra vez?')
  })

  it('repetir a leitura nova faz dela o habitual (sem ficar presa para sempre)', () => {
    const rows = [37, 37, 37, 35, 35, 35].map((neck, i) => ({ date: `2026-0${i + 1}-01`, waist_cm: 90, neck_cm: neck, weight_used_kg: 90 }))
    expect(neckUses(rows).map((u) => u!.useUsual)).toEqual([false, false, false, true, true, false])
  })
})

describe('a explicação nas mulheres (com anca)', () => {
  it('cintura, anca e pescoço somam a mudança', () => {
    const e = explainFatChange(H - 18, 'f', { neck: 32.5, waist: 78, hips: 102 }, { neck: 32.5, waist: 76, hips: 101 })!
    expect(e.parts.map((p) => p.zone)).toEqual(['waist', 'hips'])
    expect(e.parts.reduce((a, p) => a + p.pp, 0)).toBeCloseTo(e.total, 10)
    expect(e.text).toMatch(/^A cintura desceu 2 cm \(−\d,\d pontos\) e a anca desceu 1 cm \(−\d,\d pontos\): no total, −\d,\d pontos\.$/)
  })

  it('três medidas a mexer: as partes somam o total', () => {
    const e = explainFatChange(165, 'f', { neck: 32, waist: 78, hips: 102 }, { neck: 34, waist: 75, hips: 103 })!
    expect(e.parts).toHaveLength(3)
    expect(e.parts.reduce((a, p) => a + p.pp, 0)).toBeCloseTo(e.total, 10)
  })

  it('sem anca não há explicação', () => {
    expect(explainFatChange(165, 'f', { neck: 32, waist: 78 }, { neck: 32, waist: 76 })).toBeNull()
  })

  it('nada mudou', () => {
    expect(explainFatChange(H, 'm', { neck: 37, waist: 90 }, { neck: 37, waist: 90 })!.text).toBe('As medidas da fórmula ficaram iguais: a %G também.')
  })
})

describe('o gráfico da %G', () => {
  const pts = [
    { date: '2026-09-29', value: 22.7 },
    { date: '2026-10-13', value: 20.0 },
    { date: '2026-10-27', value: 18.6 },
  ]
  it('o título', () => {
    expect(fatReading(pts, 18.6, '2026-10-27')).toBe('−4,1 pontos desde 29 set · a mais baixa de sempre')
    expect(fatReading(pts.slice(0, 1), null, '2026-10-27')).toBe('22,7 % a 29 set')
    expect(fatReading([], null, '2026-10-27')).toMatch(/Mede/)
    expect(fatReading([pts[1]!, { date: '2026-10-27', value: 20.0 }], 18, '2026-10-27')).toBe('Igual desde 13 out (20,0 %)')
  })
  it('os marcos: início e a última (a mais baixa só no meio)', () => {
    expect(fatMarks(pts).map((m) => m.label)).toEqual(['22,7 · início', '18,6'])
    expect(fatMarks([pts[0]!, { date: '2026-10-13', value: 18 }, pts[2]!]).map((m) => m.id)).toEqual(['inicio', 'baixa', 'ultima'])
  })
})
