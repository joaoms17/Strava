import { describe, expect, it } from 'vitest'
import { answeredForPrompt, cleanQuestions, historyForPrompt, pendingQuestions, statusWithQuestions, thisMealAnswers, withAnswers } from '../api/_lib/rules/perguntas'
import type { MealItem } from '../api/_lib/rules/meal-totals'

const it_ = (name: string, kcal: number, grams = 100): MealItem => ({ name, grams, kcal, protein: 10, carbs: 10, fat: 10, food_id: null, estimated: true })

describe('perguntas do modelo', () => {
  it('arruma: sem vazias, no máximo 3 perguntas e 4 sugestões', () => {
    const raw = [
      { pergunta: ' De onde é o hambúrguer? ', sugestoes: ['Caseiro', ' ', 'McDonald’s', 'Restaurante', 'Burger King', 'Outro'] },
      { pergunta: '  ', sugestoes: [] },
      { pergunta: 'Comeste tudo?', sugestoes: [] },
      { pergunta: 'Tinha molho?', sugestoes: [] },
      { pergunta: 'Era grande?', sugestoes: [] },
    ]
    const q = cleanQuestions(raw)
    expect(q.map((x) => x.pergunta)).toEqual(['De onde é o hambúrguer?', 'Comeste tudo?', 'Tinha molho?'])
    expect(q[0]!.sugestoes).toEqual(['Caseiro', 'McDonald’s', 'Restaurante', 'Burger King'])
    expect(q.every((x) => x.resposta === null)).toBe(true)
  })

  it('responder: as respostas vazias ficam por responder', () => {
    const q = cleanQuestions([{ pergunta: 'A?', sugestoes: [] }, { pergunta: 'B?', sugestoes: [] }])
    const answered = withAnswers(q, ['  Caseiro ', ''])
    expect(answered[0]!.resposta).toBe('Caseiro')
    expect(pendingQuestions(answered).map((x) => x.pergunta)).toEqual(['B?'])
    expect(thisMealAnswers(answered)).toEqual([{ pergunta: 'A?', resposta: 'Caseiro' }])
  })
})

describe('contexto para a análise', () => {
  const meal = (date: string, slot: string, title: string) => ({
    date,
    slot,
    logged_at: `${date}T20:00:00Z`,
    raw_text: title,
    items: [it_('Batata-doce', 140, 160)],
    questions: null,
  })
  it('histórico: só o mesmo momento, mais recentes primeiro, no máximo n', () => {
    const meals = [meal('2026-11-20', 'jantar', 'A'), meal('2026-11-22', 'jantar', 'B'), meal('2026-11-21', 'almoco', 'C')]
    expect(historyForPrompt(meals, 'jantar', 1)).toEqual([{ dia: '2026-11-22', titulo: 'B', alimentos: ['Batata-doce 160 g'] }])
  })
  it('respostas anteriores: só as respondidas', () => {
    const q = withAnswers(cleanQuestions([{ pergunta: 'De onde é?', sugestoes: [] }, { pergunta: 'Tudo?', sugestoes: [] }]), ['Smash burger'])
    expect(answeredForPrompt([{ ...meal('2026-11-22', 'jantar', 'B'), questions: q }], 20)).toEqual([
      { dia: '2026-11-22', pergunta: 'De onde é?', resposta: 'Smash burger' },
    ])
  })
})

describe('o estado depois das perguntas', () => {
  const ask = cleanQuestions([{ pergunta: 'A?', sugestoes: [] }])
  it('com perguntas por responder fica por rever', () => {
    expect(statusWithQuestions('ok', ask, false)).toBe('por_rever')
  })
  it('respondidas, a estimativa final fica confirmada', () => {
    expect(statusWithQuestions('por_rever', withAnswers(ask, ['Sim']), true)).toBe('ok')
  })
  it('sem perguntas, fica o que a análise disse', () => {
    expect(statusWithQuestions('por_rever', [], false)).toBe('por_rever')
    expect(statusWithQuestions('ok', undefined, false)).toBe('ok')
  })
})
