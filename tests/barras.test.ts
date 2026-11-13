import { describe, expect, it } from 'vitest'
import { basketFromStore, basketToStore, gramsFromInput } from '../src/lib/barras'
import type { MealItem } from '../src/lib/types'

const item: MealItem = { name: 'Iogurte', grams: 125, kcal: 80, protein: 10, carbs: 6, fat: 0, food_id: 'f1', estimated: false }

describe('código de barras: os produtos lidos não se perdem (H17)', () => {
  it('guarda e lê o cesto', () => {
    const now = new Date('2026-11-13T12:00:00Z')
    expect(basketFromStore(basketToStore([item], now), now)).toEqual([item])
  })
  it('sem produtos não guarda nada', () => {
    expect(basketToStore([], new Date())).toBeNull()
  })
  it('um cesto com mais de 12 horas, estragado ou de outro formato vale vazio', () => {
    const then = new Date('2026-11-13T00:00:00Z')
    const later = new Date('2026-11-13T13:00:00Z')
    expect(basketFromStore(basketToStore([item], then), later)).toEqual([])
    expect(basketFromStore('{nada', later)).toEqual([])
    expect(basketFromStore(JSON.stringify({ at: later.getTime(), items: [{ x: 1 }] }), later)).toEqual([])
    expect(basketFromStore(null, later)).toEqual([])
  })
})

describe('código de barras: gramas de 1 em 1 (H17)', () => {
  it('aceita o que se escreve, arredondado ao grama', () => {
    expect(gramsFromInput('37')).toBe(37)
    expect(gramsFromInput('37,6')).toBe(38)
    expect(gramsFromInput('0,4')).toBe(1)
    expect(gramsFromInput('99999')).toBe(5000)
  })
  it('vazio, zero ou letras não contam', () => {
    expect(gramsFromInput('')).toBeNull()
    expect(gramsFromInput('0')).toBeNull()
    expect(gramsFromInput('abc')).toBeNull()
  })
})
