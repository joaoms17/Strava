import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { HttpError } from './supabase.js'
import {
  PUSH_TTL_S,
  deadSubscription,
  envVapidKeys,
  mealAnalysedNotice,
  vapidSubject,
  wantsPush,
  type PushKind,
  type PushNotice,
} from './rules/notificacoes.js'
import { orderSplitHint } from './rules/pedido.js'

// Notificações (Web Push, com a app no ecrã principal do iPhone). As chaves
// VAPID vêm das env vars VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY ou, sem elas,
// são criadas na primeira vez e guardadas em app_secrets (só o servidor lá
// chega). Nunca se trocam: uma chave nova obrigava todos os telemóveis a
// subscrever outra vez (as subscrições feitas com outra chave apagam-se).

export const PUSH_MIGRATION = '20261018150000_notificacoes.sql'
export const MISSING_PUSH_MIGRATION = `Falta um passo no Supabase: corre a migração ${PUSH_MIGRATION}.`

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

export interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  vapid_key: string
  prefs: unknown
}

export const SUBSCRIPTION_COLUMNS = 'id,user_id,endpoint,p256dh,auth,vapid_key,prefs'

// A tabela ainda não existe (migração por correr).
export function missingTable(error: { code?: string; message?: string } | null): boolean {
  return error != null && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? ''))
}

function isKeys(value: unknown): value is VapidKeys {
  const v = value as VapidKeys | null
  return typeof v?.publicKey === 'string' && typeof v?.privateKey === 'string' && v.publicKey.length > 20 && v.privateKey.length > 20
}

let cached: VapidKeys | null = null

export async function vapidKeys(admin: SupabaseClient): Promise<VapidKeys> {
  if (cached) return cached
  const fromEnv = envVapidKeys(process.env)
  if (fromEnv) return (cached = fromEnv)
  const read = async () => {
    const { data, error } = await admin.from('app_secrets').select('value').eq('key', 'vapid').maybeSingle()
    if (missingTable(error)) throw new HttpError(503, MISSING_PUSH_MIGRATION)
    if (error) throw new Error(error.message)
    return data?.value as unknown
  }
  let value = await read()
  if (value == null) {
    // Só se cria se não houver nenhuma; se dois pedidos chegarem juntos,
    // fica a primeira que entrou e ambos usam essa.
    const { error } = await admin.from('app_secrets').insert({ key: 'vapid', value: webpush.generateVAPIDKeys() })
    if (error && error.code !== '23505') throw new Error(error.message)
    value = await read()
  }
  if (!isKeys(value)) throw new Error('Chaves das notificações inválidas em app_secrets.')
  return (cached = value)
}

// Envia uma notificação a estas subscrições (as que a querem). Apaga as que o
// serviço diz que já não existem (404/410) e as feitas com outra chave.
// Nunca falha: devolve quantas foram entregues.
export async function deliver(
  admin: SupabaseClient,
  rows: SubscriptionRow[],
  kind: PushKind | 'teste',
  notice: PushNotice,
): Promise<number> {
  const wanted = rows.filter((row) => wantsPush(row.prefs, kind))
  if (!wanted.length) return 0
  let keys: VapidKeys
  try {
    keys = await vapidKeys(admin)
  } catch (err) {
    console.error('Notificações sem chaves:', err)
    return 0
  }
  const dead: string[] = []
  const ok: string[] = []
  const payload = JSON.stringify(notice)
  await Promise.all(
    wanted.map(async (row) => {
      if (row.vapid_key !== keys.publicKey) {
        dead.push(row.id)
        return
      }
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
          vapidDetails: { subject: vapidSubject(process.env), ...keys },
          TTL: PUSH_TTL_S[kind],
          urgency: 'normal',
          timeout: 5_000,
        })
        ok.push(row.id)
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (deadSubscription(status)) dead.push(row.id)
        else console.error(`Notificação (${kind}) falhou:`, status ?? '', (err as Error).message)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead)
  if (ok.length) await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).in('id', ok)
  return ok.length
}

// Para todos os telemóveis de uma pessoa que querem este tipo.
export async function pushToUser(
  admin: SupabaseClient,
  userId: string,
  kind: PushKind,
  notice: PushNotice,
): Promise<number> {
  try {
    const { data, error } = await admin.from('push_subscriptions').select(SUBSCRIPTION_COLUMNS).eq('user_id', userId)
    if (error) {
      if (!missingTable(error)) console.error('Notificações:', error.message)
      return 0
    }
    return await deliver(admin, (data ?? []) as SubscriptionRow[], kind, notice)
  } catch (err) {
    console.error('Notificação falhou:', err)
    return 0
  }
}

// «Almoço analisado · 640 kcal», no fim da análise em segundo plano. Sem
// resultado (outra tentativa mandou, erro) não avisa; nunca falha a análise.
export async function notifyMealAnalysed(admin: SupabaseClient, meal: Record<string, unknown> | null): Promise<void> {
  if (!meal || (meal.status !== 'ok' && meal.status !== 'por_rever')) return
  await pushToUser(
    admin,
    meal.user_id as string,
    'refeicao',
    mealAnalysedNotice({
      id: meal.id as string,
      date: meal.date as string,
      slot: (meal.slot as string | null) ?? null,
      kcal: (meal.kcal as number | null) ?? null,
      status: meal.status as string,
      orderPeople: orderSplitHint({ ...meal, status: meal.status as string }),
    }),
  )
}
