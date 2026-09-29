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

// O catálogo de exercícios que vem com a app, juntado aos do João.
describe('catálogo de exercícios', () => {
  it('mais de 100 exercícios, sem repetidos, em todos os grupos', () => {
    expect(DEFAULT_EXERCISES.length).toBeGreaterThan(100)
    const names = DEFAULT_EXERCISES.map((e) => e.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    for (const g of EXERCISE_GROUPS) expect(DEFAULT_EXERCISES.some((e) => e.group === g)).toBe(true)
  })

  it('os que forçam o joelho estão marcados', () => {
    const knee = (name: string) => DEFAULT_EXERCISES.find((e) => e.name === name)?.knee_safe
    expect(knee('Agachamento búlgaro')).toBe(false)
    expect(knee('Extensão de pernas (máquina)')).toBe(false)
    expect(knee('Leg press (amplitude curta)')).toBe(true)
    expect(knee('Hip thrust')).toBe(true)
  })

  it('os do João mandam: nome igual fica com o aviso dele; os novos entram no grupo do padrão', () => {
    const merged = mergeCatalog([
      { name: 'agachamento goblet', pattern: 'agachamento', knee_safe: true },
      { name: 'Prensa unilateral', pattern: 'pernas', knee_safe: true },
      { name: 'Bike zona 2', pattern: 'bike', knee_safe: true },
    ])
    expect(merged.filter((e) => sameExercise(e.name, 'Agachamento goblet'))).toEqual([
      { name: 'agachamento goblet', group: 'Pernas e glúteos', knee_safe: true },
    ])
    expect(merged.find((e) => e.name === 'Prensa unilateral')?.group).toBe('Pernas e glúteos')
    expect(merged.some((e) => e.name === 'Bike zona 2')).toBe(false)
  })

  it('pesquisa sem acentos, por grupo, seguros primeiro', () => {
    const catalog = mergeCatalog([])
    const found = searchExercises(catalog, 'agachamento', null)
    expect(found[0]!.knee_safe).toBe(true)
    expect(found.at(-1)!.knee_safe).toBe(false)
    expect(searchExercises(catalog, 'triceps', 'Braços').length).toBeGreaterThan(3)
    expect(searchExercises(catalog, '', 'Costas').every((e) => e.group === 'Costas')).toBe(true)
  })

  it('criar num grupo guarda um padrão que volta ao mesmo grupo', () => {
    for (const g of EXERCISE_GROUPS) expect(groupOfPattern(patternOfGroup(g))).toBe(g)
  })
})
