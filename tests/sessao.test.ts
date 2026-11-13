import { describe, expect, it, vi } from 'vitest'
import { SESSION_CACHE_MS, sessionCacheUntil, userFromClaims } from '../api/_lib/rules/sessao'
import { dispatch, type Routes } from '../api/_lib/router'

// P7: a sessão valida-se pela assinatura do token e fica lembrada pouco
// tempo; a autenticação não enfraquece (só tokens de pessoas, nunca para lá
// da validade).
describe('sessão verificada localmente (P7)', () => {
  const now = Date.parse('2026-11-13T10:00:00Z')

  it('um token verificado fica lembrado no máximo 60 s', () => {
    const exp = now / 1000 + 3600
    expect(sessionCacheUntil(now, exp)).toBe(now + SESSION_CACHE_MS)
  })

  it('nunca para lá da validade do token (com 5 s de margem)', () => {
    const exp = now / 1000 + 30
    expect(sessionCacheUntil(now, exp)).toBe(now + 25_000)
    expect(sessionCacheUntil(now, now / 1000 + 4)).toBeNull()
    expect(sessionCacheUntil(now, now / 1000 - 60)).toBeNull()
  })

  it('sem validade no token, não se guarda', () => {
    expect(sessionCacheUntil(now, undefined)).toBeNull()
    expect(sessionCacheUntil(now, '123')).toBeNull()
  })

  it('a pessoa do token: id, email e o nome escolhido', () => {
    const user = userFromClaims({
      sub: 'u1',
      role: 'authenticated',
      aud: 'authenticated',
      email: 'joao@example.com',
      user_metadata: { name: 'João' },
      app_metadata: { provider: 'email' },
      exp: 1,
    })
    expect(user).toEqual({
      id: 'u1',
      email: 'joao@example.com',
      user_metadata: { name: 'João' },
      app_metadata: { provider: 'email' },
      aud: 'authenticated',
    })
  })

  it('a chave anónima, a de serviço ou um token sem sub não são pessoas', () => {
    expect(userFromClaims({ role: 'anon', iss: 'supabase' })).toBeNull()
    expect(userFromClaims({ role: 'service_role' })).toBeNull()
    expect(userFromClaims({ sub: 'u1', role: 'anon' })).toBeNull()
    expect(userFromClaims({ sub: '', role: 'authenticated' })).toBeNull()
    expect(userFromClaims(null)).toBeNull()
  })
})

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      return res
    },
  }
  return res
}

describe('routers com import() por ação (P7)', () => {
  it('só carrega a ação pedida', async () => {
    const save = vi.fn()
    const other = vi.fn()
    const routes: Routes = {
      save: async () => save,
      other: async () => {
        other()
        return () => undefined
      },
    }
    const res = fakeRes()
    const action = await dispatch(routes, { query: { action: 'save' } } as never, res as never)
    expect(action).toBe('save')
    expect(save).toHaveBeenCalledOnce()
    expect(other).not.toHaveBeenCalled()
  })

  it('ação desconhecida (também nomes do protótipo): 404', async () => {
    for (const action of ['nada', 'constructor', 'toString', '']) {
      const res = fakeRes()
      expect(await dispatch({}, { query: { action } } as never, res as never)).toBeNull()
      expect(res.statusCode).toBe(404)
    }
  })

  it('se o ficheiro da ação não carrega: 500 com frase genérica', async () => {
    const res = fakeRes()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const routes: Routes = { x: () => Promise.reject(new Error('módulo em falta')) }
    expect(await dispatch(routes, { query: { action: 'x' } } as never, res as never)).toBeNull()
    expect(res.statusCode).toBe(500)
    spy.mockRestore()
  })
})
