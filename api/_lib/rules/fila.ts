// Fila das capturas (fotos e textos à espera de seguir, guardados no
// telemóvel): de quem é cada uma, se pode seguir e como fica depois de uma
// falha. Sem imports de servidor: o telemóvel usa este ficheiro diretamente.
import { failureText, isTransientFailure, retryDelayMs } from './falhas.js'

export interface QueuedCapture {
  state: 'pendente' | 'erro'
  error: string | null
  user_id?: string | null // de quem é (várias pessoas no mesmo telemóvel)
  attempts?: number // falhas passageiras seguidas (a espera cresce com elas)
}

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
// em português, à espera de «Tentar».
export function afterFailure<T extends QueuedCapture>(
  entry: T,
  failure: { transient: boolean; online: boolean; message?: string | null; status?: number | null },
): { entry: T; retryInMs: number | null } {
  if (failure.transient) {
    const attempts = (entry.attempts ?? 0) + 1
    return {
      entry: { ...entry, state: 'pendente', error: failure.online ? RETRY_TEXT : null, attempts },
      retryInMs: failure.online ? retryDelayMs(attempts) : null,
    }
  }
  return {
    entry: {
      ...entry,
      state: 'erro',
      error: failureText({ message: failure.message, status: failure.status }, 'Não consegui enviar.'),
    },
    retryInMs: null,
  }
}
