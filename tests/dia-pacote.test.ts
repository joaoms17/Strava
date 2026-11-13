import { describe, expect, it } from 'vitest'
import { dayBundleArgs, dayBundleMissing, parseDayBundle } from '../src/lib/dia-pacote'

// P1: o dia do Hoje num só pedido (day_bundle, migração 20261113000062).
describe('o dia num só pedido', () => {
  const date = '2026-11-13' // sexta-feira
  const good = () => ({
    version: 1,
    date,
    meals: [{ id: 'a', date, logged_at: '2026-11-13T08:00:00+00:00', kcal: 400 }],
    deleted: [{ id: 'b', date, deleted_at: '2026-11-13T09:00:00+00:00' }],
    workouts: [{ id: 'w', date }],
    weights: [{ date, kg: 82.4, measured_at: null, created_at: '2026-11-13T07:00:00+00:00' }],
    yesterday_meals: [{ id: 'y', date: '2026-11-12', status: 'ok', kcal: 600 }],
    days: [{ date: '2026-11-10' }, { date: '2026-11-12' }, { date }],
    tdee: 2450,
    health: [{ date, steps: 9000 }, { date: '2026-11-12', sleep_minutes: 420 }],
  })

  it('os argumentos são os limites dos pedidos separados', () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    expect(dayBundleArgs(date, now)).toEqual({
      p_date: date,
      p_days_from: '2026-11-09', // segunda-feira desta semana
      p_health_from: '2026-10-14', // 30 dias antes (passos)
      p_deleted_since: '2026-11-06T12:00:00.000Z',
    })
    // À segunda-feira, os dias começam na véspera (domingo, da semana anterior).
    expect(dayBundleArgs('2026-11-09', now).p_days_from).toBe('2026-11-08')
  })

  it('uma resposta certa passa como está', () => {
    const bundle = parseDayBundle(good(), date)
    expect(bundle).not.toBeNull()
    expect(bundle!.meals).toHaveLength(1)
    expect(bundle!.yesterdayMeals[0]!.id).toBe('y')
    expect(bundle!.tdee).toBe(2450)
    expect(bundle!.days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-12', date])
  })

  it('sem gasto estimado: tdee null; listas vazias valem', () => {
    const empty = { ...good(), meals: [], deleted: [], workouts: [], weights: [], yesterday_meals: [], days: [], health: [], tdee: null }
    expect(parseDayBundle(empty, date)).toMatchObject({ tdee: null, meals: [] })
  })

  it('não usa uma resposta de outro dia, de outra versão ou estragada', () => {
    expect(parseDayBundle(good(), '2026-11-14')).toBeNull()
    expect(parseDayBundle({ ...good(), version: 2 }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), meals: null }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), workouts: [1, 2] }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), tdee: 'muito' }, date)).toBeNull()
    expect(parseDayBundle(null, date)).toBeNull()
    expect(parseDayBundle([good()], date)).toBeNull()
  })

  it('não usa linhas de outro dia (refeições, véspera, dias ou relógio do futuro)', () => {
    expect(parseDayBundle({ ...good(), meals: [{ id: 'a', date: '2026-11-12' }] }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), yesterday_meals: [{ id: 'y', date }] }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), days: [{ date: '2026-11-14' }] }, date)).toBeNull()
    expect(parseDayBundle({ ...good(), health: [{ date: '2026-11-14' }] }, date)).toBeNull()
  })

  it('a função em falta reconhece-se (e uma falha de rede não)', () => {
    expect(dayBundleMissing({ code: 'PGRST202', message: 'Could not find the function public.day_bundle' }, 404)).toBe(true)
    expect(dayBundleMissing({ message: 'x' }, 404)).toBe(true)
    expect(dayBundleMissing({ message: 'Failed to fetch' }, 0)).toBe(false)
    expect(dayBundleMissing(null, 200)).toBe(false)
  })
})
