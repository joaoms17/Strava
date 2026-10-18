import { describe, expect, it } from 'vitest'
import { failureText, isTransientFailure, retryDelayMs } from '../api/_lib/rules/falhas'
import { sessionEnded } from '../api/_lib/rules/pessoas'

describe('falhas passageiras', () => {
  it('rede fraca no iPhone (Storage devolve StorageUnknownError «Load failed») passa sozinha', () => {
    expect(isTransientFailure({ name: 'StorageUnknownError', message: 'Load failed' })).toBe(true)
    expect(isTransientFailure({ name: 'Error', message: 'Load failed' })).toBe(true)
    expect(isTransientFailure({ name: 'TypeError', message: 'Failed to fetch' })).toBe(true)
    expect(isTransientFailure({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true)
  })

  it('servidor ocupado ou em baixo passa sozinho; validação e permissões não', () => {
    for (const status of [0, 408, 429, 500, 502, 503, 504]) expect(isTransientFailure({ status })).toBe(true)
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isTransientFailure({ status, message: 'Falta a foto ou o texto.' })).toBe(false)
    }
    expect(isTransientFailure({ name: 'StorageApiError', message: 'new row violates row-level security policy' })).toBe(
      false,
    )
  })

  it('a frase em português: a da app, pelo estado do servidor, ou pela rede', () => {
    expect(failureText({ name: 'StorageUnknownError', message: 'Load failed' })).toBe(
      'Sem rede ou rede fraca. Tenta outra vez.',
    )
    expect(failureText({ name: 'AuthRetryableFetchError', message: '' })).toBe('Sem rede ou rede fraca. Tenta outra vez.')
    // O 504 do Vercel (a função passou dos 60 s) não traz mensagem.
    expect(failureText({ status: 504, message: 'Erro 504' })).toBe('O servidor demorou demasiado. Tenta outra vez.')
    // Um 500 traz muitas vezes a mensagem crua do Postgres (em inglês).
    expect(failureText({ status: 500, message: 'duplicate key value violates unique constraint' })).toBe(
      'O servidor falhou. Tenta outra vez daqui a pouco.',
    )
    expect(failureText({ status: 502, message: 'A IA não respondeu. Tenta outra vez.' })).toBe(
      'A IA não respondeu. Tenta outra vez.',
    )
    expect(failureText({ status: 429 })).toMatch(/Espera um minuto/)
    // O limite da IA (429 da app) mantém a frase do servidor.
    expect(failureText({ status: 429, message: 'Chegaste ao limite mensal da IA (Definições › Avançado).' })).toBe(
      'Chegaste ao limite mensal da IA (Definições › Avançado).',
    )
    expect(failureText({ status: 400, message: 'Falta a foto ou o texto.' })).toBe('Falta a foto ou o texto.')
    expect(failureText({ message: 'Erro 418' }, 'Não consegui guardar.')).toBe('Não consegui guardar.')
    expect(failureText({})).toBe('Não consegui. Tenta outra vez.')
  })

  it('a fila espera cada vez mais entre tentativas, até 5 min', () => {
    expect(retryDelayMs(0)).toBe(10_000)
    expect(retryDelayMs(1)).toBe(10_000)
    expect(retryDelayMs(2)).toBe(30_000)
    expect(retryDelayMs(3)).toBe(120_000)
    expect(retryDelayMs(4)).toBe(300_000)
    expect(retryDelayMs(40)).toBe(300_000)
  })
})

describe('trocar de pessoa sem rede', () => {
  it('sem rede ou com o servidor em baixo a sessão continua (a pessoa fica no telemóvel)', () => {
    expect(sessionEnded({ name: 'AuthRetryableFetchError', message: 'Load failed', status: 0 })).toBe(false)
    expect(sessionEnded({ name: 'AuthRetryableFetchError', message: 'Bad Gateway', status: 502 })).toBe(false)
    expect(sessionEnded({ name: 'TypeError', message: 'Failed to fetch' })).toBe(false)
    expect(sessionEnded({ name: 'AuthUnknownError', message: 'Unexpected token <' })).toBe(false)
    expect(sessionEnded(null)).toBe(false)
  })

  it('token recusado pelo servidor: a sessão acabou', () => {
    expect(
      sessionEnded({ name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 }),
    ).toBe(true)
    expect(sessionEnded({ name: 'AuthApiError', message: 'invalid JWT', status: 401 })).toBe(true)
    expect(sessionEnded({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(true)
  })
})
