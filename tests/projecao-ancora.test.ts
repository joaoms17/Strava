import { describe, expect, it } from 'vitest'
import { anchorFromStore, anchorToStore } from '../src/lib/projecao-ancora'
import type { Projection } from '../api/_lib/rules/projecao'

const eta = { kind: 'date' as const, date: '2027-01-08', early: '2026-12-28', late: '2027-01-20' }
const ok = { status: 'ok', basis: {}, weight: eta, waist: null } as unknown as Projection

describe('a data da projeção já mostrada fica guardada', () => {
  it('guarda a data e o intervalo, com o alvo', () => {
    expect(anchorFromStore(anchorToStore(75, ok), 75)).toEqual({ date: eta.date, early: eta.early, late: eta.late })
  })
  it('outro alvo, sem data ou lixo: sem âncora', () => {
    expect(anchorFromStore(anchorToStore(75, ok), 72)).toBeNull()
    expect(anchorToStore(75, { status: 'insuficiente', countedDays: 3, weighingDays: 3, missing: 'x' })).toBeNull()
    expect(anchorFromStore('{lixo', 75)).toBeNull()
    expect(anchorFromStore(null, 75)).toBeNull()
  })
})
