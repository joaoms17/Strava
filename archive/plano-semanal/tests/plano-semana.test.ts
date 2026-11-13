// Arquivado (L5): os testes que só cobriam o plano semanal com IA.
import { describe, expect, it } from 'vitest'
import { type PlanWorkout } from '../../../api/_lib/rules/plano'
import { cleanPlan, isDeloadWeek, planProgress, weekNumber, wellnessTrend } from '../plano-semana'

const w = (over: Partial<PlanWorkout> & { date: string }): PlanWorkout => ({
  type: 'bike',
  minutes: 60,
  training_load: null,
  watts: null,
  avg_hr: null,
  ...over,
})

describe('plano semanal (arquivado)', () => {
  it('número da semana desde o início e descarga a cada 4', () => {
    expect(weekNumber('2026-10-05', '2026-10-05')).toBe(1)
    expect(weekNumber('2026-10-05', '2026-10-08')).toBe(1)
    expect(weekNumber('2026-10-05', '2026-10-12')).toBe(2)
    expect(weekNumber('2026-10-05', '2026-11-02')).toBe(5)
    expect(weekNumber('2026-10-05', '2026-09-28')).toBe(1)
    expect([1, 2, 3, 4, 8].map(isDeloadWeek)).toEqual([false, false, false, true, true])
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
