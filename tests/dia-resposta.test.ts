import { describe, expect, it } from 'vitest'
import {
  ANSWER_HINT,
  answerFlags,
  answerToast,
  clearMissingFlags,
  completeFromFlags,
  dayName,
  missingFlag,
} from '../api/_lib/rules/dia-resposta'
import { isDayComplete } from '../api/_lib/rules/day-close'

describe('«Foi tudo neste dia?» (decisão 302)', () => {
  it('diz o dia curto, sem partir a data', () => {
    expect(dayName('2026-10-03')).toBe('3 out')
    expect(dayName('2026-01-31')).toBe('31 jan')
  })

  it('o aviso diz a consequência', () => {
    expect(answerToast('2026-10-03', 'faltou_algo')).toBe('Dia 3 out marcado como incompleto — não conta no balanço')
    expect(answerToast('2026-10-03', 'dia_fechado')).toBe('Dia 3 out marcado como completo — conta no balanço')
    expect(ANSWER_HINT).toBe('Se faltou algo, o dia fica fora das contas.')
  })

  it('uma resposta tira a outra e não se repete', () => {
    expect(answerFlags(['chao', 'dia_fechado'], 'faltou_algo')).toEqual(['chao', 'faltou_algo'])
    expect(answerFlags(['faltou_algo', 'dia_incompleto'], 'dia_fechado')).toEqual(['dia_incompleto', 'dia_fechado'])
    expect(answerFlags(['faltou_algo'], 'faltou_algo')).toEqual(['faltou_algo'])
  })

  it('«Afinal foi tudo» tira «faltou algo» e o dia_incompleto, e o dia conta', () => {
    const before = ['chao', 'faltou_algo', 'dia_incompleto', 'manutencao']
    const after = clearMissingFlags(before)
    expect(after).toEqual(['chao', 'manutencao', 'dia_fechado'])
    expect(missingFlag(after)).toBe(false)
    expect(completeFromFlags(after)).toBe(true)
    // O mesmo que o fecho do dia vai decidir, mesmo com uma refeição só.
    expect(
      isDayComplete({ mealCount: 1, kcalIn: 500, manuallyClosed: after.includes('dia_fechado'), missingSomething: missingFlag(after) }),
    ).toBe(true)
  })

  it('as marcas decidem o completo só quando há resposta', () => {
    expect(completeFromFlags(['faltou_algo'])).toBe(false)
    expect(completeFromFlags(['dia_fechado'])).toBe(true)
    expect(completeFromFlags(['dia_incompleto'])).toBeNull()
    expect(completeFromFlags([])).toBeNull()
    expect(missingFlag(null)).toBe(false)
    expect(missingFlag(['faltou_algo'])).toBe(true)
  })
})
