import { describe, expect, it } from 'vitest'
import {
  loadStep,
  loadStepDown,
  readyForIncreaseFree,
  setsSummary,
  suggestExercise,
} from '../api/_lib/rules/progressao-forca'

const set = (reps: number, rpe: number, load = 20) => ({ reps, rpe, load_kg: load })

// Regra 11: todas as séries no topo com RPE <= 8 em 2 sessões: +2 kg.
// Regra 11: deload na semana 4 = -40% de volume.
describe('ginásio livre (regra 11 revista)', () => {
  const top = (load: number, rpe: number | null = null) => [
    { reps: 12, load_kg: load, rpe },
    { reps: 12, load_kg: load, rpe },
    { reps: 12, load_kg: load, rpe },
  ]

  it('primeira vez: sem sugestão de carga', () => {
    expect(suggestExercise([])).toMatchObject({ firstTime: true, today: null })
  })

  it('2 sessões seguidas com todas as séries a 12: +2 kg', () => {
    expect(suggestExercise([top(40), top(40)])).toMatchObject({ ready: true, topLoad: 40, today: 42 })
  })

  it('T7: ao subir, as repetições começam no mínimo', () => {
    expect(suggestExercise([top(40), top(40)], 12, { repMin: 8 })).toMatchObject({ today: 42, repsToday: 8 })
    expect(suggestExercise([top(40), top(40)])).toMatchObject({ repsToday: 8 })
    expect(suggestExercise([top(40)])).toMatchObject({ ready: false, repsToday: null })
  })

  it('T7: só sobe com a mesma carga de topo nas duas sessões', () => {
    expect(suggestExercise([top(30), top(40)])).toMatchObject({ ready: false, today: 40 })
  })

  it('T7: peso do corpo (carga 0) e exercícios de tempo não sugerem carga', () => {
    expect(suggestExercise([top(0), top(0)])).toMatchObject({ ready: false, today: null })
    const plank = [1, 2].map(() => [{ reps: 12, load_kg: null, rpe: null }])
    expect(suggestExercise(plank, 12, { timed: true })).toMatchObject({ ready: false, today: null })
    expect(suggestExercise([top(10), top(10)], 12, { timed: true })).toMatchObject({ ready: false, today: 10 })
  })

  it('sem esforço registado conta como com folga; esforço 9 trava', () => {
    expect(readyForIncreaseFree([top(40), top(40)])).toBe(true)
    expect(readyForIncreaseFree([top(40), top(40, 9)])).toBe(false)
  })

  it('uma série abaixo do topo mantém a carga', () => {
    const last = [
      { reps: 12, load_kg: 40, rpe: null },
      { reps: 10, load_kg: 40, rpe: null },
    ]
    expect(suggestExercise([top(40), last])).toMatchObject({ ready: false, today: 40 })
  })

  it('o topo das repetições é o do teu treino: 5–8 sobe aos 8, 15–20 só aos 20', () => {
    const at = (reps: number, load: number) => [1, 2, 3].map(() => ({ reps, load_kg: load, rpe: null }))
    expect(suggestExercise([at(8, 100), at(8, 100)], 8)).toMatchObject({ ready: true, today: 102 })
    expect(suggestExercise([at(8, 100), at(8, 100)])).toMatchObject({ ready: false, today: 100 })
    expect(suggestExercise([at(12, 30), at(12, 30)], 20)).toMatchObject({ ready: false, today: 30 })
    expect(suggestExercise([at(20, 30), at(20, 30)], 20)).toMatchObject({ ready: true, today: 32 })
  })

  it('abaixo de 10 kg sobe-se 1 kg (2 kg em 4 kg eram +50 %)', () => {
    expect(suggestExercise([top(4), top(4)])).toMatchObject({ ready: true, today: 5 })
    expect(suggestExercise([top(10), top(10)])).toMatchObject({ today: 12 })
    expect([loadStep(null), loadStep(0), loadStep(9.5), loadStep(10), loadStep(40)]).toEqual([2, 1, 1, 2, 2])
    expect([loadStepDown(12), loadStepDown(10), loadStepDown(5)]).toEqual([2, 1, 1])
  })

  it('resumo das séries', () => {
    expect(setsSummary(top(40))).toBe('3 × 12 × 40 kg')
    expect(setsSummary([{ reps: 10, load_kg: 22.5, rpe: null }, { reps: 8, load_kg: 22.5, rpe: null }])).toBe('10, 8 × 22,5 kg')
  })
})
