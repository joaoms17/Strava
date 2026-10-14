import { describe, expect, it } from 'vitest'
import { sharedPath } from '../api/_meal/share'

// Partilhar uma refeição: as fotos vão para a pasta de quem recebe.
describe('sharedPath', () => {
  it('copia para a pasta da outra pessoa, com o nome do ficheiro', () => {
    expect(sharedPath('aaa/meal-1/j123-0.jpg', 'bbb', 'novo')).toBe('bbb/partilhada-novo/j123-0.jpg')
  })
})
