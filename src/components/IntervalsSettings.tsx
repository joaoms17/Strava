import { useState } from 'react'
import { postApi } from '../lib/api'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { recomputeFrom } from '../lib/recompute'
import { nutritionalDay } from '../lib/day'
import { syncNow, syncSummary } from '../lib/intervals'
import { syncedAgo } from '../../api/_lib/rules/intervals'

// Definições › Ligações › Treinos automáticos (intervals.icu). Só com relógio
// Garmin. A chave vai para o servidor e nunca volta ao telemóvel.
export default function IntervalsSettings() {
  const profile = useReadyProfile()
  const { reload } = useProfile()
  const toast = useToast()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const status = profile.integration_status?.intervals
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  async function run(label: string, action: () => Promise<string>) {
    setBusy(true)
    try {
      toast(await action())
    } catch (err) {
      toast(err instanceof Error ? err.message : `Não consegui ${label}.`)
    }
    await reload()
    setBusy(false)
  }

  const sync = (days: number) =>
    run('sincronizar', async () => {
      const r = await syncNow(days)
      if (r.oldestChanged) recomputeFrom(r.oldestChanged, today)
      return syncSummary(r)
    })

  if (!status?.connected) {
    return (
      <div className="space-y-3 text-[15px]">
        <p>Em 5 minutos os treinos e o sono do teu relógio (Garmin, Amazfit…) passam a entrar sozinhos.</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-dim">
          <li>Cria uma conta grátis em intervals.icu.</li>
          <li>Em Settings, liga o teu relógio (Garmin Connect, Amazfit/Zepp…) e ativa as atividades e os dados de bem-estar.</li>
          <li>Se o Strava também estiver ligado lá, desmarca «Download activities» do Strava.</li>
          <li>Em Settings › Developer Settings (no fundo da página), gera a chave e copia-a.</li>
          <li>Cola a chave aqui e toca em Testar e ligar.</li>
        </ol>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Cola aqui a chave"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
        />
        <button
          disabled={busy || key.trim().length < 8}
          onClick={() =>
            void run('ligar', async () => {
              const r = await postApi<{ athlete: string | null }>('/api/workout/connect', { api_key: key.trim() })
              setKey('')
              return `Ligado${r.athlete ? ` · ${r.athlete}` : ''}. Toca em «Importar últimos 30 dias».`
            })
          }
          className="min-h-12 w-full rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-40"
        >
          {busy ? 'A testar…' : 'Testar e ligar'}
        </button>
        {status?.last_error && <p className="text-[14px] text-pain">{status.last_error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3 text-[15px]">
      <p>
        Ligado{status.athlete ? ` · ${status.athlete}` : ''}
        {status.last_sync_at ? ` · sincronizado ${syncedAgo(status.last_sync_at, new Date())}` : ''}
      </p>
      {status.last_error && <p className="text-[14px] text-pain">{status.last_error}</p>}
      {status.wellness_error && (
        <p className="text-[14px] text-attn">Não consegui ler o sono: {status.wellness_error}</p>
      )}
      <p className="text-[13px] text-dim">
        As pesagens do intervals.icu só entram nos dias sem pesagem tua. Os treinos juntam-se à Bicicleta habitual ou ao
        print quando são a mesma sessão.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => void sync(3)} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-40">
          Sincronizar agora
        </button>
        <button disabled={busy} onClick={() => void sync(30)} className="min-h-12 rounded-xl border border-line disabled:opacity-40">
          Importar 30 dias
        </button>
      </div>
      <button
        disabled={busy}
        onClick={() => void run('desligar', async () => (await postApi('/api/workout/disconnect', {}), 'Desligado.'))}
        className="text-[14px] text-pain"
      >
        Desligar
      </button>
    </div>
  )
}
