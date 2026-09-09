import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/lib/csv'

describe('toCsv', () => {
  it('gera cabeçalho e linhas', () => {
    const csv = toCsv([
      { date: '2026-09-10', kcal: 1500, note: null },
      { date: '2026-09-11', kcal: 1600, note: 'ok' },
    ])
    expect(csv).toBe('date,kcal,note\n2026-09-10,1500,\n2026-09-11,1600,ok')
  })

  it('escapa vírgulas e aspas e serializa objetos', () => {
    const csv = toCsv([{ name: 'arroz, cozido', items: { a: 1 }, quote: 'diz "olá"' }])
    expect(csv.split('\n')[1]).toBe('"arroz, cozido","{""a"":1}","diz ""olá"""')
  })

  it('vazio dá string vazia', () => {
    expect(toCsv([])).toBe('')
  })
})
