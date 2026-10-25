import { describe, expect, it } from 'vitest'
import {
  cleanPeriod,
  dateTicks,
  highest,
  labelWidth,
  lowest,
  niceScale,
  periodFrom,
  placeLabels,
  weekMeans,
} from '../api/_lib/rules/graficos'

describe('período', () => {
  it('lê o guardado e cai em 3M quando vem estragado', () => {
    expect(cleanPeriod('1M')).toBe('1M')
    expect(cleanPeriod('Tudo')).toBe('Tudo')
    expect(cleanPeriod('2M')).toBe('3M')
    expect(cleanPeriod(null)).toBe('3M')
  })

  it('1M e 3M contam para trás de hoje, sem começar antes do primeiro registo', () => {
    expect(periodFrom('1M', '2026-10-18', '2026-06-22')).toBe('2026-09-19')
    expect(periodFrom('3M', '2026-10-18', '2026-06-22')).toBe('2026-07-20')
    expect(periodFrom('3M', '2026-10-18', '2026-09-01')).toBe('2026-09-01')
  })

  it('«Tudo» começa no primeiro registo', () => {
    expect(periodFrom('Tudo', '2026-10-18', '2026-06-22')).toBe('2026-06-22')
    expect(periodFrom('Tudo', '2026-10-18', null)).toBe('2026-07-20')
  })
})

describe('eixo dos valores', () => {
  it('poucos números redondos à volta dos dados', () => {
    const s = niceScale(87.6, 92.4, 5)
    expect(s.ticks).toEqual([86, 88, 90, 92, 94])
    // Sem casas decimais: 2,5 só a partir de 25.
    expect(niceScale(87.6, 92.4, 4).ticks.every(Number.isInteger)).toBe(true)
  })

  it('milhares em passos de 1, 2, 2,5 ou 5', () => {
    const s = niceScale(0, 2830, 4)
    expect(s.ticks).toEqual([0, 1000, 2000, 3000])
  })

  it('um mínimo de amplitude quando os valores quase não mexem', () => {
    const s = niceScale(53, 53.4, 4, 4)
    expect(s.domain[1] - s.domain[0]).toBeGreaterThanOrEqual(4)
  })

  it('valores inválidos não rebentam', () => {
    expect(niceScale(NaN, 3).ticks).toEqual([0, 1])
  })
})

describe('eixo do tempo', () => {
  it('um mês: segundas-feiras de 1 ou 2 em 2 semanas', () => {
    const t = dateTicks('2026-09-19', '2026-10-18', 4)
    expect(t.kind).toBe('day')
    expect(t.ticks.length).toBeLessThanOrEqual(4)
    for (const d of t.ticks) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(1)
  })

  it('3 meses ou mais: o dia 1 dos meses', () => {
    const t = dateTicks('2026-07-20', '2026-12-20', 4)
    expect(t.kind).toBe('month')
    expect(t.ticks.every((d) => d.endsWith('-01'))).toBe(true)
    expect(t.ticks.length).toBeLessThanOrEqual(4)
    expect(t.ticks.length).toBeGreaterThanOrEqual(2)
  })

  it('um ano: de 3 em 3 ou 6 em 6 meses', () => {
    const t = dateTicks('2025-10-01', '2026-10-18', 4)
    expect(t.kind).toBe('month')
    expect(t.ticks.length).toBeLessThanOrEqual(4)
  })
})

describe('rótulos', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 150 }

  it('dois rótulos no mesmo sítio: o mais importante fica por cima, o outro muda de lado', () => {
    const out = placeLabels(
      [
        { id: 'a', x: 150, y: 80, w: 60, h: 14, priority: 1 },
        { id: 'b', x: 152, y: 80, w: 60, h: 14, priority: 5 },
      ],
      bounds,
    )
    const a = out.find((o) => o.id === 'a')!
    const b = out.find((o) => o.id === 'b')!
    expect(b.hidden).toBe(false)
    expect(b.y + b.h).toBeLessThanOrEqual(80)
    expect(a.hidden).toBe(false)
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    expect(overlap).toBe(false)
  })

  it('não sai do gráfico: encosta à margem', () => {
    const [o] = placeLabels([{ id: 'a', x: 295, y: 60, w: 60, h: 14, priority: 1 }], bounds)
    expect(o!.hidden).toBe(false)
    expect(o!.x + o!.w).toBeLessThanOrEqual(300)
  })

  it('sem lugar, esconde-se em vez de se sobrepor', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i), x: 20, y: 20, w: 40, h: 14, priority: i }))
    const out = placeLabels(many, { x: 0, y: 0, w: 60, h: 40 })
    const shown = out.filter((o) => !o.hidden)
    for (const a of shown)
      for (const b of shown) {
        if (a === b) continue
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
      }
    expect(shown.length).toBeLessThan(12)
  })

  it('evita os pontos marcados', () => {
    const [o] = placeLabels([{ id: 'a', x: 100, y: 60, w: 40, h: 14, priority: 1 }], bounds, [{ x: 70, y: 30, w: 60, h: 28 }])
    expect(o!.y).toBeGreaterThanOrEqual(58)
  })

  it('a largura cresce com o texto', () => {
    expect(labelWidth('mais baixo 88,1')).toBeGreaterThan(labelWidth('88,1'))
  })
})

describe('séries', () => {
  it('média por semana, de segunda a domingo', () => {
    const w = weekMeans([
      { date: '2026-10-12', value: 10 },
      { date: '2026-10-18', value: 20 },
      { date: '2026-10-19', value: 7 },
    ])
    expect(w).toEqual([
      { monday: '2026-10-12', value: 15, n: 2 },
      { monday: '2026-10-19', value: 7, n: 1 },
    ])
  })

  it('extremos: num empate fica o mais recente', () => {
    const pts = [
      { date: '2026-10-01', value: 5 },
      { date: '2026-10-02', value: 3 },
      { date: '2026-10-03', value: 3 },
      { date: '2026-10-04', value: 9 },
    ]
    expect(lowest(pts)!.date).toBe('2026-10-03')
    expect(highest(pts)!.date).toBe('2026-10-04')
    expect(lowest([])).toBeNull()
  })
})
