// Perguntas da IA nas fotos de refeições: é o próprio modelo que as faz,
// sobre aquela foto, só quando não consegue estimar bem logo (e a resposta
// muda as contas a sério). As respostas voltam ao modelo com a foto, que faz
// a estimativa final; depois ficam como contexto das análises seguintes
// («respostas_anteriores»): é assim que a app aprende.
import type { MealItem } from './meal-totals.js'

export interface MealQuestion {
  pergunta: string // escrita pelo modelo, sobre aquela foto
  sugestoes: string[] // respostas curtas que o modelo propõe (tocar ou escrever outra)
  resposta: string | null
}

export const MAX_QUESTIONS = 3
export const MAX_SUGGESTIONS = 4

// O que o modelo perguntou, arrumado: sem perguntas vazias, no máximo 3, e
// no máximo 4 sugestões por pergunta.
export function cleanQuestions(raw: { pergunta: string; sugestoes: string[] }[]): MealQuestion[] {
  return raw
    .map((q) => ({
      pergunta: q.pergunta.trim(),
      sugestoes: q.sugestoes.map((x) => x.trim()).filter(Boolean).slice(0, MAX_SUGGESTIONS),
      resposta: null,
    }))
    .filter((q) => q.pergunta.length > 0)
    .slice(0, MAX_QUESTIONS)
}

export function pendingQuestions(questions: MealQuestion[] | null | undefined): MealQuestion[] {
  return (questions ?? []).filter((q) => q.resposta == null)
}

// O estado da refeição com as perguntas: por responder, fica por rever;
// respondidas, a estimativa que o modelo fez com as respostas fica
// confirmada (a pessoa já disse o que faltava); sem perguntas, o da análise.
export function statusWithQuestions<S extends string>(
  status: S,
  questions: MealQuestion[] | null | undefined,
  answered: boolean,
): S | 'ok' | 'por_rever' {
  if (pendingQuestions(questions).length) return 'por_rever'
  if (answered && (questions?.length ?? 0) > 0) return 'ok'
  return status
}

// As respostas desta refeição, para a nova estimativa.
export function thisMealAnswers(questions: MealQuestion[] | null | undefined) {
  return (questions ?? []).filter((q) => q.resposta != null).map((q) => ({ pergunta: q.pergunta, resposta: q.resposta! }))
}

// Junta as respostas dadas (por índice; vazias ficam por responder).
export function withAnswers(questions: MealQuestion[], answers: (string | null)[]): MealQuestion[] {
  return questions.map((q, i) => {
    const a = answers[i]?.trim()
    return a ? { ...q, resposta: a.slice(0, 200) } : q
  })
}

interface MealForContext {
  date: string
  slot: string | null
  logged_at: string
  raw_text: string | null
  items: MealItem[] | null
  questions?: MealQuestion[] | null
}

const byRecent = (a: MealForContext, b: MealForContext) => b.logged_at.localeCompare(a.logged_at)

// O que costuma comer neste momento do dia (as n mais recentes).
export function historyForPrompt(meals: MealForContext[], slot: string, n: number) {
  return meals
    .filter((m) => m.slot === slot && (m.items?.length ?? 0) > 0)
    .sort(byRecent)
    .slice(0, n)
    .map((m) => ({
      dia: m.date,
      titulo: m.raw_text ?? '',
      alimentos: (m.items ?? []).map((i) => `${i.name} ${Math.round(i.grams)} g`),
    }))
}

// As perguntas já respondidas (as n mais recentes).
export function answeredForPrompt(meals: MealForContext[], n: number) {
  return [...meals]
    .sort(byRecent)
    .flatMap((m) => (m.questions ?? []).filter((q) => q.resposta != null).map((q) => ({ dia: m.date, pergunta: q.pergunta, resposta: q.resposta! })))
    .slice(0, n)
}
