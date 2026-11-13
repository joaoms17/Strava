// Regras das rotinas da noite (crons): quando limpar, quando avisar do resumo
// da semana e o que a app diz quando a última noite correu mal. Puras: o
// histórico vem da tabela cron_runs, que pode ainda não existir (undefined =
// «não sei», e aí fica o comportamento de antes).

const DAY_MS = 86_400_000

export interface CronError {
  step: string
  user_id?: string
  date?: string
  message: string
}

// Um erro para o JSON da cron e para cron_runs (curto; nunca rebenta).
export function cronError(step: string, err: unknown, where: { user_id?: string; date?: string } = {}): CronError {
  const message = (err as { message?: unknown } | null)?.message
  const raw = typeof message === 'string' ? message : typeof err === 'string' ? err : JSON.stringify(err ?? null)
  return { step, ...where, message: String(raw ?? 'erro').slice(0, 200) }
}

function isSunday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0
}

// Limpeza semanal: ao domingo e, se a do domingo não chegou a correr (sem
// tempo, erro), na primeira noite seguinte em que a última tenha mais de 7
// dias. lastAt: undefined = sem histórico (tabela por criar) → só ao domingo;
// null = nunca correu → corre.
export function weeklyCleanupDue(today: string, lastAt: string | null | undefined, now: Date): boolean {
  if (isSunday(today)) return true
  if (lastAt === undefined) return false
  if (lastAt === null) return true
  return now.getTime() - Date.parse(lastAt) >= 7 * DAY_MS
}

// Limpeza mensal (api_calls e pesquisas de alimentos com mais de 90 dias):
// uma vez por mês, junto com a semanal. Sem histórico, no primeiro domingo do mês.
export function monthlyCleanupDue(today: string, lastAt: string | null | undefined): boolean {
  if (lastAt === undefined) return isSunday(today) && Number(today.slice(8, 10)) <= 7
  if (lastAt === null) return true
  return lastAt.slice(0, 7) < today.slice(0, 7)
}

export const RETENTION_DAYS = 90

export function retentionCutoff(now: Date, days = RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

// «Resumo da semana pronto»: avisa uma vez por semana, no primeiro fim de
// tarde em que o resumo da semana que acabou existe (à segunda, ou mais tarde
// se o resumo só saiu depois). notified: null = sem histórico → só à segunda,
// como antes.
export function weekNoticeDue(today: string, reviewExists: boolean, notified: boolean | null): boolean {
  if (!reviewExists) return false
  if (notified === null) return new Date(`${today}T12:00:00Z`).getUTCDay() === 1
  return !notified
}

export function weekNoticeKey(userId: string, weekStart: string): string {
  return `${userId}:${weekStart}`
}

export interface CronRun {
  started_at: string
  finished_at: string | null
  ok: boolean | null
  errors?: unknown
}

export type NightStatus = { kind: 'ok' } | { kind: 'falhou'; errors: number } | { kind: 'parada'; since: string }

// O que a app diz da rotina da noite. A cron corre todas as noites: a última
// execução com erros, uma que nunca acabou (> 5 min) ou nenhuma há mais de 2
// dias é aviso; sem histórico não se diz nada.
export function nightStatus(last: CronRun | null, now: Date): NightStatus {
  if (!last) return { kind: 'ok' }
  const started = Date.parse(last.started_at)
  if (now.getTime() - started > 2 * DAY_MS) return { kind: 'parada', since: last.started_at }
  const errors = Array.isArray(last.errors) ? last.errors.length : 0
  if (last.ok === false) return { kind: 'falhou', errors }
  if (last.finished_at == null && now.getTime() - started > 5 * 60_000) return { kind: 'falhou', errors }
  return { kind: 'ok' }
}
