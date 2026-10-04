import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXERCISES,
  EXERCISE_GROUPS,
  mergeCatalog,
  patternOfGroup,
  groupOfPattern,
  sameExercise,
  searchExercises,
} from '../api/_lib/rules/exercicios'

// O catálogo de exercícios que vem com a app, juntado aos de cada pessoa.
describe('catálogo de exercícios', () => {
  it('mais de 100 exercícios, sem repetidos, em todos os grupos', () => {
    expect(DEFAULT_EXERCISES.length).toBeGreaterThan(100)
    const names = DEFAULT_EXERCISES.map((e) => e.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    for (const g of EXERCISE_GROUPS) expect(DEFAULT_EXERCISES.some((e) => e.group === g)).toBe(true)
  })

  it('sem avisos de joelho: só nome e grupo', () => {
    for (const e of DEFAULT_EXERCISES) expect(Object.keys(e).sort()).toEqual(['group', 'name'])
    expect(DEFAULT_EXERCISES.some((e) => e.name === 'Agachamento búlgaro')).toBe(true)
  })

  it('os da pessoa mandam: nome igual fica com o dela; os novos entram no grupo do padrão', () => {
    const merged = mergeCatalog([
      { name: 'agachamento goblet', pattern: 'agachamento' },
      { name: 'Prensa unilateral', pattern: 'pernas' },
      { name: 'Bike zona 2', pattern: 'bike' },
    ])
    expect(merged.filter((e) => sameExercise(e.name, 'Agachamento goblet'))).toEqual([
      { name: 'agachamento goblet', group: 'Pernas e glúteos' },
    ])
    expect(merged.find((e) => e.name === 'Prensa unilateral')?.group).toBe('Pernas e glúteos')
    expect(merged.some((e) => e.name === 'Bike zona 2')).toBe(false)
  })

  it('pesquisa sem acentos, por grupo, por ordem alfabética', () => {
    const catalog = mergeCatalog([])
    const found = searchExercises(catalog, 'agachamento', null)
    expect(found.map((e) => e.name)).toEqual([...found.map((e) => e.name)].sort((a, b) => a.localeCompare(b, 'pt')))
    expect(searchExercises(catalog, 'triceps', 'Braços').length).toBeGreaterThan(3)
    expect(searchExercises(catalog, '', 'Costas').every((e) => e.group === 'Costas')).toBe(true)
  })

  it('criar num grupo guarda um padrão que volta ao mesmo grupo', () => {
    for (const g of EXERCISE_GROUPS) expect(groupOfPattern(patternOfGroup(g))).toBe(g)
  })
})
