import { describe, expect, it } from 'vitest'
import { sharedPath } from '../api/_meal/share'
import { MAX_SHARE_WITH, shareTargets, sharedFrom, sharedNote } from '../api/_lib/rules/partilha'

// Partilhar uma refeição: as fotos vão para a pasta de quem recebe.
describe('sharedPath', () => {
  it('copia para a pasta da outra pessoa, com o nome do ficheiro', () => {
    expect(sharedPath('aaa/meal-1/j123-0.jpg', 'bbb', 'novo')).toBe('bbb/partilhada-novo/j123-0.jpg')
  })
})

// A cópia diz de quem é: o Hoje e o Rever de quem recebe reconhecem-na pela nota.
describe('nota da refeição partilhada', () => {
  it('«Partilhada por João» e de volta o nome', () => {
    expect(sharedNote('João')).toBe('Partilhada por João')
    expect(sharedFrom(sharedNote('João'))).toBe('João')
    expect(sharedFrom(sharedNote('  '))).toBe('outra pessoa')
  })
  it('as outras notas não são partilhas', () => {
    expect(sharedFrom(null)).toBeNull()
    expect(sharedFrom('')).toBeNull()
    expect(sharedFrom('sem molho')).toBeNull()
    expect(sharedFrom('Partilhada por ')).toBeNull()
    expect(sharedFrom('partilhada por joão')).toBeNull()
  })
})

// «Também para …» ao registar: para quem segue no fim da análise.
describe('shareTargets', () => {
  it('cada pessoa uma vez, nunca a própria, no máximo 3', () => {
    expect(shareTargets(['joana', 'joana', 'joao', ''], 'joao')).toEqual(['joana'])
    expect(shareTargets(['a', 'b', 'c', 'd', 'e'], 'x')).toHaveLength(MAX_SHARE_WITH)
    expect(shareTargets(null, 'joao')).toEqual([])
    expect(shareTargets(undefined, 'joao')).toEqual([])
  })
})
