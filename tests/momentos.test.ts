import { describe, expect, it } from 'vitest'
import {
  clockTime,
  instantInNutritionalDay,
  lisbonInstant,
  loggedAtFor,
  slotOf,
  slotOfMinutes,
} from '../api/_lib/rules/momentos'
import { nutritionalDay } from '../api/_lib/rules/nutritional-day'

describe('momentos do dia', () => {
  it('limites de cada momento', () => {
    expect(slotOfMinutes(4 * 60)).toBe('pequeno_almoco')
    expect(slotOfMinutes(10 * 60 + 59)).toBe('pequeno_almoco')
    expect(slotOfMinutes(11 * 60)).toBe('almoco')
    expect(slotOfMinutes(15 * 60)).toBe('lanche')
    expect(slotOfMinutes(18 * 60 + 29)).toBe('lanche')
    expect(slotOfMinutes(18 * 60 + 30)).toBe('jantar')
    expect(slotOfMinutes(22 * 60)).toBe('ceia')
    expect(slotOfMinutes(2 * 60)).toBe('ceia')
  })

  it('usa a hora de Lisboa, não UTC', () => {
    // 12:30 UTC no verão = 13:30 em Lisboa
    expect(slotOf(new Date('2026-07-10T12:30:00Z'))).toBe('almoco')
    // 10:30 UTC no verão = 11:30 em Lisboa (almoço); em UTC seria pequeno-almoço
    expect(slotOf(new Date('2026-07-10T10:30:00Z'))).toBe('almoco')
  })
})

describe('hora local de Lisboa', () => {
  it('verão (UTC+1) e inverno (UTC+0)', () => {
    expect(lisbonInstant('2026-07-10', '13:00').toISOString()).toBe('2026-07-10T12:00:00.000Z')
    expect(lisbonInstant('2026-12-10', '13:00').toISOString()).toBe('2026-12-10T13:00:00.000Z')
  })

  it('no dia da mudança de hora', () => {
    // 25 out 2026: às 02:00 de verão volta à 01:00; 13:00 já é hora de inverno
    expect(lisbonInstant('2026-10-25', '13:00').toISOString()).toBe('2026-10-25T13:00:00.000Z')
    // 29 mar 2026: 13:00 já é hora de verão
    expect(lisbonInstant('2026-03-29', '13:00').toISOString()).toBe('2026-03-29T12:00:00.000Z')
  })

  it('ceia depois da meia-noite fica no dia nutricional certo', () => {
    const instant = instantInNutritionalDay('2026-09-27', '01:30', 4)
    expect(instant.toISOString()).toBe('2026-09-28T00:30:00.000Z')
    expect(nutritionalDay(instant, 4)).toBe('2026-09-27')
  })

  it('um momento de um dia passado cai nesse dia nutricional', () => {
    for (const time of ['08:00', '13:00', '16:30', '20:00', '22:30']) {
      const instant = instantInNutritionalDay('2026-09-26', time, 4)
      expect(nutritionalDay(instant, 4)).toBe('2026-09-26')
      expect(clockTime(instant)).toBe(time)
    }
  })

  it('nunca devolve uma hora no futuro', () => {
    const now = new Date('2026-09-28T11:00:00Z') // 12:00 em Lisboa
    expect(loggedAtFor('2026-09-28', '20:00', 4, now)).toEqual(now)
    expect(loggedAtFor('2026-09-28', '08:00', 4, now).toISOString()).toBe(
      '2026-09-28T07:00:00.000Z',
    )
  })
})
