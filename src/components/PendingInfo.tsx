import { useState } from 'react'
import ShotButton from './ui/ShotButton'
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
export default function PendingInfo({ workouts, today }: { workouts: Workout[]; today: string }) {
  const [hidden, setHidden] = useState<string[]>(ignored)
  const pending = workouts
    .filter((w) => w.date >= shiftDate(today, -14) && !hidden.includes(w.id) && missingInfo(w).length > 0)
    .slice()
    .reverse()
  if (pending.length === 0) return null

  function hide(id: string) {
    const next = [...hidden, id].slice(-50)
    setHidden(next)
    writeScoped(localStorage, KEY, JSON.stringify(next))
  }

  return (
    <section className="space-y-2" aria-label="Falta informação">
      <p className="label">Falta informação</p>
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
