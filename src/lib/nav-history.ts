// H12: «‹ Voltar» recua no histórico (como o gesto do iPhone) em vez de
// empilhar o ecrã pai. Para saber se a entrada anterior ainda é da app, cada
// entrada leva um índice: pushState soma 1, replaceState mantém. Com índice 0
// (a app abriu neste ecrã, por um link ou ao recarregar) vai-se para o pai.
const KEY = '__navIdx'

type StateHistory = Pick<History, 'pushState' | 'replaceState' | 'state'>

export function navIndex(state: unknown): number {
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[KEY] : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function withIndex(state: unknown, index: number): Record<string, unknown> {
  return { ...(state && typeof state === 'object' ? (state as Record<string, unknown>) : {}), [KEY]: index }
}

const patched = new WeakSet<object>()

export function installNavIndex(history: StateHistory = window.history): void {
  if (patched.has(history)) return
  patched.add(history)
  const push = history.pushState.bind(history)
  const replace = history.replaceState.bind(history)
  history.pushState = (state: unknown, unused: string, url?: string | URL | null) =>
    push(withIndex(state, navIndex(history.state) + 1), unused, url)
  history.replaceState = (state: unknown, unused: string, url?: string | URL | null) =>
    replace(withIndex(state, navIndex(history.state)), unused, url)
}

export function canGoBackInApp(history: Pick<History, 'state'> = window.history): boolean {
  return navIndex(history.state) > 0
}
