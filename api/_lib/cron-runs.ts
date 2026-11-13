import type { SupabaseClient } from '@supabase/supabase-js'
import type { CronError } from './rules/rotinas.js'

// Registo de cada execução das crons (tabela cron_runs, migração
// 20261113000030_cron_runs.sql). Tolerante: sem a tabela (ou com qualquer
// erro) a cron corre na mesma e o registo simplesmente não fica.

export interface CronRunRow {
  started_at: string
  summary: Record<string, unknown> | null
}

export async function startCronRun(admin: SupabaseClient, job: string): Promise<number | null> {
  try {
    const { data, error } = await admin.from('cron_runs').insert({ job }).select('id').single()
    if (error) return null
    return (data?.id as number | undefined) ?? null
  } catch {
    return null
  }
}

export async function finishCronRun(
  admin: SupabaseClient,
  id: number | null,
  result: { ok: boolean; errors: CronError[]; summary: Record<string, unknown> },
): Promise<void> {
  if (id == null) return
  try {
    const { error } = await admin
      .from('cron_runs')
      .update({ finished_at: new Date().toISOString(), ok: result.ok, errors: result.errors, summary: result.summary })
      .eq('id', id)
    if (error) console.error('cron_runs:', error.message)
  } catch (err) {
    console.error('cron_runs:', err)
  }
}

// As execuções acabadas de uma cron desde uma data (as mais recentes
// primeiro). undefined = sem histórico (tabela por criar ou erro).
export async function cronRunsSince(
  admin: SupabaseClient,
  job: string,
  sinceIso: string | null,
  limit = 50,
): Promise<CronRunRow[] | undefined> {
  try {
    let query = admin
      .from('cron_runs')
      .select('started_at,summary')
      .eq('job', job)
      .not('finished_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit)
    if (sinceIso) query = query.gte('started_at', sinceIso)
    const { data, error } = await query
    if (error) return undefined
    return (data ?? []) as CronRunRow[]
  } catch {
    return undefined
  }
}

// A última vez que uma cron fez um passo marcado no resumo (ex.: a limpeza).
// undefined = sem histórico; null = nunca.
export async function lastStepAt(admin: SupabaseClient, job: string, step: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('started_at')
      .eq('job', job)
      .eq(`summary->>${step}`, 'true')
      .order('started_at', { ascending: false })
      .limit(1)
    if (error) return undefined
    return (data?.[0]?.started_at as string | undefined) ?? null
  } catch {
    return undefined
  }
}
