import { describe, expect, it } from 'vitest'
import { computeCloseDay, type ClosedDayRow, type HistoryDay } from '../api/_lib/rules/fecho'
import { mifflinBase } from '../api/_lib/rules/gasto'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

// Simulação do fecho do dia, dia a dia (ideia 4 da auditoria): uma pessoa
// com um gasto real conhecido come sempre o mesmo, treina (ou não) e pesa-se
// com um padrão; o fecho corre todas as noites com o que ficou guardado nos
// dias anteriores, como a cron. Perfis: pesagens diárias, semanais, uma só,
// nenhuma e treino que pára.

const START = '2026-03-02' // segunda-feira
const HEIGHT = 180
const BIRTH = 1986
const REAL_EXTRA = 150 // o gasto real sem treino fica 150 acima da fórmula

interface Person {
  days: number
  eat: number
  startKg: number
  weighOn: (i: number, date: string) => boolean
  trainingOn: (i: number) => number // kcal de treino nesse dia
}

const realBase = (kg: number) => mifflinBase({ weightKg: kg, heightCm: HEIGHT, age: 2026 - BIRTH, sex: 'm' }) + REAL_EXTRA
// Ruído fixo de ±0,4 kg (água e sal), igual em todas as corridas.
const NOISE = [0.3, -0.2, 0.4, -0.4, 0.1, 0.2, -0.3, 0, -0.1, 0.35, -0.25]

function simulate(p: Person) {
  const history: (HistoryDay & { row: ClosedDayRow })[] = []
  const weights: { date: string; kg: number }[] = []
  let kg = p.startKg
  const real: number[] = []
  for (let i = 0; i < p.days; i++) {
    const date = shiftDate(START, i)
    const training = p.trainingOn(i)
    real.push(realBase(kg))
    if (p.weighOn(i, date)) weights.push({ date, kg: Math.round((kg + NOISE[i % NOISE.length]!) * 10) / 10 })
    const r = computeCloseDay({
      profile: { base_kcal: 1700, maintenance_enabled: false, height_cm: HEIGHT, birth_year: BIRTH, sex: 'm', expected_tdee: 2200 },
      date,
      anchor: START,
      meals: [
        { kcal: p.eat / 2, protein: 60, carbs: 100, fat: 30 },
        { kcal: p.eat / 2, protein: 60, carbs: 100, fat: 30 },
      ],
      workouts: training > 0 ? [{ type: 'bike', minutes: 45, watts: null, raw: null, kcal_est: training }] : [],
      weights: weights.filter((w) => w.date >= shiftDate(date, -56)),
      existing: null,
      history: history.filter((h) => h.date >= shiftDate(date, -120)),
      pendingMeals: 0,
    })
    history.push({ ...r.row, row: r.row })
    // O peso real do dia seguinte: o que sobrou ou faltou, a 7 700 kcal por kg.
    kg += (p.eat - (realBase(kg) + training)) / 7700
  }
  return { rows: history.map((h) => h.row), real }
}

const lastWeek = <T,>(rows: T[]) => rows.slice(-7)

describe('simulação do fecho, dia a dia', () => {
  it('pesagens diárias: o gasto medido aparece e fica perto do real', () => {
    const { rows, real } = simulate({ days: 84, eat: 1900, startKg: 92, weighOn: () => true, trainingOn: () => 0 })
    // As 2 primeiras semanas são de água: sem gasto medido.
    expect(rows.slice(0, 14).every((r) => r.tdee_est == null)).toBe(true)
    // Ao fim de 12 semanas, a base usa o medido e fica a menos de 150 do real.
    const last = rows[rows.length - 1]!
    expect(last.tdee_est).not.toBeNull()
    expect(Math.abs(last.daily_base_est - real[real.length - 1]!)).toBeLessThan(150)
    // O gasto do dia nunca fica colado ao que se come (K1).
    expect(lastWeek(rows).every((r) => r.kcal_out_est - 1900 > 300)).toBe(true)
  })

  it('pesagens semanais: chegam (4 em 3 semanas) e o gasto fica perto do real', () => {
    const { rows, real } = simulate({
      days: 84,
      eat: 1900,
      startKg: 92,
      weighOn: (i) => i % 7 === 0,
      trainingOn: () => 0,
    })
    const last = rows[rows.length - 1]!
    expect(last.tdee_est).not.toBeNull()
    expect(Math.abs(last.daily_base_est - real[real.length - 1]!)).toBeLessThan(250)
  })

  it('uma pesagem só: nunca «medido», a base fica a fórmula (K1)', () => {
    // O caso da auditoria: gasto real ~2 130, come 1 600, pesa-se uma vez.
    const { rows } = simulate({ days: 60, eat: 1600, startKg: 80, weighOn: (i) => i === 20, trainingOn: () => 0 })
    expect(rows.every((r) => r.tdee_est == null && r.tdee_raw == null)).toBe(true)
    expect(rows.every((r) => r.daily_base_est === r.formula_base)).toBe(true)
    // O gasto do dia não desce até ao que se come.
    expect(rows.every((r) => r.kcal_out_est > 1900)).toBe(true)
  })

  it('duas pesagens no mesmo fim de semana: ainda sem gasto medido', () => {
    const { rows } = simulate({ days: 60, eat: 1600, startKg: 80, weighOn: (i) => i === 19 || i === 20, trainingOn: () => 0 })
    expect(rows.every((r) => r.tdee_est == null)).toBe(true)
  })

  it('nenhuma pesagem: a fórmula de reserva do perfil, sem gasto medido', () => {
    const { rows } = simulate({ days: 40, eat: 1800, startKg: 85, weighOn: () => false, trainingOn: () => 0 })
    expect(rows.every((r) => r.tdee_est == null && r.weight_trend == null)).toBe(true)
    expect(rows.every((r) => r.formula_base === 2200 && r.daily_base_est === 2200)).toBe(true)
  })

  it('treino que pára: a base sem treino não fica muito acima da real (K3)', () => {
    // 10 semanas com 5 treinos de 500 kcal, depois 5 semanas sem treino.
    const STOP = 70
    const { rows, real } = simulate({
      days: 105,
      eat: 2100,
      startKg: 92,
      weighOn: () => true,
      trainingOn: (i) => (i < STOP && i % 7 < 5 ? 500 : 0),
    })
    const after = rows.map((r, i) => ({ r, real: real[i]! })).filter((_, i) => i >= STOP)
    const worst = Math.max(...after.map(({ r, real }) => r.daily_base_est - real))
    // Antes (treino médio de 14 dias contra um gasto de 4 semanas) chegava a +147 durante ~5 semanas.
    expect(worst).toBeLessThan(120)
    // E no fim já acompanha o real.
    const end = after[after.length - 1]!
    expect(Math.abs(end.r.daily_base_est - end.real)).toBeLessThan(150)
  })

  it('o dia guarda o gasto medido e as marcas no mesmo fecho', () => {
    const { rows } = simulate({ days: 30, eat: 1900, startKg: 92, weighOn: () => true, trainingOn: () => 0 })
    expect(rows.slice(0, 14).every((r) => r.flags.includes('gasto_agua'))).toBe(true)
    expect(rows.every((r) => r.is_complete && !r.flags.includes('dia_incompleto') && !r.flags.includes('chao'))).toBe(true)
  })
})
