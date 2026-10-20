import { useSyncExternalStore } from 'react'
import { postApi } from './api'
import { emitDataChanged } from './events'
import {
  AUTO_RETRY_WINDOW_MS,
  attemptKey,
  autoRetryDue,
  type AnalysisProgress,
  type PhoneTries,
  type RetryContext,
} from '../../api/_lib/rules/analise'

// Outra tentativa da análise, pedida pelo telemóvel sozinho (decisão 119): o
// servidor solta a análise depois de um erro passageiro (a IA demorou,
// sobrecarga) e fica à espera deste pedido. Antes, o Hoje pedia uma vez por
// tentativa e esquecia: se esse pedido se perdesse (rede a acordar ao voltar
// à app), nunca mais pedia, e a refeição ficava em «A análise parou a meio».
// Agora cada pedido fica registado neste telemóvel (sobrevive a recarregar a
// app) e, se a tentativa não mudou, volta a ir com a espera da fila das fotos,
// até 3 vezes (rules/analise.ts). Corre por trás, como a fila das fotos e a
// sincronização: não passa pelo «A guardar…» (lib/busy.tsx). Só com a app à
// vista e com rede; o Hoje e a folha da refeição chamam isto ao perguntar
// pelo estado, e um pedido de cada vez por refeição.

const KEY = 'regresso.analise-tentativas'

type Memo = Record<string, PhoneTries>

let memo: Memo | null = null
const inFlight = new Set<string>()
let snapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function load(): Memo {
  if (memo) return memo
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    memo = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Memo) : {}
  } catch {
    memo = {}
  }
  return memo
}

function save(next: Memo, now: number) {
  // Só as das últimas 12 h (depois disso já não há tentativa automática).
  memo = Object.fromEntries(Object.entries(next).filter(([, t]) => now - t.at < AUTO_RETRY_WINDOW_MS))
  try {
    localStorage.setItem(KEY, JSON.stringify(memo))
  } catch {
    // sem espaço ou modo privado: fica só em memória
  }
}

function emit() {
  snapshot = new Set(inFlight)
  for (const listener of listeners) listener()
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

// O que as regras precisam de saber deste telemóvel para uma refeição.
export function retryContext(mealId: string): RetryContext {
  return { online: online(), tries: load()[mealId] ?? null }
}

// Pede outra tentativa se for altura (devolve true quando pediu).
export function retryIfDue(meal: AnalysisProgress & { id: string }, now = Date.now()): boolean {
  if (inFlight.has(meal.id) || (typeof document !== 'undefined' && document.hidden)) return false
  const current = load()
  if (!autoRetryDue(meal, now, { online: online(), tries: current[meal.id] ?? null })) return false
  const key = attemptKey(meal)
  const before = current[meal.id]
  save({ ...current, [meal.id]: { key, tries: before?.key === key ? before.tries + 1 : 1, at: now } }, now)
  inFlight.add(meal.id)
  emit()
  // `auto`: no fim, o aviso «Refeição analisada», como na captura.
  void postApi('/api/meal/analyse', { meal_id: meal.id, auto: true })
    // Um pedido que falhe fica registado: a mesma tentativa volta a ir depois
    // da espera, ou passa a «Tentar outra vez» à 3.ª.
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(meal.id)
      emit()
      emitDataChanged()
    })
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// As refeições com um pedido destes a decorrer (mostram «A analisar outra vez…»).
export function useAutoRetrying(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}
