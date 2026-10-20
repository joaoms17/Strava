// O tempo de uma chamada à IA. Cada função do Vercel tem 60 s no total, com
// a foto a descarregar e as escritas na base de dados lá dentro; a chamada à
// IA tem o seu teto (25 s texto, 45 s fotos) e, com o Gemini, divide-o entre
// o modelo principal e o de reserva. Antes, o principal ficava com o tempo
// todo: quando esgotava os 45 s, a reserva nunca chegava a correr.

export interface AiRequest {
  maxRetries: number
  timeout: number
}

// Abaixo disto não vale a pena chamar a IA (nem a reserva).
export const MIN_ATTEMPT_MS = 8_000
// A fatia da reserva: 15 s, ou 40 % do total quando o total é curto (texto:
// 15 s para o principal, 10 s para a reserva).
export const RESERVE_SLICE_MS = 15_000
const RESERVE_SHARE = 0.4

export function reserveSliceMs(totalMs: number): number {
  return Math.min(RESERVE_SLICE_MS, Math.floor(totalMs * RESERVE_SHARE))
}

// Quanto pode demorar o modelo `index` (0 = principal) de `count`, com
// `elapsedMs` já gastos de `totalMs`. Um modelo com outro a seguir deixa a
// fatia da reserva; o último fica com o que sobra. null: sem tempo útil.
export function attemptBudgetMs(totalMs: number, elapsedMs: number, index: number, count: number): number | null {
  const left = totalMs - elapsedMs
  if (left < MIN_ATTEMPT_MS) return index === 0 && left > 0 ? left : null
  if (index >= count - 1) return left
  return Math.max(left - reserveSliceMs(totalMs), MIN_ATTEMPT_MS)
}

// O pedido com o teto encurtado para caber no tempo que falta à função (com
// `marginMs` para gravar o resultado). null: já não cabe uma chamada útil.
export function requestWithin(request: AiRequest, leftMs: number, marginMs = 0): AiRequest | null {
  const timeout = Math.min(request.timeout, leftMs - marginMs)
  return timeout >= MIN_ATTEMPT_MS ? { ...request, timeout } : null
}

// A análise de uma refeição corre dentro de uma função de 60 s (a captura ou
// o «analisar»), que antes já fez a sessão, o limite e o insert (1–2 s) e
// depois grava, aprende os alimentos, partilha e avisa (1–2 s). A análise
// fica com 52 s: o descarregar das fotos, a chamada (45 s no máximo) e a
// correção pela nota, se a nota mudou a meio e ainda couber.
export const ANALYSIS_FUNCTION_BUDGET_MS = 52_000
// O que fica para gravar depois da chamada à IA.
export const ANALYSIS_WRITE_MARGIN_MS = 3_000
