import { describe, expect, it } from 'vitest'
import {
  cronError,
  monthlyCleanupDue,
  nightStatus,
  retentionCutoff,
  weekNoticeDue,
  weeklyCleanupDue,
} from '../api/_lib/rules/rotinas'

// Rotinas da noite (S1, S4, S9): erros guardados, limpezas que não saltam
// semanas e o aviso do resumo da semana que não se perde depois da segunda.
describe('limpeza semanal (S9)', () => {
  const now = new Date('2026-11-17T05:30:00Z') // terça

  it('ao domingo corre sempre', () => {
    expect(weeklyCleanupDue('2026-11-15', undefined, now)).toBe(true)
    expect(weeklyCleanupDue('2026-11-15', '2026-11-14T05:30:00Z', now)).toBe(true)
  })

  it('sem histórico (tabela por criar), só ao domingo', () => {
    expect(weeklyCleanupDue('2026-11-17', undefined, now)).toBe(false)
  })

  it('o domingo falhou: corre na noite seguinte com a última há mais de 7 dias', () => {
    expect(weeklyCleanupDue('2026-11-17', '2026-11-08T05:40:00Z', now)).toBe(true)
    expect(weeklyCleanupDue('2026-11-17', '2026-11-15T05:40:00Z', now)).toBe(false)
  })

  it('nunca correu: corre', () => {
    expect(weeklyCleanupDue('2026-11-17', null, now)).toBe(true)
  })
})

describe('limpeza mensal (S9)', () => {
  it('uma vez por mês', () => {
    expect(monthlyCleanupDue('2026-11-15', '2026-10-04T05:30:00Z')).toBe(true)
    expect(monthlyCleanupDue('2026-11-22', '2026-11-15T05:30:00Z')).toBe(false)
    expect(monthlyCleanupDue('2026-11-22', null)).toBe(true)
  })

  it('sem histórico, no primeiro domingo do mês', () => {
    expect(monthlyCleanupDue('2026-11-01', undefined)).toBe(true)
    expect(monthlyCleanupDue('2026-11-08', undefined)).toBe(false)
    expect(monthlyCleanupDue('2026-11-02', undefined)).toBe(false)
  })

  it('o corte é de 90 dias', () => {
    expect(retentionCutoff(new Date('2026-11-13T00:00:00Z'))).toBe('2026-08-15T00:00:00.000Z')
  })
})

describe('aviso do resumo da semana (S4)', () => {
  it('sem resumo não avisa', () => {
    expect(weekNoticeDue('2026-11-16', false, false)).toBe(false)
    expect(weekNoticeDue('2026-11-16', false, null)).toBe(false)
  })

  it('o resumo saiu na terça: avisa na terça, uma vez', () => {
    expect(weekNoticeDue('2026-11-17', true, false)).toBe(true)
    expect(weekNoticeDue('2026-11-18', true, true)).toBe(false)
  })

  it('sem histórico fica como antes: só à segunda', () => {
    expect(weekNoticeDue('2026-11-16', true, null)).toBe(true)
    expect(weekNoticeDue('2026-11-17', true, null)).toBe(false)
  })
})

describe('estado da última noite', () => {
  const now = new Date('2026-11-13T09:00:00Z')

  it('sem histórico não diz nada', () => {
    expect(nightStatus(null, now)).toEqual({ kind: 'ok' })
  })

  it('correu bem', () => {
    expect(nightStatus({ started_at: '2026-11-13T05:31:00Z', finished_at: '2026-11-13T05:31:40Z', ok: true, errors: [] }, now)).toEqual({ kind: 'ok' })
  })

  it('com erros, ou sem acabar', () => {
    expect(
      nightStatus({ started_at: '2026-11-13T05:31:00Z', finished_at: '2026-11-13T05:31:40Z', ok: false, errors: [{}, {}] }, now),
    ).toEqual({ kind: 'falhou', errors: 2 })
    expect(nightStatus({ started_at: '2026-11-13T05:31:00Z', finished_at: null, ok: null }, now)).toEqual({ kind: 'falhou', errors: 0 })
    // ainda a correr
    expect(nightStatus({ started_at: '2026-11-13T08:58:00Z', finished_at: null, ok: null }, now)).toEqual({ kind: 'ok' })
  })

  it('parada há mais de 2 dias', () => {
    expect(nightStatus({ started_at: '2026-11-10T05:31:00Z', finished_at: '2026-11-10T05:31:40Z', ok: true }, now)).toEqual({
      kind: 'parada',
      since: '2026-11-10T05:31:00Z',
    })
  })
})

describe('erros da cron', () => {
  it('curtos e com o sítio', () => {
    const error = cronError('fecho', new Error('x'.repeat(500)), { user_id: 'u', date: '2026-11-12' })
    expect(error).toMatchObject({ step: 'fecho', user_id: 'u', date: '2026-11-12' })
    expect(error.message).toHaveLength(200)
    expect(cronError('x', { code: '1' }).message).toBe('{"code":"1"}')
  })
})
