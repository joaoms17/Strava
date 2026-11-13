import { describe, expect, it } from 'vitest'
import { searchByName } from '../src/lib/repetir'

const favs = [{ name: 'Açaí com granola' }, { name: 'Frango grelhado com arroz' }, { name: 'Sopa de legumes' }]

describe('«Repetir» procura nas favoritas (H10)', () => {
  it('sem pesquisa, todas', () => {
    expect(searchByName(favs, '  ')).toHaveLength(3)
  })
  it('sem acentos nem maiúsculas, todas as palavras por qualquer ordem', () => {
    expect(searchByName(favs, 'acai').map((f) => f.name)).toEqual(['Açaí com granola'])
    expect(searchByName(favs, 'ARROZ frango').map((f) => f.name)).toEqual(['Frango grelhado com arroz'])
    expect(searchByName(favs, 'frango sopa')).toEqual([])
  })
})
