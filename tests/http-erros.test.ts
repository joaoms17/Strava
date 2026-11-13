import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { respondError } from '../api/_lib/http'
import { HttpError } from '../api/_lib/supabase'

// P7: os erros do SDK da Anthropic reconhecem-se sem o importar no servidor;
// G5: um erro inesperado nunca devolve a mensagem crua.
function capture(err: unknown): [number, unknown] {
  let out: [number, unknown] = [0, null]
  const res = { status: (n: number) => ({ json: (body: unknown) => (out = [n, body]) }) }
  respondError(res as never, err)
  return out
}

describe('respondError', () => {
  it('erros do SDK pelo nome da classe', () => {
    expect(capture(new Anthropic.RateLimitError(429, undefined, 'x', new Headers()))[0]).toBe(503)
    expect(capture(new Anthropic.APIConnectionTimeoutError())[0]).toBe(504)
    expect(capture(new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()))[0]).toBe(500)
    expect(capture(new Anthropic.InternalServerError(500, undefined, 'x', new Headers()))[0]).toBe(502)
  })

  it('HttpError passa a mensagem; o resto fica genérico', () => {
    expect(capture(new HttpError(409, 'Já existe.'))).toEqual([409, { error: 'Já existe.' }])
    expect(capture(new Error('duplicate key value violates unique constraint "x"'))).toEqual([500, { error: 'Erro inesperado.' }])
  })
})
