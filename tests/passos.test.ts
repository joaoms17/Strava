import { describe, expect, it } from 'vitest'
import { daySteps } from '../api/_lib/rules/passos'

const rows = [
  { date: '2026-10-06', steps: 4200 },
  { date: '2026-10-05', steps: 9000 },
  { date: '2026-10-04', steps: 7000 },
  { date: '2026-10-03', steps: null },
  { date: '2026-10-02', steps: 8000 },
  { date: '2026-08-01', steps: 30000 },
]

describe('daySteps', () => {
  it('os passos do dia e a média dos 30 dias antes (sem o próprio dia nem dias vazios)', () => {
    expect(daySteps(rows, '2026-10-06')).toEqual({ steps: 4200, avg: 8000 })
  })

  it('sem passos nesse dia não mostra nada', () => {
    expect(daySteps(rows, '2026-10-03')).toBeNull()
    expect(daySteps([{ date: '2026-10-06', steps: 0 }], '2026-10-06')).toBeNull()
    expect(daySteps([], '2026-10-06')).toBeNull()
  })

  it('com menos de 3 dias antes, sem média', () => {
    expect(daySteps(rows, '2026-10-04')).toEqual({ steps: 7000, avg: null })
  })
})
