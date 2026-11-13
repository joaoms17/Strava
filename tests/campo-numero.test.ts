import { describe, expect, it } from 'vitest'
import { cleanDecimalText, decimalFromText, decimalText, intFromText } from '../src/lib/campo-numero'

describe('campos de números (T6, T23)', () => {
  it('a carga aceita 12,5 escrito letra a letra', () => {
    let text = ''
    for (const ch of '12,5') text = cleanDecimalText(text + ch)
    expect(text).toBe('12,5')
    expect(decimalFromText('12,', 0, 300)).toBe(12)
    expect(decimalFromText(text, 0, 300)).toBe(12.5)
    expect(decimalFromText('17.5', 0, 300)).toBe(17.5)
  })
  it('só um separador e no máximo as casas pedidas', () => {
    expect(cleanDecimalText('12,5,')).toBe('12,5')
    expect(cleanDecimalText('1a2.255')).toBe('12.25')
    expect(cleanDecimalText('12,55', 1)).toBe('12,5')
  })
  it('vazio ou fora do intervalo não é número', () => {
    expect(decimalFromText('', 0, 300)).toBeNull()
    expect(decimalFromText(',', 0, 300)).toBeNull()
    expect(decimalFromText('400', 0, 300)).toBeNull()
  })
  it('apagar as séries deixa o campo vazio (8 → apagar → 6 dá 6, não 16)', () => {
    expect(intFromText('', 1, 10)).toBeNull()
    expect(intFromText('6', 1, 10)).toBe(6)
    expect(intFromText('0', 1, 10)).toBeNull()
    expect(intFromText('60', 0, 600)).toBe(60)
  })
  it('mostra com vírgula', () => {
    expect(decimalText(22.5)).toBe('22,5')
    expect(decimalText(null)).toBe('')
  })
})
