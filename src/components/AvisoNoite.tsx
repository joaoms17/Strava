import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { nightStatus, type CronRun, type NightStatus } from '../../api/_lib/rules/rotinas'

// Aviso discreto em Avançado quando a rotina da noite (fecho dos dias,
// resumos, limpeza) falhou ou deixou de correr. Lê a tabela cron_runs; sem
// ela (migração por correr) ou com erro, não mostra nada.
export default function AvisoNoite() {
  const [status, setStatus] = useState<NightStatus>({ kind: 'ok' })

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('cron_runs')
          .select('started_at,finished_at,ok,errors')
          .eq('job', 'daily')
          .order('started_at', { ascending: false })
          .limit(1)
        if (error || !alive) return
        setStatus(nightStatus(((data ?? [])[0] as CronRun | undefined) ?? null, new Date()))
      } catch {
        // sem histórico, sem aviso
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (status.kind === 'ok') return null
  const text =
    status.kind === 'parada'
      ? `A rotina da noite não corre desde ${new Date(status.since).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}. Vê as crons no Vercel.`
      : `A rotina da última noite não correu toda${status.errors ? ` (${status.errors} ${status.errors === 1 ? 'erro' : 'erros'})` : ''}. Os dias que falharam ficam para a noite seguinte.`
  return (
    <p role="status" className="rounded-2xl bg-surface p-4 text-[0.8125rem] text-attn">
      {text}
    </p>
  )
}
