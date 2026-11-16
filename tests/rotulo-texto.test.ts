import { describe, expect, it } from 'vitest'
import { typedLabelFromText } from '../src/lib/rotulo'

const ok = { name: 'Wrap', kcal: '300', protein: '9', carbs: '', fat: '' }

describe('rótulo escrito: valores fora do possível têm mensagem', () => {
  it('valores bons dão o rótulo, sem problema', () => {
    expect(typedLabelFromText(ok)).toEqual({
      label: { name: 'Wrap', kcal_100g: 300, protein_100g: 9, carbs_100g: null, fat_100g: null },
      problem: null,
    })
  })
  it('kcal acima de 900 (kJ?) explica porquê', () => {
    expect(typedLabelFromText({ ...ok, kcal: '1500' })).toEqual({ label: null, problem: 'Máx. 900 kcal por 100 g — escreveste os kJ?' })
  })
  it('proteína, hidratos ou gordura acima de 100 g explica porquê', () => {
    expect(typedLabelFromText({ ...ok, protein: '120' }).problem).toBe('Por 100 g, os macros não passam de 100 g.')
    expect(typedLabelFromText({ ...ok, fat: '101' }).problem).toBe('Por 100 g, os macros não passam de 100 g.')
  })
  it('campos por preencher: sem rótulo e sem mensagem', () => {
    expect(typedLabelFromText({ ...ok, name: ' ' })).toEqual({ label: null, problem: null })
    expect(typedLabelFromText({ ...ok, kcal: '' })).toEqual({ label: null, problem: null })
  })
})
