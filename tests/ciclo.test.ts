import { describe, expect, it } from 'vitest'
import { cleanStarts, cycleInfo } from '../api/_lib/rules/ciclo'

// Ciclo menstrual: explica o peso de água antes do período.
describe('cycleInfo', () => {
  it('sem datas não há nada', () => {
    expect(cycleInfo([], '2026-10-14')).toBeNull()
  })

  it('com uma data usa 28 dias', () => {
    const c = cycleInfo(['2026-10-01'], '2026-10-14')!
    expect(c.dayOfCycle).toBe(14)
    expect(c.length).toBe(28)
    expect(c.nextStart).toBe('2026-10-29')
    expect(c.phase).toBe('ovulacao')
    expect(c.waterWeek).toBe(false)
  })

  it('usa a mediana das durações reais e ignora as estranhas', () => {
    const c = cycleInfo(['2026-07-01', '2026-07-31', '2026-08-30', '2026-09-29', '2026-10-01'], '2026-10-20')!
    // 30, 30, 30 (e 2 dias, ignorado); último início 1/10
    expect(c.length).toBe(30)
    expect(c.nextStart).toBe('2026-10-31')
    expect(c.waterWeek).toBe(false)
    expect(cycleInfo(['2026-10-01'], '2026-10-23')!.waterWeek).toBe(true)
  })

  it('período nos primeiros 5 dias; fase lútea depois da ovulação', () => {
    expect(cycleInfo(['2026-10-01'], '2026-10-03')!.phase).toBe('menstrual')
    expect(cycleInfo(['2026-10-01'], '2026-10-20')!.phase).toBe('lutea')
  })

  it('atrasado: o próximo é hoje', () => {
    const c = cycleInfo(['2026-09-01'], '2026-10-05')!
    expect(c.nextStart).toBe('2026-10-05')
    expect(c.daysToNext).toBe(0)
  })

  it('limpa datas repetidas ou inválidas', () => {
    expect(cleanStarts(['2026-10-01', 'x', '2026-10-01', 3, '2026-09-01'])).toEqual(['2026-09-01', '2026-10-01'])
  })
})
