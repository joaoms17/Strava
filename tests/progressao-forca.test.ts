import { describe, expect, it } from 'vitest'
import { deloadSets, nextLoad, readyForIncrease } from '../api/_lib/rules/progressao-forca'

const set = (reps: number, rpe: number, load = 20) => ({ reps, rpe, load_kg: load })

// Regra 11: todas as séries no topo com RPE <= 8 em 2 sessões: +2 kg.
describe('readyForIncrease', () => {
  it('sobe quando as 2 últimas sessões estão no topo com RPE <= 8', () => {
    const sessions = [
      [set(12, 8), set(12, 8), set(12, 7)],
      [set(12, 7), set(12, 8), set(12, 8)],
    ]
    expect(readyForIncrease(sessions, 12)).toBe(true)
  })

  it('uma série abaixo do topo trava a subida', () => {
    const sessions = [
      [set(12, 8), set(11, 8), set(12, 8)],
      [set(12, 8), set(12, 8), set(12, 8)],
    ]
    expect(readyForIncrease(sessions, 12)).toBe(false)
  })

  it('RPE acima de 8 trava a subida', () => {
    const sessions = [
      [set(12, 8), set(12, 9)],
      [set(12, 8), set(12, 8)],
    ]
    expect(readyForIncrease(sessions, 12)).toBe(false)
  })

  it('só conta as duas últimas sessões', () => {
    const sessions = [
      [set(10, 9)], // antiga, má — não interessa
      [set(12, 8), set(12, 8)],
      [set(12, 7), set(12, 8)],
    ]
    expect(readyForIncrease(sessions, 12)).toBe(true)
  })

  it('com 1 sessão ou sem RPE registado não sobe', () => {
    expect(readyForIncrease([[set(12, 8)]], 12)).toBe(false)
    expect(readyForIncrease([[{ reps: 12, rpe: null, load_kg: 20 }], [set(12, 8)]], 12)).toBe(false)
  })
})

describe('nextLoad', () => {
  it('sobe 2 kg quando pronto, senão mantém', () => {
    expect(nextLoad(20, true)).toBe(22)
    expect(nextLoad(20, false)).toBe(20)
  })
})

// Regra 11: deload na semana 4 = -40% de volume.
describe('deloadSets', () => {
  it('corta 40% das séries', () => {
    expect(deloadSets(5)).toBe(3)
    expect(deloadSets(3)).toBe(2)
  })

  it('nunca fica abaixo de 1 série', () => {
    expect(deloadSets(1)).toBe(1)
  })
})
