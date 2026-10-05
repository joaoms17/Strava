import { describe, expect, it } from 'vitest'
import {
  cleanPlan,
  cleanPrefs,
  efficiencySeries,
  fitnessSeries,
  isDeloadWeek,
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
    const series = fitnessSeries([w({ date: '2026-10-01', training_load: 70 })], '2026-10-01', '2026-10-03')
    expect(series).toHaveLength(3)
    expect(series[0]!.ctl).toBeCloseTo(1.7, 1)
    expect(series[0]!.atl).toBe(10)
    expect(series[0]!.tsb).toBeLessThan(0)
    expect(series[2]!.atl).toBeLessThan(series[0]!.atl)
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
    expect(
      efficiencySeries([
        w({ date: '2026-10-02', watts: 150, avg_hr: 125 }),
        w({ date: '2026-10-01', watts: 120, avg_hr: 120 }),
        w({ date: '2026-10-03', watts: 200, avg_hr: 150, minutes: 10 }),
        w({ date: '2026-10-04', type: 'strength', watts: null }),
      ]),
    ).toEqual([
      { date: '2026-10-01', value: 1 },
      { date: '2026-10-02', value: 1.2 },
    ])
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
