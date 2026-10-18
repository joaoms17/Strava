import { describe, expect, it } from 'vitest'
import { labelFood, offFood, offSearchResults, searchKey, withoutExtras, type LabelRead } from '../api/_lib/rules/off'

// Produtos de marca: Open Food Facts (código de barras e pesquisa pelo nome)
// e o rótulo lido pela IA quando o produto não está lá.
describe('offFood', () => {
  it('guarda os macros, a fibra, o sal, o Nutri-Score e a dose', () => {
    const food = offFood(
      {
        product_name: 'Skyr natural',
        product_name_pt: 'Iogurte Skyr',
        brands: 'Pingo Doce, Jerónimo Martins',
        serving_quantity: '150',
        serving_size: '1 pote (150 g)',
        nutriscore_grade: 'A',
        nutriments: {
          'energy-kcal_100g': 63,
          proteins_100g: 11,
          carbohydrates_100g: 4,
          fat_100g: 0.2,
          fiber_100g: 0,
          sugars_100g: 4,
          'saturated-fat_100g': 0.1,
          salt_100g: 0.11,
        },
      },
      '5601234567890',
    )
    expect(food).toEqual({
      name: 'Iogurte Skyr — Pingo Doce',
      default_portion_g: 150,
      kcal_100g: 63,
      protein_100g: 11,
      carbs_100g: 4,
      fat_100g: 0.2,
      fiber_100g: 0,
      sugars_100g: 4,
      sat_fat_100g: 0.1,
      salt_100g: 0.11,
      nutriscore: 'a',
      serving_label: '1 pote (150 g)',
    })
  })

  it('só com kJ converte para kcal; sem sal usa o sódio × 2,5; sem energia não serve', () => {
    const food = offFood({ nutriments: { energy_100g: 418.4, sodium_100g: 0.4, proteins_100g: 'x' } }, '12345678')
    expect(food).toMatchObject({ name: 'EAN 12345678', kcal_100g: 100, salt_100g: 1, protein_100g: 0, nutriscore: null })
    expect(offFood({ product_name: 'Água', nutriments: {} }, '12345678')).toBeNull()
  })
})

describe('pesquisa pelo nome', () => {
  it('a chave da cache ignora acentos, maiúsculas e espaços a mais', () => {
    expect(searchKey('  Iogurte  PROTEICO Pingo Doce ')).toBe('iogurte proteico pingo doce')
    expect(searchKey('Pão de forma: Continente!')).toBe('pao de forma continente')
  })

  it('lê os hits (nomes por língua) e a lista antiga, sem códigos inválidos nem repetidos', () => {
    const hits = offSearchResults({
      hits: [
        { code: '5601234567890', product_name: { main: 'Yogurt', pt: 'Iogurte proteico' }, brands: ['Pingo Doce'], nutriments: { 'energy-kcal_100g': 60, proteins_100g: 10 } },
        { code: '5601234567890', product_name: 'Repetido' },
        { code: 'abc', product_name: 'Sem código' },
        { code: '5609876543210', product_name: '' },
        { code: '5601111111111', product_name_pt: 'Pão de forma', brands: 'Continente, Sonae' },
      ],
    })
    expect(hits).toEqual([
      { code: '5601234567890', name: 'Iogurte proteico — Pingo Doce', kcal_100g: 60, protein_100g: 10 },
      { code: '5601111111111', name: 'Pão de forma — Continente', kcal_100g: null, protein_100g: null },
    ])
    expect(offSearchResults({ products: [{ code: '12345678', product_name: 'Atum' }] })).toHaveLength(1)
    expect(offSearchResults(null)).toEqual([])
  })
})

describe('rótulo lido pela IA', () => {
  const read: LabelRead = {
    legivel: true,
    nome: 'Iogurte grego',
    marca: 'Continente',
    kcal_100g: 97,
    proteina_100g: 9,
    hidratos_100g: 4,
    gordura_100g: 5,
    fibra_100g: null,
    acucares_100g: 4,
    saturada_100g: 7,
    sal_100g: 0.1,
    dose_g: 125,
  }

  it('fica por 100 g, com o nome e a dose; a saturada nunca passa a gordura', () => {
    expect(labelFood(read, 'Produto 1')).toMatchObject({
      name: 'Iogurte grego — Continente',
      default_portion_g: 125,
      kcal_100g: 97,
      sugars_100g: 4,
      sat_fat_100g: null,
      salt_100g: 0.1,
    })
  })

  it('sem kcal calcula pelos macros; ilegível ou impossível não entra', () => {
    expect(labelFood({ ...read, kcal_100g: null }, 'x')?.kcal_100g).toBe(97)
    expect(labelFood({ ...read, legivel: false }, 'x')).toBeNull()
    expect(labelFood({ ...read, proteina_100g: 60, hidratos_100g: 50 }, 'x')).toBeNull()
    expect(labelFood({ ...read, kcal_100g: 10 }, 'x')).toBeNull()
    expect(labelFood({ ...read, nome: null, marca: null }, 'Produto 560')?.name).toBe('Produto 560')
  })

  it('sem a migração grava-se só o essencial', () => {
    expect(Object.keys(withoutExtras({ name: 'x', kcal_100g: 1, salt_100g: 1, nutriscore: 'a' }))).toEqual(['name', 'kcal_100g'])
  })
})
