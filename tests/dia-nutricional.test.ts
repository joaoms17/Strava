import { describe, expect, it } from 'vitest'
import { nutritionalDay } from '../api/_lib/rules/nutritional-day'

// Regra 1: dia nutricional das 04:00 às 04:00 locais (Europe/Lisbon).
describe('nutritionalDay', () => {
  // Em setembro, Lisboa está em WEST (UTC+1): 03:59 locais = 02:59Z.
  it('antes das 04:00 locais pertence ao dia anterior', () => {
    expect(nutritionalDay(new Date('2026-09-08T02:59:00Z'), 4)).toBe('2026-09-07')
  })

  it('às 04:00 locais começa o dia novo', () => {
    expect(nutritionalDay(new Date('2026-09-08T03:00:00Z'), 4)).toBe('2026-09-08')
  })

  it('a meio da tarde pertence ao próprio dia', () => {
    expect(nutritionalDay(new Date('2026-09-08T15:00:00Z'), 4)).toBe('2026-09-08')
  })

  it('meia-noite local pertence ao dia anterior', () => {
    // 00:30 locais de 9 de setembro = 23:30Z de 8 de setembro
    expect(nutritionalDay(new Date('2026-09-08T23:30:00Z'), 4)).toBe('2026-09-08')
  })

  // Em janeiro, Lisboa está em WET (UTC+0).
  it('respeita o horário de inverno', () => {
    expect(nutritionalDay(new Date('2026-01-10T03:59:00Z'), 4)).toBe('2026-01-09')
    expect(nutritionalDay(new Date('2026-01-10T04:00:00Z'), 4)).toBe('2026-01-10')
  })

  it('atravessa o fim do mês e do ano', () => {
    // 01:00 locais de 1 de janeiro (WET) -> dia nutricional 31 de dezembro
    expect(nutritionalDay(new Date('2027-01-01T01:00:00Z'), 4)).toBe('2026-12-31')
  })

  it('respeita um cutoff diferente', () => {
    expect(nutritionalDay(new Date('2026-09-08T04:30:00Z'), 6)).toBe('2026-09-07')
  })
})
