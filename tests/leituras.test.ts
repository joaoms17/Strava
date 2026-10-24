import { describe, expect, it } from 'vitest'
import {
  bestDayMark,
  bestFormMonth,
  bestWeek,
  compareWindows,
  formMarks,
  formReading,
  hrvReading,
  projectionHorizon,
  projectionPath,
  restingHrReading,
  sinceStart,
  sleepReading,
  stepsReading,
  trainingReading,
  vsAverage,
  waistMarks,
  waistReading,
  weightChange,
  weightMarks,
  weightReading,
} from '../api/_lib/rules/leituras'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

const TODAY = '2026-10-18'

// `days` dias até hoje, com o valor de cada dia por uma função do índice (0 = o mais antigo).
function series(days: number, value: (i: number) => number | null, end = TODAY) {
  const rows = []
  for (let i = 0; i < days; i++) {
    const v = value(i)
    if (v != null) rows.push({ date: shiftDate(end, i - days + 1), value: v })
  }
  return rows
}

describe('agora contra antes', () => {
  it('1M: os últimos 30 dias contra os 30 antes', () => {
    const rows = series(60, (i) => (i < 30 ? 9000 : 8200))
    const c = compareWindows(rows, TODAY, '1M', shiftDate(TODAY, -29))!
    expect(Math.round(c.now)).toBe(8200)
    expect(Math.round(c.diff!)).toBe(-800)
    expect(c.than).toBe('do que no mês anterior')
    expect(stepsReading(c)).toBe('Média de 8\u202f200 passos por dia, menos 800 do que no mês anterior')
  })

  it('3M: os últimos 30 dias contra os primeiros 30 do período, com o mês', () => {
    const rows = series(91, (i) => (i < 30 ? 56 : i >= 61 ? 53 : 55))
    const c = compareWindows(rows, TODAY, '3M', shiftDate(TODAY, -90))!
    expect(c.since).toBe('desde agosto')
    expect(restingHrReading(c)).toBe('Desceu 3 bpm desde agosto (agora 53)')
  })

  it('hoje fica de fora nos passos (ainda vai a meio)', () => {
    const rows = [...series(30, () => 10000, shiftDate(TODAY, -1)), { date: TODAY, value: 500 }]
    const c = compareWindows(rows, TODAY, '1M', shiftDate(TODAY, -29), { excludeToday: true })!
    expect(Math.round(c.now)).toBe(10000)
  })

  it('sem a janela de antes: só a média', () => {
    const rows = series(20, () => 7000)
    const c = compareWindows(rows, TODAY, '1M', shiftDate(TODAY, -29))!
    expect(c.diff).toBeNull()
    expect(stepsReading(c)).toBe('Média de 7\u202f000 passos por dia')
  })

  it('poucos dados: «volta daqui a 1 semana»', () => {
    expect(compareWindows(series(2, () => 1), TODAY, '1M', TODAY)).toBeNull()
    expect(stepsReading(null)).toMatch(/volta daqui a 1 semana/)
  })

  it('sono: mais minutos é dito como «mais»; pouca diferença é «como»', () => {
    const more = compareWindows(series(91, (i) => (i < 30 ? 400 : 425)), TODAY, '3M', shiftDate(TODAY, -90))!
    expect(sleepReading(more)).toBe('Dormes 7 h 05 por noite, mais 25 min do que em agosto')
    const same = compareWindows(series(91, (i) => (i < 30 ? 420 : 424)), TODAY, '3M', shiftDate(TODAY, -90))!
    expect(sleepReading(same)).toBe('Dormes 7 h 05 por noite, como em agosto')
  })

  it('HRV: subir é bom, descer diz-se sem drama', () => {
    const up = compareWindows(series(91, (i) => (i < 30 ? 50 : 55)), TODAY, '3M', shiftDate(TODAY, -90))!
    expect(hrvReading(up)).toBe('Subiu 5 ms desde agosto (agora 55)')
    const down = compareWindows(series(91, (i) => (i < 30 ? 55 : 51)), TODAY, '3M', shiftDate(TODAY, -90))!
    expect(hrvReading(down)).toBe('Desceu 4 ms desde agosto (agora 51)')
  })

  it('«Tudo» noutro ano leva o ano', () => {
    const rows = series(400, (i) => (i < 30 ? 60 : 54))
    const c = compareWindows(rows, TODAY, 'Tudo', rows[0]!.date)!
    expect(c.since).toMatch(/de 2025$/)
  })
})

describe('hoje contra a média', () => {
  it('acima, abaixo e como a média', () => {
    expect(vsAverage(51, 53.4, 'bpm', 1)).toBe('2 bpm abaixo da média')
    expect(vsAverage(445, 425, 'min', 10)).toBe('20 min acima da média')
    expect(vsAverage(52, 51.5, 'ms', 2)).toBe('como a média')
  })
})

describe('peso', () => {
  const trend = series(63, (i) => 92.4 - i * 0.066)

  it('−4,1 kg em 9 semanas', () => {
    const ch = weightChange(trend, trend[0]!.date)!
    expect(weightReading(ch)).toBe('−4,1 kg em 9 semanas')
  })

  it('a subir diz-se com o sinal, sem enfeitar', () => {
    const up = series(28, (i) => 80 + i * 0.03)
    expect(weightReading(weightChange(up, up[0]!.date))).toBe('+0,8 kg em 4 semanas')
  })

  it('estável', () => {
    const flat = series(28, (i) => 80 + (i % 2) * 0.05)
    expect(weightReading(weightChange(flat, flat[0]!.date))).toBe('Peso médio estável em 4 semanas')
  })

  it('a semana de água não é ponta da conta', () => {
    const t = series(35, (i) => (i >= 30 ? 70.5 : 70 - i * 0.03))
    const water = (d: string) => d > shiftDate(TODAY, -5)
    const ch = weightChange(t, t[0]!.date, water)!
    expect(ch.water).toBe(true)
    expect(ch.kg).toBeLessThan(0)
    expect(weightReading(ch)).toMatch(/sem a semana de água/)
  })

  it('poucas pesagens', () => {
    expect(weightReading(weightChange(series(3, () => 80), '2026-01-01'))).toMatch(/poucas pesagens/)
  })

  it('marcos: início, mais baixo (quando não é o último) e o último', () => {
    const t = [...series(30, (i) => 90 - i * 0.1, shiftDate(TODAY, -5)), ...series(5, () => 87.5)]
    const marks = weightMarks(t, { firstEver: true, lowestEver: false })
    expect(marks.map((m) => m.id)).toEqual(['inicio', 'baixo', 'ultimo'])
    expect(marks[0]!.label).toBe('início 90,0')
    expect(marks[1]!.label).toMatch(/^mais baixo 87,1$/)
  })

  it('o último quase igual ao mais baixo também conta como o mais baixo', () => {
    const t = [...series(30, (i) => 90 - i * 0.1, shiftDate(TODAY, -2)), { date: shiftDate(TODAY, -1), value: 87.0 }, { date: TODAY, value: 87.1 }]
    expect(weightMarks(t, { firstEver: false, lowestEver: false }).map((m) => m.id)).toEqual(['inicio', 'ultimo'])
  })

  it('o último é o mais baixo: um só rótulo', () => {
    const marks = weightMarks(trend, { firstEver: false, lowestEver: false })
    expect(marks.map((m) => m.id)).toEqual(['inicio', 'ultimo'])
    expect(marks[1]!.label).toMatch(/· mais baixo$/)
  })
})

describe('projeção no gráfico', () => {
  const start = { date: TODAY, value: 88 }
  const eta = { kind: 'date' as const, date: shiftDate(TODAY, 70), early: shiftDate(TODAY, 60), late: shiftDate(TODAY, 84) }

  it('chega ao alvo na data da projeção quando cabe', () => {
    const p = projectionPath(start, eta, 82, shiftDate(TODAY, 90))!
    expect(p.reachesInView).toBe(true)
    expect(p.end).toEqual({ date: shiftDate(TODAY, 70), value: 82 })
    expect(p.points[0]!.mid).toBe(88)
  })

  it('para no fim do gráfico quando a data fica para lá', () => {
    const p = projectionPath(start, eta, 82, shiftDate(TODAY, 35))!
    expect(p.reachesInView).toBe(false)
    expect(p.end.date).toBe(shiftDate(TODAY, 35))
    expect(p.end.value).toBeCloseTo(85, 1)
    // O leque: mais depressa fica mais baixo.
    const last = p.points[p.points.length - 1]!
    expect(last.low!).toBeLessThan(last.mid)
    expect(last.high!).toBeGreaterThan(last.mid)
  })

  it('sem data (a este ritmo não chega): sem linha', () => {
    expect(projectionPath(start, { kind: 'never' }, 82, shiftDate(TODAY, 30))).toBeNull()
  })

  it('o horizonte é 75 % do período, pelo menos 4 semanas', () => {
    expect(projectionHorizon(shiftDate(TODAY, -90), TODAY)).toBe(shiftDate(TODAY, 68))
    expect(projectionHorizon(shiftDate(TODAY, -29), TODAY)).toBe(shiftDate(TODAY, 28))
  })
})

describe('cintura', () => {
  const pts = [
    { date: '2026-08-18', value: 104.5 },
    { date: '2026-09-01', value: 103.2 },
    { date: '2026-10-13', value: 99.3 },
  ]
  it('−5,2 cm desde 18 ago · a mais baixa de sempre', () => {
    expect(waistReading(pts, 99.3, TODAY)).toBe('−5,2 cm desde 18 ago · a mais baixa de sempre')
  })
  it('uma medição só: o valor e a data', () => {
    expect(waistReading(pts.slice(-1), 99.3, TODAY)).toBe('99,3 cm a 13 out')
  })
  it('igual', () => {
    expect(waistReading([pts[2]!, { date: '2026-10-20', value: 99.5 }], 99.3, TODAY)).toBe('Igual desde 13 out (99,5 cm)')
  })
  it('marca a mais baixa quando não é a última', () => {
    const m = waistMarks([...pts, { date: '2026-10-17', value: 100 }])
    expect(m.map((x) => x.id)).toEqual(['baixa', 'ultima'])
  })
})

describe('treino', () => {
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    monday: shiftDate('2026-07-20', i * 7),
    bike: i < 4 ? 100 : 180,
    gym: i < 4 ? 40 : 90,
  }))
  const current = '2026-10-12'

  it('as últimas 4 semanas acabadas contra as primeiras do período', () => {
    expect(trainingReading(weeks, current, '3M', '2026-07-20', TODAY)).toBe('Média de 270 min por semana nas últimas 4 semanas, mais 130 do que em agosto')
  })

  it('1M compara com as 4 antes', () => {
    expect(trainingReading(weeks, current, '1M', '2026-09-19', TODAY)).toBe('Média de 270 min por semana nas últimas 4 semanas, como nas 4 antes')
  })

  it('a melhor semana (num empate, a mais recente)', () => {
    expect(bestWeek(weeks)!.monday).toBe(weeks[12]!.monday)
  })

  it('sem treinos: poucos dados', () => {
    expect(trainingReading([], current, '3M', '2026-07-20', TODAY)).toMatch(/volta daqui a 1 semana/)
  })

  it('forma: subiu de 34 para 45 desde agosto, com o mês que mais subiu', () => {
    const pts = series(80, (i) => 34 + i * 0.14).map((p) => ({ date: p.date, ctl: p.value, atl: p.value + 2 }))
    expect(formReading(pts, '3M', TODAY)).toBe(`Subiu de 34 para 45 desde ${pts[0]!.date.slice(5, 7) === '07' ? 'julho' : 'agosto'}`)
    const best = bestFormMonth(pts)
    expect(best).not.toBeNull()
    expect(best!.gain).toBeGreaterThanOrEqual(2)
    expect(formMarks(pts).map((m) => m.id)).toEqual(['hoje'])
  })

  it('forma a descer diz-se na mesma', () => {
    const pts = series(30, (i) => 45 - i * 0.2).map((p) => ({ date: p.date, ctl: p.value, atl: p.value }))
    expect(formReading(pts, '1M', TODAY)).toBe('Desceu de 45 para 39 num mês')
    expect(formMarks(pts).map((m) => m.id)).toEqual(['pico', 'hoje'])
  })
})

describe('recuperação', () => {
  it('HRV mais alta e FC mais baixa', () => {
    const pts = series(20, (i) => 50 + (i === 7 ? 12 : 0))
    expect(bestDayMark(pts, 'max', 'mais alta', 'ms')!.label).toBe('mais alta 62\u00a0ms')
    expect(bestDayMark(pts.slice(0, 3), 'max', 'x', '')).toBeNull()
  })
})

describe('desde o início', () => {
  const firstWeighings = [
    { date: '2026-06-22', value: 95.2 },
    { date: '2026-06-23', value: 94.8 },
    { date: '2026-06-25', value: 95.0 },
  ]
  const trend = series(10, () => 88.4)

  it('kg, cm e %G a descer, verdes com o alvo abaixo', () => {
    const s = sinceStart({
      firstWeighings,
      trend,
      waist: [
        { date: '2026-06-23', value: 106.1 },
        { date: '2026-10-13', value: 99.3 },
      ],
      fat: [
        { date: '2026-06-23', value: 25.4 },
        { date: '2026-10-13', value: 23.1 },
      ],
      targetKg: 82,
    })!
    expect(s.since).toBe('2026-06-22')
    expect(s.kg).toBe(-6.6)
    expect(s.kgGood).toBe(true)
    expect(s.cm).toBe(-6.8)
    expect(s.cmGood).toBe(true)
    expect(s.fat).toBe(-2.3)
    expect(s.fatGood).toBe(true)
  })

  it('a subir não fica verde', () => {
    const s = sinceStart({ firstWeighings, trend: series(5, () => 96), waist: [], fat: [], targetKg: 82 })!
    expect(s.kg).toBe(1)
    expect(s.kgGood).toBe(false)
    expect(s.cm).toBeNull()
  })

  it('sem pesagens: nada', () => {
    expect(sinceStart({ firstWeighings: [], trend: [], waist: [], fat: [], targetKg: null })).toBeNull()
  })

  it('a semana de água fica de fora do fim', () => {
    const t = [...series(10, () => 70, shiftDate(TODAY, -4)), ...series(4, () => 71)]
    const s = sinceStart({
      firstWeighings: [{ date: '2026-07-01', value: 72 }],
      trend: t,
      waist: [],
      fat: [],
      targetKg: 63,
      waterDay: (d) => d > shiftDate(TODAY, -4),
    })!
    expect(s.kg).toBe(-2)
  })
})
