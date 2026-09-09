import { describe, expect, it } from 'vitest'
import { blockWeekOf, mondayOnOrAfter, sessionDate } from '../api/_lib/rules/plan-dates'

describe('sessionDate', () => {
  it('deriva a data de semana + day_index (0 = segunda)', () => {
    expect(sessionDate('2026-09-14', 1, 0)).toBe('2026-09-14')
    expect(sessionDate('2026-09-14', 1, 3)).toBe('2026-09-17')
    expect(sessionDate('2026-09-14', 4, 6)).toBe('2026-10-11')
  })
})

describe('blockWeekOf', () => {
  it('diz em que semana do bloco cai uma data', () => {
    expect(blockWeekOf('2026-09-14', '2026-09-14')).toBe(1)
    expect(blockWeekOf('2026-09-14', '2026-09-20')).toBe(1)
    expect(blockWeekOf('2026-09-14', '2026-09-21')).toBe(2)
    expect(blockWeekOf('2026-09-14', '2026-10-11')).toBe(4)
    expect(blockWeekOf('2026-09-14', '2026-10-12')).toBe(5)
  })
})

describe('mondayOnOrAfter', () => {
  it('devolve a própria data quando já é segunda', () => {
    expect(mondayOnOrAfter('2026-09-14')).toBe('2026-09-14')
  })

  it('avança até à segunda seguinte', () => {
    expect(mondayOnOrAfter('2026-09-09')).toBe('2026-09-14') // quarta
    expect(mondayOnOrAfter('2026-09-13')).toBe('2026-09-14') // domingo
  })
})
