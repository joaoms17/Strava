import { describe, expect, it } from 'vitest'
import {
  bestDeficitWeek,
  dayResult,
  dayVerdict,
  daysAgainstTarget,
  isAbove,
  isOnTarget,
  mondaysUpTo,
  monthCalendar,
  showMeanLine,
  weekAction,
  weekDaysReading,
  weekFacts,
  weeklyBalance,
  weeklyReading,
  type ActionInput,
} from '../api/_lib/rules/balanco-graficos'
import { daysEarlier, type ProjDay, type ProjInput } from '../api/_lib/rules/projecao'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

const TODAY = '2026-10-18' // domingo

describe('o dia contra o alvo', () => {
  const day = (eaten: number, extra: Partial<{ date: string; meals: number; complete: boolean; out: number | null }> = {}) => ({
    date: '2026-10-14',
    eaten,
    plan: 2000,
    meals: 4,
    complete: true,
    ...extra,
  })
  it('±100 kcal é no alvo; acima e abaixo à parte', () => {
    expect(dayResult(day(2100), TODAY)).toBe('no_alvo')
    expect(dayResult(day(1900), TODAY)).toBe('no_alvo')
    expect(dayResult(day(2101), TODAY)).toBe('acima_alvo')
    expect(dayResult(day(1850), TODAY)).toBe('abaixo')
  })
  it('incompleto fica de fora; hoje e os dias por vir à parte', () => {
    expect(dayResult(day(800, { complete: false }), TODAY)).toBe('fora')
    expect(dayResult(day(1200, { date: TODAY, complete: false }), TODAY)).toBe('hoje')
    expect(dayResult(day(0, { date: '2026-10-19', meals: 0 }), TODAY)).toBe('futuro')
    expect(dayResult(day(0, { meals: 0, complete: false }), TODAY)).toBe('vazio')
  })
  it('a frase do gráfico usa «no alvo» do mês (até 100 acima)', () => {
    const days = [day(1500), day(2050, { date: '2026-10-13' }), day(2400, { date: '2026-10-12' }), day(900, { date: '2026-10-15', complete: false })]
    expect(weekDaysReading(days, TODAY)).toBe('2 de 3 dias completos no alvo · 1 acima do alvo')
    expect(weekDaysReading([], TODAY)).toBe('Ainda sem dias completos nesta semana')
  })

  it('um dia, um veredicto: a frase conta os mesmos dias que as barras pintam de «no alvo»', () => {
    const days = [day(1500), day(2050, { date: '2026-10-13' }), day(2200, { date: '2026-10-12' }), day(1200, { date: '2026-10-16' })]
    const results = days.map((d) => dayResult(d, TODAY))
    expect(results).toEqual(['abaixo', 'no_alvo', 'acima_alvo', 'abaixo'])
    const on = results.filter(isOnTarget).length
    expect(weekDaysReading(days, TODAY)).toBe(`${on} de 4 dias completos no alvo · 1 acima do alvo`)
    expect(on).toBe(3)
  })

  it('o toque diz o veredicto com a diferença', () => {
    expect(dayVerdict('abaixo', 1550, 2000)).toBe('no alvo · 450 kcal abaixo')
    expect(dayVerdict('acima_alvo', 2320, 2000)).toBe('acima do alvo · +320 kcal')
    expect(dayVerdict('acima_alvo', 2320, 2000, 2600)).toBe('acima do alvo, ainda abaixo do gasto · +320 kcal')
    expect(dayVerdict('acima_gasto', 2850, 2000, 2600)).toBe('acima do gasto · +250 kcal do que gastaste')
    expect(dayVerdict('no_alvo', 2050, 2000)).toBe('no alvo')
  })

  it('dois «acima»: do alvo (ainda com défice) e do gasto (o grave)', () => {
    expect(dayResult(day(2400, { out: 2600 }), TODAY)).toBe('acima_alvo')
    expect(dayResult(day(2600, { out: 2600 }), TODAY)).toBe('acima_alvo') // igual ao gasto ainda não passa
    expect(dayResult(day(2601, { out: 2600 }), TODAY)).toBe('acima_gasto')
    // Sem gasto conhecido, fica o «acima do alvo».
    expect(dayResult(day(3000, { out: null }), TODAY)).toBe('acima_alvo')
    expect(dayResult(day(3000, { out: 0 }), TODAY)).toBe('acima_alvo')
    // Dentro do alvo nunca é grave (semana de manutenção: alvo = gasto).
    expect(dayResult(day(2080, { out: 1900 }), TODAY)).toBe('no_alvo')
    expect(isAbove('acima_gasto') && isAbove('acima_alvo') && !isAbove('no_alvo')).toBe(true)
  })

  it('a frase separa os dois «acima»', () => {
    const days = [
      day(1500, { out: 2500 }),
      day(2050, { date: '2026-10-13', out: 2500 }),
      day(2300, { date: '2026-10-12', out: 2500 }),
      day(2800, { date: '2026-10-16', out: 2500 }),
      day(1990, { date: '2026-10-17', out: 2500 }),
    ]
    expect(weekDaysReading(days, TODAY)).toBe('3 de 5 dias completos no alvo · 1 acima do alvo · 1 acima do gasto')
    expect(weekDaysReading([days[3]!], TODAY)).toBe('0 de 1 dia completo no alvo · 1 acima do gasto')
  })

  it('a linha da média só quando se afasta do alvo', () => {
    expect(showMeanLine(1420, [1400, 1400, 1450, 1400, 0])).toBe(false)
    expect(showMeanLine(2004, [2300, 2300, 2400])).toBe(true)
    expect(showMeanLine(null, [2000])).toBe(false)
  })

  it('a linha de factos da semana', () => {
    expect(weekFacts(5, 2012, 4)).toBe('5 dias completos · média 2\u202f010 kcal · 4 treinos')
    expect(weekFacts(1, 1400, 0)).toBe('1 dia completo · média 1\u202f400 kcal')
    expect(weekFacts(0, null, 0)).toBeNull()
  })
})

describe('calendário do mês', () => {
  const rows = [
    { date: '2026-10-01', kcal_in: 1900, kcal_target: 2000, is_complete: true, flags: [] },
    { date: '2026-10-02', kcal_in: 2090, kcal_target: 2000, is_complete: true, flags: [] },
    { date: '2026-10-03', kcal_in: 2600, kcal_target: 2000, is_complete: true, flags: [] },
    { date: '2026-10-04', kcal_in: 700, kcal_target: 2000, is_complete: false, flags: [] },
    { date: '2026-10-05', kcal_in: 1800, kcal_target: 2000, is_complete: true, flags: ['faltou_algo'] },
    { date: '2026-10-06', kcal_in: 1800, kcal_target: 2000, is_complete: true, flags: [] },
  ]
  const calRows = rows
  const cal = monthCalendar('2026-10', rows, '2026-10-08')

  it('classifica cada dia (no alvo = completo e até 100 acima do alvo)', () => {
    const r = (d: number) => cal.weeks.flat().find((c) => c?.day === d)!.result
    expect(r(1)).toBe('no_alvo')
    expect(r(2)).toBe('no_alvo')
    expect(r(3)).toBe('acima_alvo') // sem gasto conhecido
    expect(r(4)).toBe('fora')
    expect(r(5)).toBe('fora')
    expect(r(7)).toBe('sem_registo')
    expect(r(8)).toBe('hoje')
    expect(r(9)).toBe('futuro')
  })

  it('semanas de segunda a domingo (1 de outubro de 2026 é quinta)', () => {
    expect(cal.weeks[0]!.slice(0, 3)).toEqual([null, null, null])
    expect(cal.weeks[0]![3]!.day).toBe(1)
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('a frase e a melhor sequência', () => {
    expect(cal.onTarget).toBe(3)
    expect(cal.countedDays).toBe(4)
    expect(cal.streak).toBe(2)
    expect(cal.reading).toBe('3 de 4 dias completos no alvo · melhor sequência: 2 dias')
  })

  it('acima do gasto à parte, com sinal próprio e na frase', () => {
    const withOut = [
      ...calRows.map((d) => ({ ...d, kcal_out_est: 2500 })),
      { date: '2026-10-07', kcal_in: 2400, kcal_target: 2000, is_complete: true, flags: [], kcal_out_est: 2500 },
    ]
    const c = monthCalendar('2026-10', withOut, '2026-10-08')
    const cell = (d: number) => c.weeks.flat().find((x) => x?.day === d)!
    expect(cell(3).result).toBe('acima_gasto')
    expect(cell(3).kcalOut).toBe(2500)
    expect(cell(7).result).toBe('acima_alvo')
    expect(c.aboveSpent).toBe(1)
    expect(c.aboveTarget).toBe(1)
    expect(c.reading).toBe('3 de 5 dias completos no alvo · 1 acima do gasto · melhor sequência: 2 dias')
  })

  it('o resumo semanal conta os mesmos dias', () => {
    expect(
      daysAgainstTarget([
        { kcal_in: 1900, kcal_target: 2000, kcal_out_est: 2500, is_complete: true, flags: [] },
        { kcal_in: 2300, kcal_target: 2000, kcal_out_est: 2500, is_complete: true, flags: [] },
        { kcal_in: 2700, kcal_target: 2000, kcal_out_est: 2500, is_complete: true, flags: [] },
        { kcal_in: 2700, kcal_target: 2000, kcal_out_est: null, is_complete: true, flags: [] },
        { kcal_in: 3000, kcal_target: 2000, kcal_out_est: 2500, is_complete: true, flags: ['faltou_algo'] },
        { kcal_in: 800, kcal_target: 2000, kcal_out_est: 2500, is_complete: false, flags: [] },
      ]),
    ).toEqual({ completos: 4, no_alvo: 1, acima_do_alvo: 2, acima_do_gasto: 1 })
  })

  it('sem dias completos', () => {
    expect(monthCalendar('2026-11', [], '2026-11-02').reading).toBe('Ainda sem dias completos neste mês')
  })
})

describe('semana a semana', () => {
  const mondays = mondaysUpTo(TODAY, 4)
  const days = mondays.flatMap((m, w) =>
    Array.from({ length: 7 }, (_, i) => ({
      date: shiftDate(m, i),
      kcal_in: 2000,
      kcal_out_est: 2500 - w * 10,
      is_complete: i !== 2,
      flags: i === 3 ? ['faltou_algo'] : [],
    })),
  )
  const weights = mondays.flatMap((m, w) => [0, 2, 4].map((i) => ({ date: shiftDate(m, i), value: 90 - w * 0.5 })))

  it('défice médio dos dias completos e o peso médio de cada semana', () => {
    expect(mondays[3]).toBe('2026-10-12')
    const weeks = weeklyBalance(days, weights, mondays, TODAY)
    expect(weeks[0]).toMatchObject({ monday: mondays[0], deficit: 500, days: 5, kg: 90, water: false })
    // O comido e o gasto são as médias dos mesmos dias do défice.
    expect(weeks[0]!.out! - weeks[0]!.eaten!).toBe(500)
    // A semana de hoje só conta até ontem.
    expect(weeks[3]!.days).toBe(4)
  })

  it('a frase: o défice e o que o peso médio fez', () => {
    const weeks = weeklyBalance(days, weights, mondays, TODAY)
    expect(weeklyReading(weeks)).toBe('Em 4 semanas: défice médio de 490 kcal por dia e −1,5 kg no peso médio')
    expect(bestDeficitWeek(weeks)!.monday).toBe(mondays[0])
  })

  it('a semana de água não é ponta da conta do peso', () => {
    const water = (d: string) => d >= mondays[3]!
    const weeks = weeklyBalance(days, weights, mondays, TODAY, water)
    expect(weeks[3]!.water).toBe(true)
    expect(weeklyReading(weeks)).toMatch(/−1,0 kg no peso médio$/)
  })

  it('poucas semanas', () => {
    expect(weeklyReading(weeklyBalance([], [], mondays, TODAY))).toMatch(/volta daqui a 1 semana/)
  })
})

describe('Para esta semana', () => {
  const base: ActionInput = {
    leftOut: [],
    note: null,
    weekday: 1900,
    weekend: 1950,
    fdsDaysEarlier: 1,
    targetKg: 82,
    protein: [
      { slot: 'pequeno_almoco', avg: 33, days: 12 },
      { slot: 'almoco', avg: 50, days: 14 },
      { slot: 'jantar', avg: 45, days: 13 },
    ],
    perMeal: 35,
    weighings7: 6,
    projection: 'A este ritmo: 82 kg a 6 jan',
  }

  it('um dia acima do gasto vem antes de tudo', () => {
    const a = weekAction({
      ...base,
      leftOut: ['2026-10-14', '2026-10-16'],
      aboveSpent: [
        { date: '2026-10-13', over: 248 },
        { date: '2026-10-17', over: 181 },
      ],
    })
    expect(a.kind).toBe('acima_gasto')
    expect(a.date).toBe('2026-10-13')
    expect(a.detail).toMatch(/^ter 13 \(\+250 kcal\) e sáb 17 \(\+180 kcal\): nesses dias comeste mais do que gastaste/)
    const one = weekAction({ ...base, aboveSpent: [{ date: '2026-10-13', over: 248 }] })
    expect(one.detail).toMatch(/^ter 13 \(\+250 kcal\): nesse dia/)
    expect(weekAction({ ...base, aboveSpent: [] }).kind).toBe('manter')
  })

  it('dois ou mais dias de fora vêm primeiro', () => {
    const a = weekAction({ ...base, leftOut: ['2026-10-14', '2026-10-16'] })
    expect(a.kind).toBe('fechar_dias')
    expect(a.detail).toMatch(/^qua 14, sex 16:/)
    expect(a.date).toBe('2026-10-14')
  })

  it('a projeção atrasou por causa do fim de semana', () => {
    const a = weekAction({ ...base, note: { days: 9, text: 'atrasou 9 dias: mais 380 kcal/dia ao fim de semana', cause: 'fds' }, weekend: 2300, fdsDaysEarlier: 12 })
    expect(a.kind).toBe('fim_de_semana')
    expect(a.detail).toBe(
      'Desde a semana passada, a data atrasou 9 dias: mais 380 kcal/dia ao fim de semana. Comes mais 400 kcal por dia ao sábado e ao domingo do que durante a semana. Se comeres como durante a semana, chegas aos 82 kg 12 dias mais cedo.',
    )
  })

  it('a nota diz «fim de semana» mas o fim de semana não come mais: título neutro', () => {
    const a = weekAction({ ...base, note: { days: 9, text: 'atrasou 9 dias: mais 380 kcal/dia ao fim de semana', cause: 'fds' }, weekend: base.weekday! - 40, fdsDaysEarlier: 3 })
    expect(a.kind).toBe('fim_de_semana')
    expect(a.title).toBe('Ao fim de semana, come perto do alvo do dia')
    expect(a.detail).toBe('Desde a semana passada, a data atrasou 9 dias: mais 380 kcal/dia ao fim de semana.')
  })

  it('a projeção atrasou durante a semana', () => {
    const a = weekAction({ ...base, note: { days: 6, text: 'atrasou 6 dias: mais 200 kcal/dia durante a semana', cause: 'semana' } })
    expect(a.kind).toBe('semana')
  })

  it('fim de semana muito acima, mesmo sem nota', () => {
    const a = weekAction({ ...base, weekend: 2250, fdsDaysEarlier: 9 })
    expect(a.kind).toBe('fim_de_semana')
    expect(a.title).toBe('Ao fim de semana, come como durante a semana')
  })

  it('a proteína da refeição mais fraca', () => {
    const a = weekAction({ ...base, protein: [{ slot: 'pequeno_almoco', avg: 24, days: 12 }, ...base.protein.slice(1)] })
    expect(a.kind).toBe('proteina')
    expect(a.title).toBe('Junta 10 g de proteína ao pequeno-almoço')
    expect(a.detail).toMatch(/^Tens 24 g em média nos últimos 14 dias; o alvo é 35 g por refeição\./)
  })

  it('o lanche e a ceia não contam para a proteína', () => {
    const a = weekAction({ ...base, protein: [...base.protein, { slot: 'lanche', avg: 5, days: 10 }] })
    expect(a.kind).not.toBe('proteina')
  })

  it('poucas pesagens', () => {
    expect(weekAction({ ...base, weighings7: 1 }).kind).toBe('pesar')
  })

  it('tudo no sítio: continuar, com a linha da projeção', () => {
    const a = weekAction(base)
    expect(a.kind).toBe('manter')
    expect(a.detail).toBe('A este ritmo: 82 kg a 6 jan.')
  })
})

describe('dias mais cedo com o fim de semana como a semana', () => {
  function input(weekend: number): ProjInput {
    const asOf = '2026-10-24'
    const days: ProjDay[] = []
    const weights = []
    for (let i = 35; i >= 1; i--) {
      const date = shiftDate(asOf, -i)
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      days.push({ date, kcal_in: dow === 0 || dow === 6 ? weekend : 2000, is_complete: true, flags: [], tdee_est: 2600 })
      weights.push({ date, value: 88 - (35 - i) * 0.06 })
    }
    return { asOf, weights, days, workouts: [], waist: [], targetKg: 82, targetWaistCm: null }
  }
  it('com o fim de semana bem acima, chega mais cedo', () => {
    expect(daysEarlier(input(2600), 'fds')!).toBeGreaterThan(5)
  })
  it('sem diferença, não se aplica', () => {
    expect(daysEarlier(input(2000), 'fds')).toBeNull()
  })
})
