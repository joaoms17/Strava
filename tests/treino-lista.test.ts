import { describe, expect, it } from 'vitest'
import { WORKOUT_LIST_COLUMNS, fromListRow } from '../src/lib/treino-lista'
import { askWhichWorkout } from '../api/_lib/rules/plano-treino'
import { possibleDuplicates } from '../api/_lib/rules/sessoes'

// P5: o Treino e o «Qual foi?» leem só as colunas que usam, sem os JSON em
// bruto, e as regras continuam a ver as chaves do `raw` de que precisam.

describe('P5 · colunas do Treino', () => {
  it('não pede o raw inteiro nem as voltas', () => {
    const cols = WORKOUT_LIST_COLUMNS.split(',')
    expect(cols).not.toContain('*')
    expect(cols).not.toContain('raw')
    expect(cols).not.toContain('laps')
    // Colunas que saem na limpeza (050) não se pedem.
    expect(cols).not.toContain('strava_id')
    expect(cols).not.toContain('planned_session_id')
  })

  it('refaz um raw pequeno com as chaves que as regras leem', () => {
    const w = fromListRow({
      id: 'a',
      raw_sport: 'walk',
      raw_calories: 210,
      raw_hora_estimada: true,
      raw_qual_foi: null,
      raw_outro_treino: true,
    })
    expect(w.raw).toEqual({ sport: 'walk', calories: 210, hora_estimada: true, outro_treino: true })
    expect('raw_sport' in w).toBe(false)
    expect(fromListRow({ id: 'b' }).raw).toBeNull()
  })

  it('o «Qual foi?» e os duplicados decidem igual com o raw reduzido', () => {
    const base = {
      date: '2026-11-12',
      source: 'intervals',
      type: 'strength',
      favorite_id: null,
      deleted_at: null,
      started_at: '2026-11-12T18:00:00Z',
      minutes: 50,
      sport: null,
      external_id: null,
    }
    const answered = fromListRow({ ...base, id: 'x', raw_qual_foi: true })
    const open = fromListRow({ ...base, id: 'y', raw_qual_foi: null })
    expect(askWhichWorkout([answered, open], '2026-11-13').map((w) => w.id)).toEqual(['y'])

    const a = fromListRow({ ...base, id: 'm', source: 'manual', raw_outro_treino: true })
    const b = fromListRow({ ...base, id: 'n' })
    expect(possibleDuplicates([a, b]).size).toBe(0)
    const c = fromListRow({ ...base, id: 'o', source: 'manual' })
    expect(possibleDuplicates([c, b]).size).toBe(2)
  })
})
