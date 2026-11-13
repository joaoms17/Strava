import { describe, expect, it } from 'vitest'
import { MAX_SERVER_FAILURES, RETRY_TEXT, afterFailure, ownCapture, sendableCapture, type QueuedCapture } from '../api/_lib/rules/fila'

// A fila das fotos no telemóvel: o registo sem rede não se pode perder.
const pending: QueuedCapture & { client_id: string } = { client_id: 'c1', state: 'pendente', error: null, user_id: 'joana' }

describe('fila das capturas', () => {
  it('cada pessoa só envia as suas; as antigas sem dono seguem com quem estiver', () => {
    expect(ownCapture({ user_id: 'joana' }, 'joana')).toBe(true)
    expect(ownCapture({ user_id: 'joana' }, 'joao')).toBe(false)
    expect(ownCapture({ user_id: null }, 'joao')).toBe(true)
    expect(ownCapture({}, 'joao')).toBe(true)
    expect(ownCapture({ user_id: 'joana' }, null)).toBe(true)
  })

  it('segue a que está por enviar e as que falharam por causa da rede', () => {
    expect(sendableCapture(pending)).toBe(true)
    expect(sendableCapture({ state: 'erro', error: 'Load failed' })).toBe(true)
    expect(sendableCapture({ state: 'erro', error: 'Erro 503' })).toBe(true)
    // Um erro definitivo espera por «Tentar».
    expect(sendableCapture({ state: 'erro', error: 'Fotografia inválida.' })).toBe(false)
    expect(sendableCapture({ state: 'erro', error: 'Erro 403' })).toBe(false)
  })

  it('falha passageira com rede: fica por enviar e tenta sozinha, cada vez mais tarde', () => {
    const first = afterFailure(pending, { transient: true, online: true })
    expect(first.entry).toEqual({ ...pending, state: 'pendente', error: RETRY_TEXT, attempts: 1 })
    expect(first.retryInMs).toBe(10_000)
    // Rede fraca (sem resposta do servidor): as seguintes também falhariam.
    expect(first.stop).toBe(true)
    const third = afterFailure({ ...pending, attempts: 2 }, { transient: true, online: true })
    expect(third.entry.attempts).toBe(3)
    expect(third.retryInMs).toBe(120_000)
    expect(third.entry.client_id).toBe('c1')
  })

  it('sem rede: fica por enviar sem frase de erro e espera que a rede volte', () => {
    const offline = afterFailure(pending, { transient: true, online: false })
    expect(offline.entry.state).toBe('pendente')
    expect(offline.entry.error).toBeNull()
    expect(offline.retryInMs).toBeNull()
    expect(offline.stop).toBe(true)
  })

  it('servidor a falhar (5xx) com rede: não segura a fila e passa a erro ao fim de N vezes (H1)', () => {
    let entry: typeof pending = pending
    for (let i = 1; i < MAX_SERVER_FAILURES; i++) {
      const next = afterFailure(entry, { transient: true, online: true, status: 503, message: 'Erro 503' })
      expect(next.entry.state).toBe('pendente')
      expect(next.entry.server_failures).toBe(i)
      expect(next.retryInMs).not.toBeNull()
      // A seguinte da fila tenta-se já.
      expect(next.stop).toBe(false)
      entry = next.entry
    }
    const last = afterFailure(entry, { transient: true, online: true, status: 500, message: 'relation does not exist' })
    expect(last.entry.state).toBe('erro')
    expect(last.entry.error).toBe('O servidor falhou. Tenta outra vez daqui a pouco.')
    expect(last.retryInMs).toBeNull()
    expect(last.stop).toBe(false)
    // Fica à espera de «Tentar» (não volta a seguir sozinha a cada abertura).
    expect(sendableCapture(last.entry)).toBe(false)
    // 50 falhas seguidas já não deixam a captura «pendente» para sempre.
    let many: typeof pending = pending
    for (let i = 0; i < 50; i++) many = afterFailure(many, { transient: true, online: true, status: 502 }).entry
    expect(many.state).toBe('erro')
  })

  it('uma falha de rede pelo meio não conta como falha do servidor', () => {
    const net = afterFailure({ ...pending, server_failures: 2 }, { transient: true, online: true })
    expect(net.entry.state).toBe('pendente')
    expect(net.entry.server_failures).toBe(2)
    // 429 (muitos pedidos) não é 5xx: espera, sem passar a erro.
    const busy = afterFailure({ ...pending, server_failures: 2 }, { transient: true, online: true, status: 429 })
    expect(busy.entry.state).toBe('pendente')
  })

  it('erro definitivo: passa a erro com a frase em português, sem tentar sozinha', () => {
    const failed = afterFailure(pending, { transient: false, online: true, message: 'Fotografia inválida.', status: 403 })
    expect(failed.entry.state).toBe('erro')
    expect(failed.entry.error).toBe('Fotografia inválida.')
    expect(failed.retryInMs).toBeNull()
    // Sem frase do servidor (ou só «Erro 404»), a frase da app.
    expect(afterFailure(pending, { transient: false, online: true, message: 'Erro 404', status: 404 }).entry.error).toBe(
      'Não consegui enviar.',
    )
    // E volta a não seguir sozinha.
    expect(sendableCapture(failed.entry)).toBe(false)
  })
})
