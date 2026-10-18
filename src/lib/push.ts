import { getApi, postApi } from './api'
import { readScoped, writeScoped } from './scoped'
import { NO_PUSH, anyPush, base64UrlToBytes, cleanPrefs, sameServerKey, type PushPrefs } from '../../api/_lib/rules/notificacoes'

// Notificações neste telemóvel (Web Push). No iPhone só existem com a app
// adicionada ao ecrã principal (iOS 16.4 ou mais recente), e a autorização
// pede-se num toque. O que cada pessoa ligou fica guardado aqui (de cada
// pessoa) para, ao abrir a app, confirmar que a subscrição continua viva: no
// iPhone às vezes morre sem aviso, e faz-se outra.

const KEY = 'regresso.notificacoes'

export const DENIED_TEXT =
  'As notificações estão bloqueadas para esta app. Liga-as em Definições do iPhone › Notificações › Daily Track.'

export type PushSupport = 'ok' | 'instalar' | 'nao'

export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok'
  // No Safari do iPhone (fora do ecrã principal) não há notificações: falta instalar.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !installed ? 'instalar' : 'nao'
}

export function pushPermission(): NotificationPermission {
  return pushSupport() === 'ok' ? Notification.permission : 'default'
}

// As escolhas que esta pessoa ligou neste telemóvel (null: nenhuma).
export function savedPushPrefs(): PushPrefs | null {
  const raw = readScoped(localStorage, KEY)
  if (!raw) return null
  try {
    const prefs = cleanPrefs(JSON.parse(raw))
    return anyPush(prefs) ? prefs : null
  } catch {
    return null
  }
}

function remember(prefs: PushPrefs | null): void {
  writeScoped(localStorage, KEY, prefs && anyPush(prefs) ? JSON.stringify(prefs) : null)
}

// O service worker (sem ele não há notificações). Em desenvolvimento não
// existe: não fica à espera para sempre.
async function worker(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('A app ainda se está a instalar. Fecha-a e abre outra vez.')), 10_000)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// Uma verificação de cada vez (ao abrir a app e em Definições podem chegar
// juntas): duas a refazer a subscrição deixavam uma perdida no servidor.
let checking: Promise<PushState> | null = null

let serverKey: Promise<string> | null = null
function publicKey(): Promise<string> {
  serverKey ??= getApi<{ publicKey: string }>('/api/day/push-key').then(
    (r) => r.publicKey,
    (err: unknown) => {
      serverKey = null
      throw err
    },
  )
  return serverKey
}

function subscribe(registration: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(key) as Uint8Array<ArrayBuffer>,
  })
}

// A subscrição deste telemóvel, se foi feita com a chave atual (com outra já
// não recebe).
async function current(registration: ServiceWorkerRegistration, key: string): Promise<PushSubscription | null> {
  const sub = await registration.pushManager.getSubscription()
  return sub && sameServerKey(sub.options?.applicationServerKey, key) ? sub : null
}

interface SubscribeResult {
  prefs: PushPrefs | null
  other?: boolean
  moved?: boolean
}

function register(sub: PushSubscription, body: { prefs?: PushPrefs; check?: boolean }): Promise<SubscribeResult> {
  return postApi<SubscribeResult>('/api/day/push-subscribe', { subscription: sub.toJSON(), ...body })
}

export interface PushState {
  prefs: PushPrefs | null
  other: boolean // este telemóvel recebe as notificações de outra pessoa
}

// Ligar, mudar ou desligar (de um toque em Definições › Notificações). A
// autorização pede-se logo, antes de esperar por outra coisa (o iPhone só a
// mostra a seguir a um toque); já dada, não volta a perguntar.
export async function applyPush(next: PushPrefs): Promise<PushState & { moved: boolean }> {
  if (!anyPush(next)) {
    await disablePush()
    return { prefs: null, other: false, moved: false }
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? DENIED_TEXT : 'Sem autorização, não há notificações.')
  // Uma verificação por trás a meio acaba primeiro (não refazem as duas).
  await checking?.catch(() => undefined)
  const registration = await worker()
  const key = await publicKey()
  const existing = await registration.pushManager.getSubscription()
  let sub = await current(registration, key)
  if (!sub) {
    await existing?.unsubscribe().catch(() => false)
    sub = await subscribe(registration, key)
  }
  const result = await register(sub, { prefs: next })
  const prefs = cleanPrefs(result.prefs)
  remember(prefs)
  return { prefs: anyPush(prefs) ? prefs : null, other: false, moved: result.moved === true }
}

async function disablePush(): Promise<void> {
  await checking?.catch(() => undefined)
  const sub = await (await worker()).pushManager.getSubscription()
  if (sub) {
    await postApi('/api/day/push-unsubscribe', { endpoint: sub.endpoint })
    await sub.unsubscribe().catch(() => false)
  }
  remember(null)
}

// Ao abrir a app (e em Definições): a subscrição continua viva e no servidor?
// Se morreu (o serviço disse ao servidor que acabou), mudou de chave ou
// desapareceu, faz-se outra com as escolhas guardadas aqui. Corre por trás,
// sem bloquear; nunca tira o telemóvel a outra pessoa.
export function checkPush(): Promise<PushState> {
  checking ??= verify().finally(() => {
    checking = null
  })
  return checking
}

async function verify(): Promise<PushState> {
  const saved = savedPushPrefs()
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return { prefs: saved, other: false }
  const registration = await worker()
  const existing = await registration.pushManager.getSubscription()
  if (!saved && !existing) return { prefs: null, other: false }
  const key = await publicKey()
  const usable = await current(registration, key)
  if (usable) {
    const result = await register(usable, { check: true })
    if (result.other) {
      remember(null)
      return { prefs: null, other: true }
    }
    const prefs = result.prefs ? cleanPrefs(result.prefs) : null
    if (prefs && anyPush(prefs)) {
      remember(prefs)
      return { prefs, other: false }
    }
  }
  if (!saved) return { prefs: null, other: false }
  await existing?.unsubscribe().catch(() => false)
  const result = await register(await subscribe(registration, key), { prefs: saved })
  const prefs = cleanPrefs(result.prefs)
  remember(prefs)
  return { prefs: anyPush(prefs) ? prefs : null, other: false }
}

export async function testPush(): Promise<void> {
  const sub = await (await worker()).pushManager.getSubscription()
  if (!sub) throw new Error('Este telemóvel já não recebe notificações. Liga-as outra vez.')
  await postApi('/api/day/push-test', { endpoint: sub.endpoint })
}

export { NO_PUSH }
