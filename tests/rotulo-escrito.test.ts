import { describe, expect, it } from 'vitest'
import { typedFood } from '../api/_lib/rules/off'

describe('rótulo escrito à mão', () => {
  it('valores bons dão um alimento, com 0 nos macros vazios', () => {
    expect(typedFood({ name: '  Bolo  ', kcal_100g: 350, protein_100g: 8, carbs_100g: null, portion_g: 40 })).toMatchObject({
      name: 'Bolo',
      kcal_100g: 350,
      protein_100g: 8,
      carbs_100g: 0,
      fat_100g: 0,
      default_portion_g: 40,
      fiber_100g: null,
      nutriscore: null,
    })
  })
  it('kcal impossíveis, proteína acima de 100 g ou nome em branco: nada', () => {
    expect(typedFood({ name: 'X', kcal_100g: 2000, protein_100g: 8 })).toBeNull()
    expect(typedFood({ name: 'X', kcal_100g: 400, protein_100g: 120 })).toBeNull()
    expect(typedFood({ name: '   ', kcal_100g: 400, protein_100g: 8 })).toBeNull()
  })
})
