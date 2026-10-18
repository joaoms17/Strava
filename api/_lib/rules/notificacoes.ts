// Notificações (Web Push) da app instalada no ecrã principal do iPhone: o
// que cada uma diz (neutro no ecrã bloqueado: sem pesos nem gordura), quem as
// quer, a que horas a cron as manda e as chaves VAPID. Sem imports de
// servidor: o telemóvel usa este ficheiro diretamente.
import { SLOT_LABEL, lisbonClock, type Slot } from './momentos.js'
import { isDayComplete } from './day-close.js'

// Cada uma liga-se à parte em Definições › Notificações (por telemóvel).
export const PUSH_KINDS = ['refeicao', 'jantar', 'semana'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export type PushPrefs = Record<PushKind, boolean>

export const NO_PUSH: PushPrefs = { refeicao: false, jantar: false, semana: false }

// O que está guardado (jsonb) → as três escolhas, sem mais nada.
export function cleanPrefs(raw: unknown): PushPrefs {
  const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(PUSH_KINDS.map((kind) => [kind, given[kind] === true])) as PushPrefs
}

export function anyPush(prefs: PushPrefs): boolean {
  return PUSH_KINDS.some((kind) => prefs[kind])
}

// A notificação de teste vai sempre para o telemóvel que a pediu.
export function wantsPush(prefs: unknown, kind: PushKind | 'teste'): boolean {
  return kind === 'teste' || cleanPrefs(prefs)[kind]
}

export interface PushNotice {
  title: string
  body: string
  url: string // caminho dentro da app (abre ao tocar)
  tag: string // a mesma substitui a anterior no iPhone
}

// «Almoço analisado · 640 kcal», ao acabar a análise em segundo plano.
export function mealAnalysedNotice(meal: {
  id: string
  date: string
  slot: string | null
  kcal: number | null
  status: string
}): PushNotice {
  const slot = meal.slot && meal.slot in SLOT_LABEL ? (meal.slot as Slot) : null
  const what = slot ? `${SLOT_LABEL[slot]} ${slot === 'ceia' ? 'analisada' : 'analisado'}` : 'Refeição analisada'
  return {
    title: `${what} · ${Math.round(Number(meal.kcal ?? 0))} kcal`,
    body: meal.status === 'por_rever' ? 'Vê se as porções estão certas.' : 'Toca para ver ou corrigir.',
    url: `/hoje/${meal.date}?folha=refeicao&id=${meal.id}`,
    tag: `refeicao-${meal.id}`,
  }
}

// Lembrete da noite: o dia ainda não está completo (regra 5) e não há
// jantar registado. Com o dia já respondido («Sim, foi tudo» ou «Não,
// faltou algo») não se lembra nada. `meals` são as refeições não apagadas do
// dia: um jantar ainda a analisar, sem análise (limite da IA) ou com erro já
// está registado; para a regra 5 só contam as analisadas (como meals_counted).
const COUNTED = ['ok', 'por_rever']

export function needsDinnerReminder(
  meals: { slot: string | null; kcal: number | null; status?: string | null }[],
  flags: string[],
): boolean {
  if (flags.includes('dia_fechado') || flags.includes('faltou_algo')) return false
  if (meals.some((m) => m.slot === 'jantar')) return false
  const counted = meals.filter((m) => m.status == null || COUNTED.includes(m.status))
  const kcalIn = counted.reduce((acc, m) => acc + Number(m.kcal ?? 0), 0)
  return !isDayComplete({ mealCount: counted.length, kcalIn, manuallyClosed: false })
}

export function dinnerNotice(date: string): PushNotice {
  return {
    title: 'Já jantaste?',
    body: 'Regista o jantar para o dia contar.',
    url: '/hoje?folha=registar',
    tag: `jantar-${date}`,
  }
}

// O resumo da semana que acabou (feito pela cron das 04:30), avisado de manhã.
export function weekNotice(weekStart: string): PushNotice {
  return {
    title: 'Resumo da semana pronto',
    body: 'Vê como correu a semana no Balanço.',
    url: `/balanco?semana=${weekStart}`,
    tag: `semana-${weekStart}`,
  }
}

export const TEST_NOTICE: PushNotice = {
  title: 'Notificações ligadas',
  body: 'É assim que vão aparecer neste telemóvel.',
  url: '/definicoes',
  tag: 'teste',
}

// Quanto tempo o serviço de notificações guarda cada uma com o telemóvel
// desligado (depois já não interessa).
export const PUSH_TTL_S: Record<PushKind | 'teste', number> = {
  refeicao: 3600,
  jantar: 2 * 3600,
  semana: 12 * 3600,
  teste: 600,
}

// A cron dos lembretes corre duas vezes (às 08:00 UTC à segunda e às 20:45
// UTC todos os dias; no Hobby do Vercel corre num minuto qualquer dessa hora
// UTC, por isso entre as 20:00 e as 22:00 em Lisboa): decide
// pela hora de Lisboa, com ou sem hora de verão.
export type ReminderSlot = 'manha' | 'noite'

export function reminderSlot(now: Date): ReminderSlot {
  return lisbonClock(now).hour < 15 ? 'manha' : 'noite'
}

export function isMonday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 1
}

// O serviço de notificações diz que a subscrição já não existe: apaga-se.
export function deadSubscription(status: number | null | undefined): boolean {
  return status === 404 || status === 410
}

// Só se envia para os serviços de notificações conhecidos (Apple, Google,
// Mozilla, Microsoft): o servidor nunca faz pedidos para outro endereço.
const PUSH_HOSTS = ['push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com']

export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

// Chaves VAPID nas env vars, se estiverem as duas (senão o servidor cria e
// guarda um par na base de dados, uma vez).
export function envVapidKeys(env: Record<string, string | undefined>): { publicKey: string; privateKey: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  return publicKey && privateKey ? { publicKey, privateKey } : null
}

// Contacto que vai em cada envio (o serviço da Apple exige mailto: ou https:):
// VAPID_SUBJECT, senão o endereço da app no Vercel.
export function vapidSubject(env: Record<string, string | undefined>): string {
  const own = env.VAPID_SUBJECT?.trim()
  if (own && /^(mailto:|https:\/\/)/i.test(own)) return own
  if (own && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(own)) return `mailto:${own}`
  const site = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (site && site !== 'localhost') return `https://${site}`
  return 'mailto:notificacoes@example.com'
}

// A chave pública (base64url) em bytes, para o browser e para comparar com a
// da subscrição que o telemóvel já tem.
export function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(base64)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

// A subscrição foi feita com esta chave? (Com outra, os envios falham: faz-se
// outra subscrição. Sem a chave da subscrição, não se sabe, e fica.)
export function sameServerKey(subscriptionKey: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!subscriptionKey) return true
  const a = new Uint8Array(subscriptionKey)
  const b = base64UrlToBytes(publicKey)
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
