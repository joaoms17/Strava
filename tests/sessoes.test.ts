import { describe, expect, it } from 'vitest'
import { mergeSessions } from '../api/_lib/rules/sessoes'
import { planProgress, weeklyStats } from '../api/_lib/rules/plano'

// O relógio às vezes parte um treino em dois (parou e recomeçou): conta um só.
const part = (over: Record<string, unknown>) => ({
  id: '' as string,
  date: '2026-10-05',
  type: 'bike' as const,
  sport: 'VirtualRide',
  minutes: 10,
  ...over,
})

describe('sessões partidas', () => {
  it('a bicicleta das 15h: 10 + 25 min seguidos são um treino de 35 min', () => {
    const merged = mergeSessions([
      part({ id: 'b', started_at: '2026-10-05T15:03:50Z', minutes: 25, moving_s: 1500, elapsed_s: 1500, avg_hr: 143, max_hr: 155, kcal_device: 352, training_load: '24.0' }),
      part({ id: 'a', started_at: '2026-10-05T14:53:15Z', minutes: 10, moving_s: 576, elapsed_s: 580, avg_hr: 118, max_hr: 139, kcal_device: 98, training_load: '5.0' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'a',
      minutes: 35,
      moving_s: 2076,
      elapsed_s: 2135, // das 14:53:15 às 15:28:50
      avg_hr: 136, // (118×10 + 143×25) / 35
      max_hr: 155,
      kcal_device: 450,
      training_load: 29,
    })
    expect(merged[0]!.parts.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('não junta: outro tipo, outro desporto, outro dia, mais de 30 min de intervalo ou sem hora', () => {
    const rows = [
      part({ id: '1', started_at: '2026-10-05T08:00:00Z', minutes: 30 }),
      part({ id: '2', started_at: '2026-10-05T09:15:00Z', minutes: 30 }), // 45 min depois
      part({ id: '3', type: 'strength', sport: null, started_at: '2026-10-05T09:50:00Z', minutes: 40 }),
      part({ id: '4', type: 'other', sport: 'corrida', started_at: '2026-10-05T10:35:00Z', minutes: 20 }),
      part({ id: '5', type: 'other', sport: 'caminhada', started_at: '2026-10-05T11:00:00Z', minutes: 20 }),
      part({ id: '6', date: '2026-10-06', started_at: '2026-10-05T23:30:00Z', minutes: 20 }),
      part({ id: '7', started_at: null, minutes: 20 }),
      part({ id: '8', started_at: null, minutes: 20 }),
    ]
    expect(mergeSessions(rows).map((s) => s.parts.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('ginásio em duas partes também junta; a semana e o plano contam um treino', () => {
    const rows = [
      part({ id: 'g1', type: 'strength', sport: null, started_at: '2026-10-06T18:00:00Z', minutes: 20 }),
      part({ id: 'g2', type: 'strength', sport: null, started_at: '2026-10-06T18:25:00Z', minutes: 30 }),
      part({ id: 'a', started_at: '2026-10-05T14:53:15Z', minutes: 10, elapsed_s: 580 }),
      part({ id: 'b', started_at: '2026-10-05T15:03:50Z', minutes: 25, elapsed_s: 1500 }),
    ].map((r) => ({ ...r, date: r.id.startsWith('g') ? '2026-10-06' : '2026-10-05' }))
    const week = weeklyStats(rows, ['2026-10-05'])[0]!
    expect(week.bike).toMatchObject({ sessions: 1, minutes: 35 })
    expect(week.gym).toEqual({ sessions: 1, minutes: 50 })
    const progress = planProgress({ bicicleta: [{}, {}] as never, ginasio: [{}] as never }, rows)
    expect(progress.bike.map((b) => b?.minutes ?? null)).toEqual([35, null])
    expect(progress.gym[0]?.minutes).toBe(50)
  })
})

describe('falta informação', () => {
  it('bicicleta do relógio sem km nem potência, de 15 min ou mais', async () => {
    const { missingInfo } = await import('../api/_lib/rules/sessoes')
    const ride = { date: '2026-10-05', type: 'bike' as const, source: 'intervals', minutes: 25, distance_km: null, watts: null }
    expect(missingInfo(ride)).toEqual(['os km', 'a potência'])
    expect(missingInfo({ ...ride, minutes: 10 })).toEqual([])
    expect(missingInfo({ ...ride, distance_km: 12.88 })).toEqual([])
    expect(missingInfo({ ...ride, source: 'manual' })).toEqual([])
    expect(missingInfo({ ...ride, type: 'strength' })).toEqual([])
  })
})

describe('possível duplicado', () => {
  const ride = {
    id: 'relogio',
    date: '2026-10-14',
    type: 'bike' as const,
    sport: 'VirtualRide',
    source: 'intervals',
    external_id: 'i1',
    started_at: '2026-10-14T06:02:00Z',
    minutes: 47,
    raw: null,
  }
  const jaFiz = {
    id: 'mao',
    date: '2026-10-14',
    type: 'bike' as const,
    sport: null,
    source: 'manual',
    external_id: null,
    started_at: '2026-10-14T19:15:00Z',
    minutes: 45,
    raw: { hora_estimada: true },
  }

  it('o «Já fiz» das 21:00 e a bicicleta do relógio das 07:00', async () => {
    const { possibleDuplicates } = await import('../api/_lib/rules/sessoes')
    expect([...possibleDuplicates([ride, jaFiz])].sort()).toEqual(['mao', 'relogio'])
    // Antes desta marca, um registo à mão também não tem hora de confiança.
    expect(possibleDuplicates([ride, { ...jaFiz, raw: null }]).size).toBe(2)
  })

  it('não avisa: dois do relógio, horas conhecidas longe, outro dia, outra duração ou outro desporto', async () => {
    const { possibleDuplicates } = await import('../api/_lib/rules/sessoes')
    expect(possibleDuplicates([ride, { ...ride, id: 'tarde', external_id: 'i2', started_at: '2026-10-14T17:00:00Z' }]).size).toBe(0)
    const print = { ...jaFiz, id: 'print', source: 'screenshot', raw: null }
    expect(possibleDuplicates([ride, print]).size).toBe(0) // print às 20:15, relógio às 07:02
    expect(possibleDuplicates([ride, { ...print, started_at: '2026-10-14T06:20:00Z' }]).size).toBe(2)
    expect(possibleDuplicates([ride, { ...jaFiz, date: '2026-10-15' }]).size).toBe(0)
    expect(possibleDuplicates([ride, { ...jaFiz, minutes: 60 }]).size).toBe(0)
    const walk = { ...jaFiz, type: 'other' as const, sport: 'caminhada' }
    expect(possibleDuplicates([{ ...walk, id: 'w1' }, { ...walk, id: 'w2', sport: 'corrida' }]).size).toBe(0)
  })
})

describe('minutos por zona', () => {
  it('soma a zona pedida nas sessões que a têm', async () => {
    const { zoneMinutes } = await import('../api/_lib/rules/sessoes')
    const zones = (z2: number) => [
      { zone: 1, seconds: 300 },
      { zone: 2, seconds: z2 },
    ]
    expect(zoneMinutes([{ hr_zones: zones(1500) }, { hr_zones: zones(1230) }, { hr_zones: null }], 2)).toBe(46)
    expect(zoneMinutes([{ hr_zones: null }, {}], 2)).toBeNull()
  })
})
