import { describe, expect, it } from 'vitest'
import {
  AUTO_RETRY_WINDOW_MS,
  PHONE_TRIES_PER_ATTEMPT,
  analysisStalled,
  analysisStuck,
  attemptKey,
  autoRetryDue,
  autoRetryable,
  type PhoneTries,
} from '../api/_lib/rules/analise'
import { errorForStorage, splitStoredError, AiError } from '../api/_lib/rules/resposta-ia'

// O jantar das 19:18 do João (uma linha do Uber Eats): registado às 18:19:59
// UTC, a 1.ª análise esgotou os 45 s e o servidor soltou-a (analysis_started_at
// null, 1 tentativa, o motivo guardado). O telemóvel pediu outra tentativa uma
// vez, esse pedido não chegou ao servidor, e nunca mais pediu.
const CREATED = '2026-10-20T18:19:59Z'
const at = (seconds: number) => Date.parse(CREATED) + seconds * 1000
const stored = errorForStorage(new AiError('A IA demorou demasiado a responder.', 'gemini-flash-latest: timeout 45000 ms', true))
const released = {
  id: 'a98e2ba7',
  status: 'a_analisar',
  created_at: CREATED,
  analysis_started_at: null as string | null,
  analysis_attempts: 1,
  analysis_error: stored as string | null,
}
const analysing = { ...released, analysis_started_at: '2026-10-20T18:20:00Z', analysis_error: null }
const online = { online: true }
const sent = (meal: typeof released, seconds: number, tries = 1): PhoneTries => ({ key: attemptKey(meal), tries, at: at(seconds) })

describe('outra tentativa pedida pelo telemóvel', () => {
  it('a análise solta (1.ª tentativa, há 3 min) pede-se logo, e não aparece «Tentar»', () => {
    expect(analysisStalled(released, at(180))).toBe(true)
    expect(autoRetryable(released, at(180))).toBe(true)
    expect(autoRetryDue(released, at(180), online)).toBe(true)
    expect(analysisStuck(released, at(180), online)).toBe(false)
  })

  it('vista primeiro a analisar: nada a pedir até o servidor a soltar (ou a reivindicação expirar)', () => {
    expect(autoRetryDue(analysing, at(30), online)).toBe(false)
    expect(analysisStuck(analysing, at(30), online)).toBe(false)
    // Solta aos 47 s: a chave muda e o pedido vai.
    expect(attemptKey(released)).not.toBe(attemptKey(analysing))
    expect(autoRetryDue(released, at(48), { online: true, tries: sent(analysing, 2) })).toBe(true)
    // A função morreu a meio (sem soltar): passados 95 s também se pede.
    expect(autoRetryDue(analysing, at(1 + 96), online)).toBe(true)
  })

  it('um pedido por tentativa; o que não chegou ao servidor volta a ir com a espera da fila', () => {
    const tries = sent(released, 180)
    expect(autoRetryDue(released, at(185), { online: true, tries })).toBe(false)
    expect(autoRetryDue(released, at(190), { online: true, tries })).toBe(true) // 10 s depois
    const second = sent(released, 190, 2)
    expect(autoRetryDue(released, at(210), { online: true, tries: second })).toBe(false)
    expect(autoRetryDue(released, at(220), { online: true, tries: second })).toBe(true) // 30 s depois
    // O registo de outra refeição (ou de outra tentativa) não conta.
    expect(autoRetryDue(released, at(181), { online: true, tries: { ...tries, key: 'outra:1:-' } })).toBe(true)
  })

  it('3 pedidos sem efeito, sem rede ou mais de 12 h: «Tentar outra vez» com o motivo', () => {
    const third = sent(released, 400, PHONE_TRIES_PER_ATTEMPT)
    expect(autoRetryDue(released, at(4000), { online: true, tries: third })).toBe(false)
    expect(analysisStuck(released, at(401), { online: true, tries: third })).toBe(true)
    expect(analysisStuck(released, at(180), { online: false })).toBe(true)
    expect(autoRetryDue(released, at(180), { online: false })).toBe(false)
    const late = AUTO_RETRY_WINDOW_MS / 1000 + 1
    expect(autoRetryable(released, at(late))).toBe(false)
    expect(autoRetryDue(released, at(late), online)).toBe(false)
    expect(analysisStuck(released, at(late), online)).toBe(true)
    // A frase que aparece é a guardada, não «A análise parou a meio.».
    expect(splitStoredError(released.analysis_error).message).toBe('A IA demorou demasiado a responder.')
  })

  it('depois da 3.ª tentativa já não pede; com erro do servidor também não', () => {
    const third = { ...released, analysis_attempts: 3 }
    expect(autoRetryDue(third, at(180), online)).toBe(false)
    expect(analysisStuck(third, at(180), online)).toBe(true)
    expect(autoRetryDue({ ...released, status: 'erro' }, at(180), online)).toBe(false)
    expect(analysisStuck({ ...released, status: 'erro' }, at(180), online)).toBe(false) // «erro» já mostra o botão
  })

  it('acabada de registar: espera os 25 s antes de pedir', () => {
    const fresh = { ...released, analysis_attempts: 0, analysis_error: null }
    expect(autoRetryDue(fresh, at(10), online)).toBe(false)
    expect(autoRetryDue(fresh, at(26), online)).toBe(true)
  })
})
