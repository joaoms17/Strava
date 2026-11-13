import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { runBusy } from '../lib/busy'
import { useToast } from '../lib/toast'
import { emitDataChanged, useDataVersion } from '../lib/events'
import { shiftDate } from '../lib/day'
import { fmtDayShort, timeOf } from '../lib/format'
import { kcalOfWorkout, workoutTitle } from '../lib/workout-actions'
import { ensurePlanFavorite, usePlanoTreino } from '../lib/plano-treino'
import {
  QUAL_FOI_DAYS,
  askWhichWorkout,
  dayLabel,
  qualFoiPatch,
  qualFoiUndo,
  type QualFoiChoice,
} from '../../api/_lib/rules/plano-treino'
import { OTHER_SPORTS, SPORT_LABEL, type OtherSport } from '../../api/_lib/rules/targets'
import type { Workout } from '../lib/types'
import { WORKOUT_LIST_COLUMNS, fromListRows } from '../lib/treino-lista'
import { chip } from './ui/Chips'
import Icon from './ui/Icon'
import { dayTone } from './plano/PlanoViews'

// «Qual foi?» (decisão 306): um treino que chegou sozinho (o relógio, um
// print) e ainda não é um dos teus responde-se num toque — o dia do plano,
// Bicicleta ou Outro —, com Anular. Só para quem tem plano de treino (o
// João); sem plano fica o de sempre (a folha do treino pergunta).
export function QualFoiQuestion({ workout: w, onDone }: { workout: Workout; onDone?: () => void }) {
  const plan = usePlanoTreino()
  const toast = useToast()
  const [, navigate] = useLocation()
  const [other, setOther] = useState(false)
  if (!plan) return null

  const when = `${fmtDayShort(w.date)}${w.started_at && !w.raw?.hora_estimada ? `, ${timeOf(w.started_at)}` : ''}`

  function answer(choice: QualFoiChoice | { kind: 'dia-plano'; n: number }) {
    void runBusy('A guardar…', async () => {
      try {
        let real: QualFoiChoice
        let label: string
        if (choice.kind === 'dia-plano') {
          const day = plan!.dias.find((d) => d.n === choice.n)!
          real = { kind: 'dia', n: day.n, favoriteId: await ensurePlanFavorite(day) }
          label = dayLabel(day)
        } else {
          real = choice
          label = choice.kind === 'bike' ? 'Bicicleta' : SPORT_LABEL[choice.kind === 'outro' ? choice.sport : 'outro']
        }
        const { workout } = await postApi<{ workout: Workout }>('/api/workout/update', {
          workout_id: w.id,
          ...qualFoiPatch(w, real),
        })
        emitDataChanged()
        onDone?.()
        toast(`${workoutTitle(w)} de ${when}: ${label}${kcalOfWorkout(workout)}`, [
          {
            label: 'Anular',
            // Uma falha no Anular diz-se (antes ficava em silêncio — T24).
            run: async () => {
              try {
                await postApi('/api/workout/update', { workout_id: w.id, ...qualFoiUndo(w) })
                emitDataChanged()
                onDone?.()
                toast('Anulado.')
              } catch (err) {
                toast(err instanceof Error ? `Não anulei: ${err.message}` : 'Não consegui anular. Tenta outra vez.')
              }
            },
          },
          ...(real.kind === 'dia'
            ? [{ label: 'Registar as séries', run: () => navigate(`/treino/ginasio?id=${w.id}&fav=${real.kind === 'dia' ? real.favoriteId : ''}`) }]
            : []),
        ])
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2">
        {plan.dias.map((d) => {
          const tone = dayTone(d.n)
          return (
            <button
              key={d.n}
              onClick={() => answer({ kind: 'dia-plano', n: d.n })}
              className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-bg px-3 text-left text-[16px] font-semibold"
            >
              <span className={`num w-5 text-center text-[22px] ${tone.text}`}>{d.n}</span>
              <span className="min-w-0 flex-1 truncate">{dayLabel(d, true)}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => answer({ kind: 'bike' })} className={chip(false, 'cta')}>
          Bicicleta
        </button>
        <button onClick={() => setOther(!other)} className={chip(other, 'cta')} aria-expanded={other}>
          Outro
        </button>
      </div>
      {other && (
        <div className="flex flex-wrap gap-2" aria-label="Que desporto foi?">
          {OTHER_SPORTS.map((s: OtherSport) => (
            <button key={s} onClick={() => answer({ kind: 'outro', sport: s })} className={chip(false, 'cta')}>
              {SPORT_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// No Hoje e no Treino: os treinos dos últimos 7 dias que chegaram sozinhos e
// ainda não têm resposta, o mais recente primeiro (até 3; no Hoje, 1).
// O Hoje escolhe um só cartão de ação (H9): `onCount` diz-lhe quantos há e
// `hidden` mantém a contagem sem mostrar nada.
// `workouts`: os treinos que o ecrã já leu (o Treino lê 12 semanas); com eles
// não se faz outra consulta (P5). Sem eles (o Hoje), lê só os últimos 7 dias.
export default function QualFoi({
  today,
  max = 3,
  hidden = false,
  onCount,
  workouts: given,
}: {
  today: string
  max?: number
  hidden?: boolean
  onCount?: (count: number) => void
  workouts?: Workout[]
}) {
  const plan = usePlanoTreino()
  const version = useDataVersion()
  const [fetched, setFetched] = useState<Workout[]>([])

  const load = useCallback(async () => {
    if (given) return
    const { data } = await supabase
      .from('workouts_active')
      .select(WORKOUT_LIST_COLUMNS)
      .gte('date', shiftDate(today, -(QUAL_FOI_DAYS - 1)))
      .in('type', ['strength', 'other'])
      .is('favorite_id', null)
      .order('date', { ascending: false })
    setFetched(fromListRows(data))
  }, [today, !given])

  useEffect(() => {
    if (plan) void load()
  }, [load, version, !!plan])

  const workouts = given ?? fetched
  const all = plan ? askWhichWorkout(workouts, today) : []
  const count = all.length
  useEffect(() => {
    onCount?.(count)
  }, [count, onCount])

  if (!plan || hidden) return null
  const ask = all.slice(0, max)
  if (ask.length === 0) return null

  return (
    <section className="space-y-3" aria-label="Qual foi?">
      {ask.map((w) => (
        <div key={w.id} className="space-y-3 rounded-[18px] border border-burn/60 bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface2 text-burn">
              <Icon name="watch" size={22} />
            </span>
            <p className="min-w-0 flex-1">
              <span className="block font-display text-[22px] leading-none font-extrabold uppercase">Qual foi?</span>
              <span className="mt-1 block text-[15px] text-dim">
                {workoutTitle(w)} de {w.date === today ? 'hoje' : fmtDayShort(w.date)}
                {w.started_at && !w.raw?.hora_estimada ? `, ${timeOf(w.started_at)}` : ''}
                {w.minutes != null ? ` · ${w.minutes} min` : ''}
                {kcalOfWorkout(w).replace(' kcal do treino', ' kcal')}
              </span>
            </p>
          </div>
          <QualFoiQuestion workout={w} onDone={() => void load()} />
        </div>
      ))}
    </section>
  )
}
