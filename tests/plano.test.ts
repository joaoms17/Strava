import { describe, expect, it } from 'vitest'
import { shiftDate } from '../api/_lib/rules/nutritional-day'
import {
  cleanPlan,
  cleanPrefs,
  bikeEfficiency,
  fitnessSeries,
  isDeloadWeek,
  preferIcuForm,
  lastMondays,
  planProgress,
  sessionLoad,
  weekNumber,
  weeklyStats,
  cleanWellness,
  wellnessTrend,
  type PlanWorkout,
} from '../api/_lib/rules/plano'

const w = (over: Partial<PlanWorkout> & { date: string }): PlanWorkout => ({
  type: 'bike',
  minutes: 60,
  training_load: null,
  watts: null,
  avg_hr: null,
  ...over,
})

describe('plano semanal', () => {
  it('preferências: valores válidos, início na segunda-feira', () => {
    expect(cleanPrefs(null)).toBeNull()
    expect(cleanPrefs({ ativo: true })).toBeNull()
    expect(cleanPrefs({ ativo: true, bicicleta: 3, ginasio: 3, inicio: '2026-10-07' })).toEqual({
      ativo: true,
      bicicleta: 3,
      ginasio: 3,
      inicio: '2026-10-05',
    })
    expect(cleanPrefs({ ativo: 'sim', bicicleta: 12, ginasio: -1, inicio: '2026-10-05' })).toMatchObject({
      ativo: false,
      bicicleta: 6,
      ginasio: 0,
    })
  })

  it('número da semana desde o início e descarga a cada 4', () => {
    expect(weekNumber('2026-10-05', '2026-10-05')).toBe(1)
    expect(weekNumber('2026-10-05', '2026-10-08')).toBe(1)
    expect(weekNumber('2026-10-05', '2026-10-12')).toBe(2)
    expect(weekNumber('2026-10-05', '2026-11-02')).toBe(5)
    expect(weekNumber('2026-10-05', '2026-09-28')).toBe(1)
    expect([1, 2, 3, 4, 8].map(isDeloadWeek)).toEqual([false, false, false, true, true])
  })

  it('carga: a do intervals.icu ou uma estimativa pelos minutos', () => {
    expect(sessionLoad(w({ date: '2026-10-01', training_load: 52 }))).toBe(52)
    expect(sessionLoad(w({ date: '2026-10-01', minutes: 60 }))).toBe(45)
    expect(sessionLoad(w({ date: '2026-10-01', type: 'strength', minutes: 50 }))).toBe(25)
  })

  it('forma e fadiga: sobem com o treino, a fadiga mais depressa', () => {
    // Sem treino nas primeiras semanas parte do zero.
    const workouts = [w({ date: '2026-11-15', training_load: 70 })]
    const series = fitnessSeries(workouts, '2026-10-01', '2026-11-17')
    expect(series[0]!.ctl).toBe(0)
    const day = series.find((p) => p.date === '2026-11-15')!
    expect(day.ctl).toBeCloseTo(1.7, 1)
    expect(day.atl).toBe(10)
    expect(day.tsb).toBeLessThan(0)
    expect(series[series.length - 1]!.atl).toBeLessThan(day.atl)
  })

  it('com o mesmo treino todas as semanas a forma não sobe sozinha', () => {
    // 3 bicicletas por semana de 50 de carga, durante 18 semanas.
    const workouts: PlanWorkout[] = []
    for (let d = '2026-06-01'; d <= '2026-10-04'; d = shiftDate(d, 7)) {
      for (const k of [0, 2, 4]) workouts.push(w({ date: shiftDate(d, k), training_load: 50 }))
    }
    const series = fitnessSeries(workouts, '2026-06-01', '2026-10-04')
    const weekly = series.filter((_, i) => i % 7 === 6).map((p) => p.ctl)
    // Antes, o primeiro ponto vinha a ~60 % e a linha subia; agora fica à volta da média (≈ 21,4).
    for (const ctl of weekly) expect(ctl).toBeGreaterThan(18)
    expect(Math.max(...weekly) - Math.min(...weekly)).toBeLessThan(4)
  })

  it('forma do intervals.icu quando cobre o período; senão a da app', () => {
    const local = fitnessSeries([w({ date: '2026-10-01', training_load: 70 })], '2026-10-01', '2026-10-10')
    const days = local.map((p) => p.date)
    const full = days.map((date, i) => ({ date, ctl: 40 + i, atl: 50 }))
    const icu = preferIcuForm(local, full)
    expect(icu.source).toBe('intervals')
    expect(icu.points[9]).toEqual({ date: '2026-10-10', ctl: 49, atl: 50, tsb: -1 })
    // Um dia em falta fica com o valor do dia antes.
    const gap = preferIcuForm(local, full.filter((r) => r.date !== '2026-10-05'))
    expect(gap.source).toBe('intervals')
    expect(gap.points[4]!.ctl).toBe(43)
    // Só os últimos dias (acabou de chegar) ou campos vazios: a da app, sem misturar.
    expect(preferIcuForm(local, full.slice(-3)).source).toBe('app')
    expect(preferIcuForm(local, days.map((date) => ({ date, ctl: null, atl: null }))).points).toEqual(local)
    expect(preferIcuForm([], full).source).toBe('app')
  })

  it('estatísticas por semana', () => {
    const mondays = lastMondays('2026-10-07', 2)
    expect(mondays).toEqual(['2026-09-28', '2026-10-05'])
    const stats = weeklyStats(
      [
        w({ date: '2026-09-29', watts: 120, avg_hr: 120, training_load: 40 }),
        w({ date: '2026-10-05', watts: 130, avg_hr: 125 }),
        w({ date: '2026-10-06', watts: 140, avg_hr: 130, minutes: 45 }),
        w({ date: '2026-10-06', type: 'strength', minutes: 50 }),
      ],
      mondays,
    )
    expect(stats[0]!.bike).toMatchObject({ sessions: 1, minutes: 60, load: 40, avgWatts: 120 })
    expect(stats[1]!.bike).toMatchObject({ sessions: 2, minutes: 105, avgWatts: 135, avgHr: 128 })
    expect(stats[1]!.gym).toEqual({ sessions: 1, minutes: 50 })
  })

  it('eficiência: watts por batimento nas sessões de 20 min ou mais', () => {
    const e = bikeEfficiency([
      w({ date: '2026-10-02', watts: 150, avg_hr: 125 }),
      w({ date: '2026-10-01', watts: 120, avg_hr: 120 }),
      w({ date: '2026-10-03', watts: 200, avg_hr: 150, minutes: 10 }),
      w({ date: '2026-10-04', type: 'strength', watts: null }),
    ])
    expect(e.metric).toBe('watts')
    expect(e.points.map((p) => [p.date, p.value])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 1.2],
    ])
    expect(e.left_out).toBe(1)
  })

  it('eficiência sem potência: metros por batimento, só rolo com rolo', () => {
    const ride = (date: string, km: number, hr: number, sport: string) =>
      w({ date, minutes: 60, moving_s: 3600, distance_km: km, avg_hr: hr, watts: null, sport })
    const e = bikeEfficiency([
      ride('2026-10-01', 25, 130, 'VirtualRide'),
      ride('2026-10-03', 27, 128, 'VirtualRide'),
      ride('2026-10-02', 32, 140, 'Ride'),
    ])
    expect(e.metric).toBe('distance')
    expect(e.points.map((p) => [p.date, p.value, p.speed_kmh])).toEqual([
      ['2026-10-01', 3.21, 25],
      ['2026-10-03', 3.52, 27],
    ])
    expect(e.left_out).toBe(1)
  })

  it('treino partido em dois: o aquecimento sem km não baixa a velocidade', () => {
    const part = (at: string, minutes: number, hr: number, km: number | null) =>
      w({ date: '2026-10-05', started_at: `2026-10-05T${at}Z`, minutes, moving_s: minutes * 60, elapsed_s: minutes * 60, avg_hr: hr, watts: null, distance_km: km, sport: 'VirtualRide' })
    const e = bikeEfficiency([
      part('14:53:00', 10, 118, null),
      part('15:03:30', 25, 143, 12.88),
      w({ date: '2026-10-01', minutes: 30, moving_s: 1800, avg_hr: 140, watts: null, distance_km: 15, sport: 'VirtualRide' }),
    ])
    expect(e.metric).toBe('distance')
    expect(e.points.at(-1)).toMatchObject({ date: '2026-10-05', minutes: 35, speed_kmh: 30.9, value: 3.6 })
  })

  it('só batimentos (sem watts nem distância): não se compara', () => {
    const e = bikeEfficiency([
      w({ date: '2026-10-05', started_at: '2026-10-05T14:53:15Z', minutes: 10, moving_s: 576, elapsed_s: 580, avg_hr: 118, watts: null }),
      w({ date: '2026-10-05', started_at: '2026-10-05T15:03:50Z', minutes: 25, moving_s: 1500, elapsed_s: 1500, avg_hr: 143, watts: null }),
      w({ date: '2026-10-01', minutes: 40, avg_hr: 120, watts: null }),
    ])
    expect(e).toEqual({ metric: null, points: [], left_out: 2 })
  })

  it('bem-estar: 7 dias contra 28, com passos (sem hoje, que vai a meio) e qualidade do sono', () => {
    const rows = [
      { date: '2026-10-07', hrv: 50, resting_hr: 52, steps: 190, sleep_quality: 2, sleep_score: 80 },
      { date: '2026-09-30', steps: 8000 },
      { date: '2026-09-08', steps: 3000 },
      { date: '2026-10-06', hrv: 46, resting_hr: 54, steps: 6000, sleep_quality: 3, sleep_score: 70 },
      { date: '2026-09-20', hrv: 40, resting_hr: 58, steps: 4000, sleep_quality: 4, sleep_score: 60 },
    ]
    const t = wellnessTrend(rows, '2026-10-07')
    expect(t).toMatchObject({ hrv7: 48, hrv28: 45, rhr7: 53, rhr28: 55, steps7: 7000, steps28: 6000, sleepQuality7: 2.5, sleepScore7: 75 })
  })

  it('FC em repouso só nos dias com noite registada', () => {
    const rows = [
      { date: '2026-10-01', resting_hr: 74, steps: 1184 },
      { date: '2026-10-02', resting_hr: 57, sleep_minutes: 410 },
      { date: '2026-10-03', resting_hr: 57, sleep_quality: 3 },
    ]
    expect(cleanWellness(rows).map((r) => r.resting_hr)).toEqual([null, 57, 57])
    expect(cleanWellness(rows)[0]!.steps).toBe(1184)
    expect(wellnessTrend(rows, '2026-10-03').rhr7).toBe(57)
  })

  it('plano da IA: forma certa e no máximo as sessões pedidas', () => {
    const plan = cleanPlan(
      {
        fase: 'Base 1',
        resumo: 'Começa leve.',
        bicicleta: [
          { titulo: 'Resistência Z2', tipo: 'resistencia', minutos: 45, alvo: 'FC 110–125', estrutura: '45 min contínuos', porque: 'base' },
          { titulo: 'Cadência', tipo: 'qualquer', minutos: 5000 },
          { titulo: 'A mais', tipo: 'tempo', minutos: 30 },
        ],
        ginasio: [{ titulo: 'Corpo inteiro A', foco: 'corpo_inteiro', minutos: 40, nota: '3×10' }, 'lixo'],
      },
      { bicicleta: 2, ginasio: 3 },
      4,
    )
    expect(plan.kind).toBe('semana')
    expect(plan.semana).toBe(4)
    expect(plan.bicicleta).toHaveLength(2)
    expect(plan.bicicleta[1]).toMatchObject({ tipo: 'resistencia', minutos: 240 })
    expect(plan.ginasio).toHaveLength(1)
    expect(cleanPlan(null, { bicicleta: 3, ginasio: 3 }, 4).fase).toBe('Descarga')
  })

  it('progresso: os treinos da semana riscam as sessões pela ordem', () => {
    const plan = cleanPlan(
      { bicicleta: [{}, {}, {}], ginasio: [{}, {}] },
      { bicicleta: 3, ginasio: 3 },
      1,
    )
    const done = planProgress(plan, [
      w({ id: 'b2', date: '2026-10-07' }),
      w({ id: 'g1', date: '2026-10-06', type: 'strength' }),
      w({ id: 'b1', date: '2026-10-05' }),
      w({ id: 'o1', date: '2026-10-05', type: 'other' }),
    ])
    expect(done.bike.map((x) => x?.id ?? null)).toEqual(['b1', 'b2', null])
    expect(done.gym.map((x) => x?.id ?? null)).toEqual(['g1', null])
  })
})
