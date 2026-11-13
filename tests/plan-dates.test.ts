import { describe, expect, it } from 'vitest'
import { sessionDate } from '../api/_lib/rules/plan-dates'

describe('sessionDate', () => {
  it('deriva a data de semana + day_index (0 = segunda)', () => {
    expect(sessionDate('2026-09-14', 1, 0)).toBe('2026-09-14')
    expect(sessionDate('2026-09-14', 1, 3)).toBe('2026-09-17')
    expect(sessionDate('2026-09-14', 4, 6)).toBe('2026-10-11')
  })
})
