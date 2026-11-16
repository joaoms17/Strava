import { describe, expect, it } from 'vitest'
import {
  etaFor,
  moveNote,
  project,
  projectionLine,
  rangeText,
  scenarioDelta,
  scenariosDelta,
  type ProjDay,
  type ProjInput,
} from '../api/_lib/rules/projecao'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

const AS_OF = '2026-10-24' // sábado

function isWeekend(d: string) {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

// 35 dias: a perder ~0,5 kg/semana (550 kcal/dia abaixo de 2600).
function input(opts: { weekday?: number; weekend?: number; tdee?: number; kgDay?: number; asOf?: string; days?: number } = {}): ProjInput {
  const asOf = opts.asOf ?? AS_OF
  const n = opts.days ?? 35
  const kgDay = opts.kgDay ?? -0.5 / 7
  const days: ProjDay[] = []
  const weights = []
  for (let i = n; i >= 1; i--) {
    const date = shiftDate(asOf, -i)
    days.push({
      date,
      kcal_in: isWeekend(date) ? (opts.weekend ?? 2050) : (opts.weekday ?? 2050),
      is_complete: true,
      flags: [],
      tdee_est: opts.tdee ?? 2600,
    })
    weights.push({ date, value: 85 + (kgDay * (Date.parse(date) - Date.parse('2026-09-01'))) / 86_400_000 })
  }
  return {
    asOf,
    days,
    weights,
    workouts: [
      { date: shiftDate(asOf, -3), kcal: 420 },
      { date: shiftDate(asOf, -10), kcal: 380 },
    ],
    waist: [
      { date: shiftDate(asOf, -60), value: 96 },
      { date: shiftDate(asOf, -30), value: 94.5 },
      { date: shiftDate(asOf, -2), value: 93 },
    ],
    targetKg: 78,
    targetWaistCm: 88,
  }
}

describe('projeção', () => {
  it('dados insuficientes com menos de 14 dias', () => {
    const p = project(input({ days: 10 }))
    expect(p.status).toBe('insuficiente')
    if (p.status === 'insuficiente') expect(p.missing).toMatch(/dias completos/)
  })

  it('sem alvo: só a base', () => {
    expect(project({ ...input(), targetKg: null }).status).toBe('sem_alvo')
  })

  it('data do peso alvo pelo ritmo das contas e do peso', () => {
    const p = project(input())
    expect(p.status).toBe('ok')
    if (p.status !== 'ok' || p.weight.kind !== 'date') throw new Error('sem data')
    // 85 − 52×0,0714 ≈ 81,3 kg → 3,3 kg a ~0,5 kg/semana ≈ 47 dias
    const days = (Date.parse(p.weight.date) - Date.parse(AS_OF)) / 86_400_000
    expect(days).toBeGreaterThan(38)
    expect(days).toBeLessThan(58)
    expect(p.weight.early <= p.weight.date).toBe(true)
    expect(p.weight.late! >= p.weight.date).toBe(true)
    expect(p.waist?.kind).toBe('date')
    expect(projectionLine(p, 78, 88, AS_OF)).toMatch(/^A este ritmo: 78 kg entre \d+ (nov|dez) e \d+ (dez|jan)/)
    expect(projectionLine(p, 78, 88, AS_OF)).toMatch(/cintura 88 cm em/)
    expect(rangeText(p.weight, AS_OF)).toMatch(/^entre /)
  })

  it('a subir: não chega', () => {
    const p = project(input({ weekday: 2800, weekend: 2800, kgDay: 0.02 }))
    expect(p.status === 'ok' && p.weight.kind).toBe('never')
  })

  it('já no alvo', () => {
    expect(etaFor(AS_OF, 77.9, 78, -0.05, 0.01).kind).toBe('reached')
  })

  it('a semana de água do ciclo não entra no declive', () => {
    const base = input()
    // 4 dias com +1,5 kg de água no fim
    const water = new Set([1, 2, 3, 4].map((i) => shiftDate(AS_OF, -i)))
    const weights = base.weights.map((w) => (water.has(w.date) ? { ...w, value: w.value + 1.5 } : w))
    const swung = project({ ...base, weights })
    const held = project({ ...base, weights, waterDay: (d) => water.has(d) })
    const clean = project(base)
    if (swung.status !== 'ok' || held.status !== 'ok' || clean.status !== 'ok') throw new Error()
    expect(Math.abs(held.basis.observedKgDay - clean.basis.observedKgDay)).toBeLessThan(
      Math.abs(swung.basis.observedKgDay - clean.basis.observedKgDay),
    )
  })
})

describe('E se…', () => {
  it('cenários em kcal por dia', () => {
    const p = project(input({ weekday: 1950, weekend: 2400 }))
    if (p.status !== 'ok') throw new Error()
    expect(scenarioDelta(p.basis, 'menos200')).toBe(-200)
    expect(scenarioDelta(p.basis, 'treino')).toBe(-Math.round(400 / 7))
    expect(scenarioDelta(p.basis, 'fds')).toBe(-Math.round((450 * 2) / 7))
    expect(scenariosDelta(p.basis, ['menos100', 'treino'])).toBe(-100 - 57)
  })

  it('sem diferença ao fim de semana, o cenário não se aplica', () => {
    const p = project(input())
    if (p.status !== 'ok') throw new Error()
    expect(scenarioDelta(p.basis, 'fds')).toBeNull()
  })

  it('menos kcal adianta a data', () => {
    const a = project(input())
    const b = project(input(), -300)
    if (a.status !== 'ok' || b.status !== 'ok' || a.weight.kind !== 'date' || b.weight.kind !== 'date') throw new Error()
    expect(b.weight.date < a.weight.date).toBe(true)
    if (a.waist?.kind === 'date' && b.waist?.kind === 'date') expect(b.waist.date <= a.waist.date).toBe(true)
  })
})

describe('nota da semana', () => {
  it('atrasou com mais kcal ao fim de semana', () => {
    const before = project(input({ asOf: shiftDate(AS_OF, -7) }))
    const now = project(input({ weekend: 3400 }))
    const note = moveNote(now, before)
    expect(note).not.toBeNull()
    expect(note!.days).toBeGreaterThanOrEqual(5)
    expect(note!.text).toMatch(/^atrasou \d+ dias: mais \d+ kcal\/dia ao fim de semana$/)
  })

  it('menos de 5 dias: sem nota', () => {
    const before = project(input({ asOf: shiftDate(AS_OF, -7) }))
    expect(moveNote(project(input()), before)).toBeNull()
  })

  it('adiantou com o gasto medido a subir', () => {
    const before = project(input({ asOf: shiftDate(AS_OF, -7) }))
    const now = project(input({ tdee: 3000 }))
    const note = moveNote(now, before)
    expect(note!.text).toMatch(/^adiantou \d+ dias: o gasto medido subiu 400 kcal\/dia$/)
  })
})

describe('projeção: K6, K8, K15 e frases (B10)', () => {
  it('K6: com pesagens de antes da janela, o declive é o real (0,7 kg/semana)', () => {
    const p = project(input({ kgDay: -0.7 / 7, days: 40 }))
    expect(p.status).toBe('ok')
    if (p.status === 'ok') expect(p.basis.observedKgDay * 7).toBeCloseTo(-0.7, 2)
  })

  it('K15: «Falta o gasto medido.» e plurais certos', () => {
    const noTdee = input()
    noTdee.days = noTdee.days.map((d) => ({ ...d, tdee_est: null }))
    const p = project(noTdee)
    expect(p.status === 'insuficiente' && p.missing).toBe('Falta o gasto medido.')
    const few = input()
    few.days = few.days.map((d, i) => ({ ...d, is_complete: i >= few.days.length - 13 }))
    const q = project(few)
    expect(q.status === 'insuficiente' && q.missing).toBe('Falta 1 dia completo.')
  })

  it('B10: a frase de quem não chega ao alvo', () => {
    const p = project(input({ kgDay: 0.1 / 7, tdee: 2000 }))
    expect(projectionLine(p, 78, null, AS_OF)).toBe('A este ritmo: não chega aos 78 kg')
  })
})

// Uma dieta que começa com a descida de água: 3 kg nas 2 primeiras semanas,
// depois 0,6 kg/semana; come 1500 com gasto 2200 (0,64 kg/semana pelas contas).
function dietStart(totalDays: number, asOf = AS_OF): ProjInput {
  const days: ProjDay[] = []
  const weights = []
  for (let i = totalDays; i >= 1; i--) {
    const date = shiftDate(asOf, -i)
    const d = totalDays - i // dias desde o início
    const kg = d < 14 ? 86 - (3 * d) / 14 : 83 - (0.6 / 7) * (d - 14)
    days.push({ date, kcal_in: 1500, is_complete: true, flags: [], tdee_est: 2200 })
    weights.push({ date, value: kg })
  }
  return { asOf, days, weights, workouts: [], waist: [], targetKg: 75, targetWaistCm: null, startDate: days[0]!.date }
}

describe('projeção: o início da dieta não promete datas (expectativas)', () => {
  it('nas primeiras 4 semanas não há data: ainda a medir o ritmo real', () => {
    const p = project(dietStart(21))
    expect(p.status).toBe('insuficiente')
    if (p.status === 'insuficiente') expect(p.missing).toMatch(/ritmo real/)
  })

  it('a descida de água das 2 primeiras semanas não entra no ritmo pelo peso', () => {
    const p = project(dietStart(35))
    expect(p.status).toBe('ok')
    if (p.status !== 'ok') return
    // Sem a água, ~0,6 kg/semana; com ela, a janela de 28 dias dava ~1 kg/semana.
    expect(p.basis.observedKgDay * 7).toBeGreaterThan(-0.7)
    expect(p.basis.observedKgDay * 7).toBeLessThan(-0.5)
  })

  it('o peso a descer muito mais depressa do que as contas explicam conta no máximo 1,3× as contas', () => {
    const fast = input({ kgDay: -1.5 / 7, tdee: 2600, weekday: 2050, weekend: 2050 })
    const p = project(fast)
    expect(p.status).toBe('ok')
    if (p.status !== 'ok') return
    const energy = p.basis.energyKgDay
    expect(p.basis.rateKgDay).toBeGreaterThanOrEqual((energy + 1.3 * energy) / 2 - 1e-9)
  })
})

describe('projeção: a data não anda todos os dias', () => {
  it('a data mostrada antes fica enquanto a nova estiver a menos de uma semana dela', () => {
    const fresh = project(input())
    if (fresh.status !== 'ok' || fresh.weight.kind !== 'date') throw new Error('sem data')
    const anchor = { date: shiftDate(fresh.weight.date, 5), early: shiftDate(fresh.weight.date, -10), late: shiftDate(fresh.weight.date, 20) }
    const kept = project({ ...input(), anchor })
    expect(kept.status === 'ok' && kept.weight).toEqual({ kind: 'date', ...anchor })
  })

  it('a mais de uma semana, a data muda', () => {
    const fresh = project(input())
    if (fresh.status !== 'ok' || fresh.weight.kind !== 'date') throw new Error('sem data')
    const anchor = { date: shiftDate(fresh.weight.date, 9), early: shiftDate(fresh.weight.date, 2), late: null }
    expect(project({ ...input(), anchor })).toEqual(fresh)
  })

  it('o «E se…» e uma âncora já passada não usam a âncora', () => {
    const fresh = project(input(), -200)
    if (fresh.status !== 'ok' || fresh.weight.kind !== 'date') throw new Error('sem data')
    const anchor = { date: shiftDate(fresh.weight.date, 3), early: fresh.weight.early, late: fresh.weight.late }
    expect(project({ ...input(), anchor }, -200)).toEqual(fresh)
    const past = { date: shiftDate(AS_OF, -1), early: shiftDate(AS_OF, -5), late: AS_OF }
    expect(project({ ...input(), anchor: past })).toEqual(project(input()))
  })
})

describe('projeção: a frase dá o intervalo, não um dia', () => {
  it('«entre … e …» em vez de «a 9 jan»', () => {
    const p = project(input())
    if (p.status !== 'ok' || p.weight.kind !== 'date') throw new Error('sem data')
    expect(projectionLine(p, 78, null, AS_OF)).toMatch(/^A este ritmo: 78 kg entre .+ e .+$/)
  })
})
