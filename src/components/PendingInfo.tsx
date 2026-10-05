import { useState } from 'react'
import ShotButton from './ui/ShotButton'
import { useToast } from '../lib/toast'
import { useProfile } from '../lib/profile'
import { recomputeFrom } from '../lib/recompute'
import { syncNow } from '../lib/intervals'
import { readScoped, writeScoped } from '../lib/scoped'
import { fmtDayShort, timeOf } from '../lib/format'
import { shiftDate } from '../lib/day'
import { workoutTitle } from '../lib/workout-actions'
import { missingInfo } from '../../api/_lib/rules/sessoes'
import type { Workout } from '../lib/types'

const KEY = 'regresso.treinos.sem-prints'

function ignored(): string[] {
  try {
    return JSON.parse(readScoped(localStorage, KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

// Treino › Falta informação: a bicicleta do relógio que chegou sem km nem
// potência (das últimas 2 semanas) pede os prints do Garmin Connect, que a
// completam (`ShotButton` com o treino como destino). «Não tenho» esconde-a.
// «Ir buscar ao relógio» volta a pedir ao intervals.icu as 2 últimas semanas
// (km pela velocidade, o ficheiro da app da bicicleta, kcal).
export default function PendingInfo({ workouts, today }: { workouts: Workout[]; today: string }) {
  const toast = useToast()
  const { profile, reload } = useProfile()
  const [hidden, setHidden] = useState<string[]>(ignored)
  const [fetching, setFetching] = useState(false)
  const connected = profile?.integration_status?.intervals?.connected === true
  const pending = workouts
    .filter((w) => w.date >= shiftDate(today, -14) && !hidden.includes(w.id) && missingInfo(w).length > 0)
    .slice()
    .reverse()
  if (pending.length === 0) return null

  // Cada sincronização lê no máximo 4 ficheiros: até 3 voltas enquanto houver
  // treinos a ganhar informação.
  async function fetchAgain() {
    setFetching(true)
    let completed = 0
    let oldest: string | null = null
    try {
      for (let round = 0; round < 3; round++) {
        const result = await syncNow(14)
        completed += result.updated ?? 0
        if (result.oldestChanged && (!oldest || result.oldestChanged < oldest)) oldest = result.oldestChanged
        if (!result.updated) break
      }
      if (oldest) recomputeFrom(oldest, today)
      void reload()
      toast(
        completed > 0
          ? `Completei ${completed} ${completed === 1 ? 'treino' : 'treinos'} com o que o relógio tinha.`
          : 'O relógio não tem mais nada destes treinos: junta os prints.',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui falar com o intervals.icu.')
    } finally {
      setFetching(false)
    }
  }

  function hide(id: string) {
    const next = [...hidden, id].slice(-50)
    setHidden(next)
    writeScoped(localStorage, KEY, JSON.stringify(next))
  }

  return (
    <section className="space-y-2" aria-label="Falta informação">
      <div className="flex items-center justify-between gap-2">
        <p className="label">Falta informação</p>
        {connected && (
          <button disabled={fetching} onClick={() => void fetchAgain()} className="min-h-10 text-[15px] text-eat disabled:opacity-50">
            {fetching ? 'A ir buscar…' : 'Ir buscar ao relógio'}
          </button>
        )}
      </div>
      {pending.map((w) => (
        <div key={w.id} className="space-y-3 rounded-[18px] border border-attn/50 bg-attn/10 p-4">
          <p className="text-[16px]">
            <span className="font-semibold">
              {workoutTitle(w)} de {w.date === today ? 'hoje' : fmtDayShort(w.date)}
              {w.started_at ? `, ${timeOf(w.started_at)}` : ''} · {w.minutes} min
            </span>
            : faltam {missingInfo(w).join(' e ')}.
          </p>
          <p className="text-[14px] text-dim">
            No Garmin Connect abre o treino › Stats e tira 2 prints (em cima e em baixo, com a secção Connect IQ).
          </p>
          <div className="flex gap-2">
            <ShotButton
              target={w.id}
              className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-cta font-display text-[16px] font-bold tracking-[0.04em] text-on-cta uppercase"
            >
              Juntar os prints
            </ShotButton>
            <button onClick={() => hide(w.id)} className="min-h-12 rounded-xl border border-line px-3 text-[15px] text-dim">
              Não tenho
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
