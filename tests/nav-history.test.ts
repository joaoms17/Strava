import { describe, expect, it } from 'vitest'
import { canGoBackInApp, installNavIndex, navIndex } from '../src/lib/nav-history'

// Um histórico de brincar com o mesmo comportamento do do navegador.
function fakeHistory() {
  const entries: unknown[] = [null]
  let at = 0
  const h = {
    get state() {
      return entries[at]
    },
    pushState(state: unknown, _unused?: string, _url?: string) {
      entries.splice(at + 1)
      entries.push(state)
      at++
    },
    replaceState(state: unknown, _unused?: string, _url?: string) {
      entries[at] = state
    },
    back() {
      if (at > 0) at--
    },
  }
  return h
}

describe('voltar recua no histórico da app (H12)', () => {
  it('a primeira entrada não tem para onde recuar dentro da app', () => {
    const h = fakeHistory()
    installNavIndex(h as unknown as History)
    expect(canGoBackInApp(h as unknown as History)).toBe(false)
  })

  it('cada push soma um, replace mantém e o estado de cada folha fica', () => {
    const h = fakeHistory()
    installNavIndex(h as unknown as History)
    h.pushState({ sheet: true }, '', '/definicoes')
    expect(navIndex(h.state)).toBe(1)
    expect((h.state as { sheet: boolean }).sheet).toBe(true)
    h.replaceState(null, '', '/definicoes/avancado')
    expect(navIndex(h.state)).toBe(1)
    h.pushState(null, '', '/favoritos')
    expect(navIndex(h.state)).toBe(2)
    h.back()
    expect(canGoBackInApp(h as unknown as History)).toBe(true)
    h.back()
    expect(canGoBackInApp(h as unknown as History)).toBe(false)
  })

  it('instalar duas vezes não soma a dobrar', () => {
    const h = fakeHistory()
    installNavIndex(h as unknown as History)
    installNavIndex(h as unknown as History)
    h.pushState(null, '', '/x')
    expect(navIndex(h.state)).toBe(1)
  })
})
