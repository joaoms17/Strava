// O 1S do Corpo (decisão 307): a semana pelo dia de Lisboa, a semana do peso
// médio, o «estável» e as frases da semana.
import { describe, expect, it } from 'vitest'
import { PERIODS, cleanPeriod, lisbonDay, periodFrom, weekWindow, weekdayTick } from '../api/_lib/rules/graficos'
import {
  WEEK_STABLE_KG,
  compareWindows,
  formReading,
  prevWeekText,
  restingHrReading,
  trainingWeekReading,
  weekMeasurementNote,
  weekReading,
  weekShort,
  weekTrendChange,
} from '../api/_lib/rules/leituras'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

const TODAY = '2026-10-18' // domingo

describe('período 1S', () => {
  it('vem primeiro e lê-se do armazenamento', () => {
    expect(PERIODS[0]).toBe('1S')
    expect(PERIODS).toEqual(['1S', '1M', '3M', 'Tudo'])
    expect(cleanPeriod('1S')).toBe('1S')
    expect(cleanPeriod('1s')).toBe('3M')
  })

  it('os últimos 7 dias, sem começar antes do primeiro registo', () => {
    expect(periodFrom('1S', TODAY, '2026-06-22')).toBe('2026-10-12')
    expect(periodFrom('1S', TODAY, '2026-10-15')).toBe('2026-10-15')
  })

  it('1M, 3M e Tudo não mudam', () => {
    expect(periodFrom('1M', TODAY, '2026-06-22')).toBe('2026-09-19')
    expect(periodFrom('3M', TODAY, '2026-06-22')).toBe('2026-07-20')
    expect(periodFrom('Tudo', TODAY, '2026-06-22')).toBe('2026-06-22')
  })
})

describe('a semana pelo dia de Lisboa', () => {
  it('o dia é o de Lisboa, não o UTC', () => {
    // Verão (UTC+1): 23:30 UTC já é o dia seguinte em Lisboa.
    expect(lisbonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
    // Inverno (UTC+0): igual ao UTC.
    expect(lisbonDay(new Date('2026-11-01T23:30:00Z'))).toBe('2026-11-01')
    // A noite da mudança de hora (25 out 2026, 02:00 → 01:00).
    expect(lisbonDay(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25')
  })

  it('os 7 dias até hoje e os 7 antes', () => {
    const w = weekWindow(TODAY)
    expect(w.from).toBe('2026-10-12')
    expect(w.to).toBe(TODAY)
    expect(w.prevFrom).toBe('2026-10-05')
    expect(w.prevTo).toBe('2026-10-11')
    expect(w.days).toHaveLength(7)
    expect(w.days[0]).toBe('2026-10-12')
    expect(w.days[6]).toBe(TODAY)
  })

  it('numa segunda-feira são 7 dias na mesma (não a semana do calendário)', () => {
    const w = weekWindow(lisbonDay(new Date('2026-11-02T08:00:00Z')))
    expect(w.days).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('a marca do eixo: o dia da semana e o dia do mês', () => {
    expect(weekdayTick('2026-10-12')).toEqual(['seg', '12'])
    expect(weekdayTick('2026-10-18')).toEqual(['dom', '18'])
    expect(weekdayTick('2026-11-01')).toEqual(['dom', '1'])
  })
})

// O peso médio de cada dia: `value(i)` com i = dias até hoje (0 = hoje).
function trend(days: number, value: (back: number) => number | null, end = TODAY) {
  const rows = []
  for (let back = days - 1; back >= 0; back--) {
    const v = value(back)
    if (v != null) rows.push({ date: shiftDate(end, -back), value: v })
  }
  return rows
}

describe('a semana do peso médio', () => {
  it('o de hoje contra o de há 7 dias, e a semana anterior', () => {
    // 81,7 há 14 dias, 81,16 há 7, 80,86 hoje.
    const t = trend(15, (b) => (b === 0 ? 80.86 : b === 7 ? 81.16 : b === 14 ? 81.76 : null))
    const w = weekTrendChange(t, TODAY)!
    expect(w.end).toEqual({ date: TODAY, value: 80.86 })
    expect(w.kg).toBe(-0.3)
    expect(w.prevKg).toBe(-0.6)
    expect(weekReading(w)).toBe('Esta semana: −0,3 kg no peso médio (80,9)')
    expect(prevWeekText(w)).toBe('Na semana anterior: −0,6 kg')
    expect(weekShort(w)).toBe('Esta semana: −0,3 kg')
  })

  it('±0,1 kg é estável', () => {
    expect(WEEK_STABLE_KG).toBe(0.1)
    const up = weekTrendChange(trend(8, (b) => (b === 0 ? 80.9 : b === 7 ? 80.8 : null)), TODAY)!
    expect(up.kg).toBe(0.1)
    expect(weekReading(up)).toBe('Esta semana: estável (80,9)')
    expect(weekShort(up)).toBe('Esta semana: estável')
    const down = weekTrendChange(trend(8, (b) => (b === 0 ? 80.66 : b === 7 ? 80.8 : null)), TODAY)!
    expect(down.kg).toBe(-0.1)
    expect(weekShort(down)).toBe('Esta semana: estável')
    // 0,2 já não é.
    const more = weekTrendChange(trend(8, (b) => (b === 0 ? 81 : b === 7 ? 80.8 : null)), TODAY)!
    expect(weekShort(more)).toBe('Esta semana: +0,2 kg')
  })

  it('sem pesagem hoje: o peso médio mais recente da semana', () => {
    const t = trend(12, (b) => (b === 2 ? 85 : b === 9 ? 85.5 : null))
    const w = weekTrendChange(t, TODAY)!
    expect(w.end.date).toBe(shiftDate(TODAY, -2))
    expect(w.kg).toBe(-0.5)
  })

  it('a semana anterior pode ser de até 3 dias antes; mais longe não conta', () => {
    const near = weekTrendChange(trend(11, (b) => (b === 0 ? 85 : b === 10 ? 85.4 : null)), TODAY)!
    expect(near.kg).toBe(-0.4)
    const far = weekTrendChange(trend(12, (b) => (b === 0 ? 85 : b === 11 ? 85.4 : null)), TODAY)!
    expect(far.kg).toBeNull()
    expect(weekReading(far)).toBe('Esta semana: peso médio 85,0 kg')
    expect(weekShort(far)).toBeNull()
    expect(prevWeekText(far)).toBeNull()
  })

  it('sem pesagens nos últimos 7 dias', () => {
    const w = weekTrendChange(trend(20, (b) => (b >= 7 ? 85 : null)), TODAY)
    expect(w).toBeNull()
    expect(weekReading(w)).toBe('Sem pesagens nos últimos 7 dias')
    expect(weekShort(w)).toBeNull()
  })

  it('a semana de água diz-se', () => {
    const t = trend(8, (b) => (b === 0 ? 62.4 : b === 7 ? 62 : null))
    const w = weekTrendChange(t, TODAY, (d) => d >= shiftDate(TODAY, -3))!
    expect(w.water).toBe(true)
    expect(weekReading(w)).toBe('Esta semana: +0,4 kg no peso médio (62,4) · semana de água')
  })

  it('a semana anterior estável', () => {
    const t = trend(15, (b) => (b === 0 ? 80 : b === 7 ? 80.5 : b === 14 ? 80.45 : null))
    expect(prevWeekText(weekTrendChange(t, TODAY))).toBe('Na semana anterior: estável')
  })
})

describe('as medidas na semana', () => {
  const from = '2026-10-12'
  it('nenhuma na semana: as 2 últimas, com a nota', () => {
    expect(weekMeasurementNote([{ date: '2026-09-29', value: 93 }, { date: '2026-10-06', value: 92.5 }], from)).toBe(
      'Sem medições nos últimos 7 dias: as 2 últimas, para veres a diferença.',
    )
  })
  it('uma na semana: com a anterior', () => {
    expect(weekMeasurementNote([{ date: '2026-09-29', value: 93 }, { date: '2026-10-13', value: 92.5 }], from)).toBe(
      '1 medição nos últimos 7 dias: com a anterior, para veres a diferença.',
    )
  })
  it('duas na semana: sem nota', () => {
    expect(weekMeasurementNote([{ date: '2026-10-12', value: 93 }, { date: '2026-10-18', value: 92.5 }], from)).toBeNull()
  })
})

describe('treino e recuperação na semana', () => {
  it('os minutos da semana contra os 7 dias antes', () => {
    expect(trainingWeekReading(185, 4, 140)).toBe('Esta semana: 185 min em 4 sessões, mais 45 do que na anterior')
    expect(trainingWeekReading(60, 1, 70)).toBe('Esta semana: 60 min em 1 sessão, como na anterior')
    expect(trainingWeekReading(90, 2, null)).toBe('Esta semana: 90 min em 2 sessões')
    expect(trainingWeekReading(0, 0, 120)).toBe('Sem treinos nos últimos 7 dias (120 min nos 7 antes)')
  })

  it('a FC: os 7 dias contra os 7 antes, com 4 dias de cada', () => {
    const rows = []
    for (let i = 0; i < 14; i++) if (i % 3 !== 1) rows.push({ date: shiftDate(TODAY, -i), value: i < 7 ? 52 : 55 })
    const c = compareWindows(rows, TODAY, '1S', shiftDate(TODAY, -6), { days: 7 })!
    expect(c.since).toBe('face à semana anterior')
    expect(restingHrReading(c)).toBe('Desceu 3 bpm face à semana anterior (agora 52)')
    // Só 3 dias na semana anterior: sem comparar.
    const few = rows.filter((r) => r.date >= shiftDate(TODAY, -6) || r.date >= shiftDate(TODAY, -9))
    expect(compareWindows(few, TODAY, '1S', shiftDate(TODAY, -6), { days: 7 })!.diff).toBeNull()
  })

  it('a forma numa semana', () => {
    const pts = Array.from({ length: 7 }, (_, i) => ({ date: shiftDate(TODAY, i - 6), ctl: 40 + i, atl: 50 }))
    expect(formReading(pts, '1S', TODAY)).toBe('Subiu de 40 para 46 numa semana')
  })
})
