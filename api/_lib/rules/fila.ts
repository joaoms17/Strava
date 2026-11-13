// Fila das capturas (fotos e textos à espera de seguir, guardados no
// telemóvel): de quem é cada uma, se pode seguir e como fica depois de uma
// falha. Sem imports de servidor: o telemóvel usa este ficheiro diretamente.
import { failureText, isTransientFailure, retryDelayMs } from './falhas.js'

export interface QueuedCapture {
  state: 'pendente' | 'erro'
  error: string | null
  user_id?: string | null // de quem é (várias pessoas no mesmo telemóvel)
  attempts?: number // falhas passageiras seguidas (a espera cresce com elas)
  server_failures?: number // falhas do servidor (5xx) seguidas, com rede (H1)
}

// Depois de tantas falhas do servidor seguidas (com rede), a captura passa a
// «erro» e deixa as outras seguir (H1): antes ficava «pendente» para sempre e
// segurava a fila toda.
export const MAX_SERVER_FAILURES = 3

// O que a captura diz enquanto espera por outra tentativa.
export const RETRY_TEXT = 'Ainda não consegui enviar: vou tentar outra vez sozinha.'

// Só as da pessoa que está a usar a app (as antigas, sem dono, contam para todas).
export function ownCapture(entry: Pick<QueuedCapture, 'user_id'>, userId: string | null): boolean {
  return !entry.user_id || !userId || entry.user_id === userId
}

// Pode seguir: por enviar, ou uma que falhou por causa da rede (antes destas
// regras ficava em «erro» com «Load failed» ou «Erro 503»).
export function sendableCapture(entry: QueuedCapture): boolean {
  if (entry.state === 'pendente') return true
  const legacyStatus = Number(/^Erro (\d{3})$/.exec(entry.error ?? '')?.[1]) || null
  return isTransientFailure({ message: entry.error, status: legacyStatus })
}

// Depois de uma falha. Passageira (sem rede, rede fraca, servidor ocupado):
// fica por enviar e, com rede, tenta outra vez sozinha, cada vez mais tarde
// (sem rede espera que a rede volte). As outras passam a «erro», com a frase
// em português, à espera de «Tentar». Um servidor que falha (5xx) com rede
// não segura a fila: a seguinte tenta-se já (`stop` falso) e, ao fim de
// MAX_SERVER_FAILURES seguidas, esta passa a «erro» (H1). Sem rede (ou com a
// rede a falhar, sem resposta do servidor) a volta pára: as outras também
// falhariam.
export function afterFailure<T extends QueuedCapture>(
  entry: T,
  failure: { transient: boolean; online: boolean; message?: string | null; status?: number | null },
): { entry: T; retryInMs: number | null; stop: boolean } {
  const serverFailure = failure.online && failure.status != null && failure.status >= 500
  if (failure.transient) {
    const attempts = (entry.attempts ?? 0) + 1
    if (serverFailure) {
      const serverFailures = (entry.server_failures ?? 0) + 1
      if (serverFailures >= MAX_SERVER_FAILURES) {
        return {
          entry: {
            ...entry,
            state: 'erro',
            attempts,
            server_failures: serverFailures,
            error: failureText({ message: failure.message, status: failure.status }, 'Não consegui enviar.'),
          },
          retryInMs: null,
          stop: false,
        }
      }
      return {
        entry: { ...entry, state: 'pendente', error: RETRY_TEXT, attempts, server_failures: serverFailures },
        retryInMs: retryDelayMs(attempts),
        stop: false,
      }
    }
    return {
      entry: { ...entry, state: 'pendente', error: failure.online ? RETRY_TEXT : null, attempts },
      retryInMs: failure.online ? retryDelayMs(attempts) : null,
      stop: true,
    }
  }
  return {
    entry: {
      ...entry,
      state: 'erro',
      error: failureText({ message: failure.message, status: failure.status }, 'Não consegui enviar.'),
    },
    retryInMs: null,
    stop: false,
  }
}
