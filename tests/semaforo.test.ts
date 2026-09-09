import { describe, expect, it } from 'vitest'
import { canProgress, painStatus } from '../api/_lib/rules/semaforo'

// Regra 9: verde <= 2, amarelo 3-5, vermelho >= 6.
describe('painStatus', () => {
  it('classifica pelos limiares', () => {
    expect(painStatus(0, null)).toBe('green')
    expect(painStatus(2, null)).toBe('green')
    expect(painStatus(3, null)).toBe('yellow')
    expect(painStatus(5, null)).toBe('yellow')
    expect(painStatus(6, null)).toBe('red')
    expect(painStatus(10, null)).toBe('red')
  })

  it('usa a pior das duas dores', () => {
    expect(painStatus(1, 4)).toBe('yellow')
    expect(painStatus(4, 1)).toBe('yellow')
    expect(painStatus(2, 7)).toBe('red')
    expect(painStatus(1, 2)).toBe('green')
  })

  it('sem check-ins não há estado', () => {
    expect(painStatus(null, null)).toBeNull()
  })

  it('a manhã seguinte pode agravar o estado', () => {
    expect(painStatus(1, null)).toBe('green')
    expect(painStatus(1, 5)).toBe('yellow')
  })
})

// Regra 9: progressão só com 2 verdes consecutivos.
describe('canProgress', () => {
  it('precisa dos dois últimos estados verdes', () => {
    expect(canProgress(['green', 'green'])).toBe(true)
    expect(canProgress(['yellow', 'green', 'green'])).toBe(true)
  })

  it('um amarelo ou vermelho no meio corta a progressão', () => {
    expect(canProgress(['green', 'yellow'])).toBe(false)
    expect(canProgress(['green', 'red'])).toBe(false)
    expect(canProgress(['yellow', 'green'])).toBe(false)
  })

  it('com menos de 2 sessões avaliadas não progride', () => {
    expect(canProgress([])).toBe(false)
    expect(canProgress(['green'])).toBe(false)
    expect(canProgress(['green', null])).toBe(false)
  })
})
