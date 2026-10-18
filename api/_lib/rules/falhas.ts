// Falhas de rede e do servidor: as passageiras (sem rede, rede fraca,
// servidor ocupado ou em baixo) tentam-se outra vez sozinhas; as outras
// (dados inválidos, sem permissão) ficam à espera de quem usa a app. E a
// frase em português para cada uma (o Safari só diz «Load failed»). Sem
// imports de servidor: o telemóvel usa este ficheiro diretamente.

export interface Failure {
  name?: string | null
  message?: string | null
  status?: number | null
}

// O que o fetch e o supabase-js dizem quando a rede falha, em cada browser.
const NETWORK_MESSAGE =
  /load failed|failed to fetch|networkerror|network ?error|network request failed|network connection was lost|internet connection appears to be offline|fetch failed|timed? ?out|^offline$/i
// O nome das falhas de rede do supabase-js (Storage e Auth embrulham o TypeError).
const NETWORK_NAMES = new Set(['TypeError', 'StorageUnknownError', 'AuthRetryableFetchError'])
// A mensagem que a app põe quando o servidor não manda nenhuma.
const GENERIC_MESSAGE = /^erro \d+$/i
// As mensagens da app levam acentos; as da base de dados (inglês) não.
const PORTUGUESE = /[áàâãçéêíóôõú]/i

export function isTransientFailure(failure: Failure): boolean {
  const { name, message, status } = failure
  if (name && NETWORK_NAMES.has(name)) return true
  if (status != null && (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500)) {
    return true
  }
  return NETWORK_MESSAGE.test(message ?? '')
}

// A frase para mostrar: a do servidor quando é da app (já em português; um
// 500 traz muitas vezes a mensagem crua da base de dados, em inglês), senão
// pelo estado do servidor ou pela rede.
export function failureText(failure: Failure, fallback = 'Não consegui. Tenta outra vez.'): string {
  const { status } = failure
  const message = failure.message?.trim() ?? ''
  // Um TypeError só é de rede com a frase de rede (pode ser um erro da app).
  const network =
    NETWORK_MESSAGE.test(message) || (status == null && !!failure.name && failure.name !== 'TypeError' && NETWORK_NAMES.has(failure.name))
  const own = message !== '' && !GENERIC_MESSAGE.test(message) && !network
  if (status === 429) return 'Muitos pedidos seguidos. Espera um minuto e tenta outra vez.'
  if (own && (status == null || status < 500 || PORTUGUESE.test(message))) return message
  if (status === 408 || status === 504) return 'O servidor demorou demasiado. Tenta outra vez.'
  if (status != null && status >= 500) return 'O servidor falhou. Tenta outra vez daqui a pouco.'
  if (network) return 'Sem rede ou rede fraca. Tenta outra vez.'
  return fallback
}

// Espera antes de a fila tentar outra vez sozinha (cresce até 5 min). Abrir
// a app ou voltar a rede tenta logo.
const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 300_000]

export function retryDelayMs(failedAttempts: number): number {
  const i = Math.min(Math.max(failedAttempts, 1), RETRY_DELAYS_MS.length) - 1
  return RETRY_DELAYS_MS[i]!
}
