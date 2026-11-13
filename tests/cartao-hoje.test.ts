import { describe, expect, it } from 'vitest'
import { hojeActionCard, type HojeCardInput } from '../src/lib/cartao-hoje'

const base: HojeCardInput = {
  isToday: true,
  offline: false,
  askPastDay: false,
  missingMarked: false,
  step: null,
  qualFoi: 0,
  monthReady: false,
  hasAnyWeight: true,
  hasAnyMeal: true,
  dismissedHints: [],
  dayEmpty: false,
}
const card = (patch: Partial<HojeCardInput>) => hojeActionCard({ ...base, ...patch })

describe('Hoje: um só cartão de ação, de uma fila única (H9)', () => {
  it('sem nada por fazer, nenhum cartão', () => {
    expect(card({})).toBeNull()
  })

  it('sem rede não se pede nada', () => {
    expect(card({ offline: true, step: 'erro', qualFoi: 2, monthReady: true })).toBeNull()
  })

  it('a refeição com erro, o limite e o treino por confirmar passam à frente de tudo', () => {
    expect(card({ step: 'erro', qualFoi: 1, monthReady: true, hasAnyWeight: false })).toBe('erro')
    expect(card({ step: 'limite', qualFoi: 1 })).toBe('limite')
    expect(card({ step: 'treino', qualFoi: 1 })).toBe('treino')
  })

  it('«Qual foi?» vem antes do próximo passo e do mês', () => {
    expect(card({ qualFoi: 1, step: 'proteina', monthReady: true })).toBe('qual_foi')
  })

  it('o mês pronto é o último da fila', () => {
    expect(card({ monthReady: true, step: 'medir' })).toBe('medir')
    expect(card({ monthReady: true })).toBe('mes')
  })

  it('num dia passado só a pergunta do dia ou a nota do «faltou algo»', () => {
    expect(card({ isToday: false, askPastDay: true, step: 'erro', monthReady: true })).toBe('foi_tudo')
    expect(card({ isToday: false, missingMarked: true })).toBe('faltou_algo')
    expect(card({ isToday: false, step: 'pesar', qualFoi: 2 })).toBeNull()
  })
})

describe('Hoje: a pessoa nova não é chamada três vezes a pesar e a fotografar (H9)', () => {
  const nova: Partial<HojeCardInput> = { hasAnyWeight: false, hasAnyMeal: false, step: 'pesar', dayEmpty: true }

  it('com o dia vazio, o cartão vazio basta: nenhum cartão a pedir pesar ou fotografar', () => {
    expect(card(nova)).toBeNull()
  })

  it('depois da primeira foto, pede-se a primeira pesagem uma vez (em vez do próximo passo «pesar»)', () => {
    expect(card({ ...nova, hasAnyMeal: true, dayEmpty: false })).toBe('primeira_pesagem')
  })

  it('«Saltar» na primeira pesagem deixa o próximo passo normal de pesar', () => {
    expect(card({ ...nova, hasAnyMeal: true, dayEmpty: false, dismissedHints: ['primeira_pesagem'] })).toBe('pesar')
  })

  it('depois de pesar (sem refeições ainda), pede-se a primeira foto uma vez', () => {
    expect(card({ hasAnyMeal: false, dayEmpty: false })).toBe('primeira_foto')
    expect(card({ hasAnyMeal: false, dayEmpty: false, dismissedHints: ['primeira_foto'] })).toBeNull()
  })

  it('com o dia vazio, outros passos (ontem, medir) continuam a aparecer', () => {
    expect(card({ dayEmpty: true, step: 'ontem' })).toBe('ontem')
    expect(card({ dayEmpty: true, step: 'pesar' })).toBeNull()
  })
})
