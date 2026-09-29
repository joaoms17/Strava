import { useRef, useState } from 'react'
import { postApi } from '../lib/api'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { recomputeFrom } from '../lib/recompute'
import { nutritionalDay } from '../lib/day'
import {
  historySummary,
  importHistory,
  loadImportState,
  newImport,
  syncNow,
  syncSummary,
  type ImportState,
} from '../lib/intervals'
import { shiftDate } from '../lib/day'
import { fmtDayMonth } from '../lib/format'
import { syncedAgo } from '../../api/_lib/rules/intervals'

// Definições › Ligações › Treinos automáticos (intervals.icu), com qualquer
// relógio que o intervals.icu receba (Garmin, Amazfit…). A chave vai para o
// servidor e nunca volta ao telemóvel.

const HISTORY_RANGES: { label: string; days: number | null }[] = [
  { label: '3 meses', days: 92 },
  { label: '1 ano', days: 366 },
  { label: '3 anos', days: 1096 },
  { label: 'Tudo', days: null },
]
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

  // Importar o histórico: bloco a bloco, com progresso e «Parar».
  const [history, setHistory] = useState<{ done: number; total: number; label: string; open: boolean } | null>(null)
  const [choosing, setChoosing] = useState(false)
  const stop = useRef(false)
  // Ponto guardado de uma importação que parou (corte de rede, app fechada).
  const [paused, setPaused] = useState<ImportState | null>(() => loadImportState())

  async function runImport(state: ImportState) {
    setChoosing(false)
    setBusy(true)
    stop.current = false
    // Ecrã sempre ligado durante a importação (o iPhone corta os pedidos
    // quando a app vai para segundo plano); volta a pedir ao regressar.
    type Lock = { release(): Promise<void> }
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Lock> } }).wakeLock
    let lock: Lock | null = null
    const acquire = async () => {
      try {
        lock = (await wakeLock?.request('screen')) ?? null
      } catch {
        lock = null
      }
    }
    const onVisible = () => {
      if (!document.hidden) void acquire()
    }
    await acquire()
    document.addEventListener('visibilitychange', onVisible)
    try {
      const totals = await importHistory(state, {
        cancelled: () => stop.current,
        onProgress: (done, total, window) => {
          setHistory({
            done,
            total,
            label: `${fmtDayMonth(window.oldest)} ${window.oldest.slice(0, 4)} a ${fmtDayMonth(window.newest)} ${window.newest.slice(0, 4)}`,
            // «Tudo» não sabe onde acaba: pára depois de um ano sem dados.
            open: state.untilEmpty,
          })
        },
      })
      if (totals.oldestChanged) recomputeFrom(totals.oldestChanged, today)
      toast(historySummary(totals))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(`A importação parou (${message}). O que já entrou está guardado: carrega em «Continuar».`)
    }
    document.removeEventListener('visibilitychange', onVisible)
    await (lock as Lock | null)?.release().catch(() => undefined)
    setPaused(loadImportState())
    setHistory(null)
    await reload()
    setBusy(false)
  }

  const runHistory = (days: number | null) =>
    runImport(newImport(days == null ? '2012-01-01' : shiftDate(today, -days), today, days == null))

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
        <button
          disabled={busy}
          onClick={() => setChoosing((c) => !c)}
          className="min-h-12 rounded-xl border border-line disabled:opacity-40"
        >
          Importar histórico
        </button>
      </div>
      {paused && !busy && (
        <div className="space-y-2 rounded-xl bg-surface2 p-3">
          <p className="text-[14px]">
            A importação do histórico parou em {fmtDayMonth(paused.nextNewest)} {paused.nextNewest.slice(0, 4)}. O que
            já entrou está guardado.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void runImport(paused)}
              className="min-h-11 rounded-lg bg-cta font-semibold text-on-cta"
            >
              Continuar
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem('regresso.importacao')
                } catch {
                  // nada
                }
                setPaused(null)
              }}
              className="min-h-11 rounded-lg border border-line text-[14px]"
            >
              Esquecer
            </button>
          </div>
        </div>
      )}
      {choosing && !busy && (
        <div className="space-y-2 rounded-xl bg-surface2 p-3">
          <p className="text-[14px] text-dim">
            Treinos, pesos, sono e passos que o intervals.icu tem do teu relógio. Os treinos que já registaste juntam-se;
            as tuas pesagens nunca são substituídas.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {HISTORY_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => void runHistory(r.days)}
                className="min-h-11 rounded-lg border border-line text-[14px]"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {history && (
        <div className="space-y-2 rounded-xl bg-surface2 p-3" role="status">
          <p className="text-[14px]">
            A importar {history.label}…{' '}
            {history.open
              ? `(${history.done} ${history.done === 1 ? 'mês feito' : 'meses feitos'})`
              : `(${history.done} de ${history.total})`}
          </p>
          {history.open ? (
            <p className="text-[13px] text-dim">Pára sozinho quando passar um ano sem dados. Deixa a app aberta.</p>
          ) : (
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-cta transition-all"
                style={{ width: `${Math.round((history.done / Math.max(1, history.total)) * 100)}%` }}
              />
            </div>
          )}
          <button onClick={() => (stop.current = true)} className="text-[14px] text-dim underline underline-offset-2">
            Parar
          </button>
        </div>
      )}
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
