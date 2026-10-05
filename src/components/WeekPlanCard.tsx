import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import Icon from './ui/Icon'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { useProfile, useReadyProfile } from '../lib/profile'
import { nutritionalDay, shiftDate } from '../lib/day'
import { weekdayShort } from '../lib/format'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import {
  BIKE_KIND_LABEL,
  GYM_FOCUS_LABEL,
  MAX_SESSIONS,
  cleanPlan,
  cleanPrefs,
  planProgress,
  weekNumber,
  type WeekPlan,
} from '../../api/_lib/rules/plano'
import type { Workout } from '../lib/types'

type Block = { id: string; start_date: string; plan: unknown; created_at: string }

// Treino › Esta semana: o plano da IA (bicicleta e ginásio), feito a partir
// dos dados do relógio. Os treinos da semana vão riscando as sessões.
export default function WeekPlanCard({ workouts }: { workouts: Workout[] }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const sheet = useSheet()
  const toast = useToast()
  const [, navigate] = useLocation()
  const prefs = cleanPrefs(profile.goals?.plano)
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const monday = mondayOf(today)
  const [block, setBlock] = useState<Block | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [counts, setCounts] = useState({ bicicleta: prefs?.bicicleta ?? 3, ginasio: prefs?.ginasio ?? 3 })
  const [confirmRedo, setConfirmRedo] = useState(false)
  const asked = useRef(false)

  async function generate(refazer = false) {
    setBusy(true)
    setError(null)
    try {
      const { block: saved } = await postApi<{ block: Block }>('/api/workout/plan-week', { refazer })
      setBlock(saved)
      if (refazer) toast('Semana refeita.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui preparar a semana.')
    } finally {
      setBusy(false)
      setConfirmRedo(false)
    }
  }

  useEffect(() => {
    if (!prefs?.ativo) return
    let alive = true
    void supabase
      .from('plan_blocks')
      .select('id,start_date,plan,created_at')
      .eq('start_date', monday)
      .eq('weeks', 1)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!alive) return
        const found = (data?.[0] ?? null) as Block | null
        setBlock(found)
        // Semana nova sem plano: prepara-o sozinho (uma vez).
        if (!found && !asked.current) {
          asked.current = true
          void generate(false)
        }
      })
    return () => {
      alive = false
    }
  }, [prefs?.ativo, monday])

  async function savePrefs(ativo: boolean) {
    const ok = await update({
      goals: {
        ...(profile.goals ?? {}),
        plano: { ativo, bicicleta: counts.bicicleta, ginasio: counts.ginasio, inicio: prefs?.inicio ?? monday },
      },
    })
    if (!ok) {
      toast('Não consegui guardar.')
      return
    }
    setEditing(false)
    if (ativo && block) {
      // Mudou o número de sessões: a semana refaz-se com o novo número.
      void generate(true)
    }
  }

  const stepper = (key: 'bicicleta' | 'ginasio', label: string) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[16px]">{label}</span>
      <span className="flex items-center gap-2">
        <button
          onClick={() => setCounts({ ...counts, [key]: Math.max(0, counts[key] - 1) })}
          aria-label={`Menos ${label}`}
          className="h-10 w-10 rounded-xl border border-line text-[20px]"
        >
          −
        </button>
        <span className="num w-8 text-center text-[24px]" aria-label={`${label}: ${counts[key]} por semana`}>
          {counts[key]}
        </span>
        <button
          onClick={() => setCounts({ ...counts, [key]: Math.min(MAX_SESSIONS, counts[key] + 1) })}
          aria-label={`Mais ${label}`}
          className="h-10 w-10 rounded-xl border border-line text-[20px]"
        >
          +
        </button>
      </span>
    </div>
  )

  const card = 'space-y-3 rounded-[18px] border border-line bg-surface p-4'
  const heading = 'font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase'

  if (!prefs?.ativo || editing) {
    return (
      <section className={card} aria-label="Plano semanal">
        <p className={heading}>Plano semanal com IA</p>
        <p className="text-[15px] text-dim">
          Diz quantas sessões fazes por semana. A IA planeia a semana (tipos de bicicleta com alvos e o foco de cada
          ginásio) com os dados do relógio, começa do zero e vai subindo.
        </p>
        {stepper('bicicleta', 'Bicicleta')}
        {stepper('ginasio', 'Ginásio')}
        <div className="flex gap-2">
          <button
            disabled={counts.bicicleta + counts.ginasio === 0}
            onClick={() => void savePrefs(true)}
            className="min-h-12 flex-1 rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-40"
          >
            {prefs?.ativo ? 'Guardar' : 'Começar o plano'}
          </button>
          {prefs?.ativo && (
            <button onClick={() => void savePrefs(false)} className="min-h-12 rounded-xl border border-line px-3 text-[15px] text-dim">
              Desligar
            </button>
          )}
        </div>
        {editing && (
          <button onClick={() => setEditing(false)} className="text-[14px] text-dim">
            Cancelar
          </button>
        )}
      </section>
    )
  }

  const week = weekNumber(prefs.inicio, monday)
  const plan: WeekPlan | null = block ? cleanPlan(block.plan, { bicicleta: 7, ginasio: 7 }, week) : null
  const weekWorkouts = workouts.filter((w) => w.date >= monday && w.date <= shiftDate(monday, 6))
  const progress = plan ? planProgress(plan, weekWorkouts) : null

  if (!plan) {
    return (
      <section className={card} aria-label="Plano semanal">
        <p className={heading}>Esta semana · semana {week}</p>
        {error ? (
          <>
            <p className="text-[15px] text-pain">{error}</p>
            <button onClick={() => void generate(false)} className="min-h-11 rounded-xl border border-line px-4 text-[15px]">
              Tentar outra vez
            </button>
          </>
        ) : (
          <p className="text-[15px] text-dim">{busy || block === undefined ? 'A preparar a tua semana…' : 'Sem plano.'}</p>
        )}
      </section>
    )
  }

  const doneBike = progress!.bike.filter(Boolean).length
  const doneGym = progress!.gym.filter(Boolean).length
  // Feito: mostra os minutos que se fizeram, não os planeados.
  const row = (id: string, done: Workout | null, title: string, minutes: number, sub: string, details: ReactNode) => (
    <li key={id} className="border-t border-line/60 first:border-t-0">
      <button onClick={() => setOpen(open === id ? null : id)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? 'bg-ok text-bg' : 'border border-line'}`}
          aria-label={done ? 'feito' : 'por fazer'}
        >
          {done && <Icon name="check" size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] font-semibold ${done ? 'text-dim' : ''}`}>{title}</span>
          <span className="block truncate text-[13px] text-dim">
            {done ? `Feito ${weekdayShort(done.date)} · ${done.minutes ?? minutes} min` : `${minutes} min`} · {sub}
          </span>
        </span>
        <Icon name="chevron" size={18} className={`shrink-0 text-dim transition-transform ${open === id ? 'rotate-90' : ''}`} />
      </button>
      {open === id && <div className="space-y-2 pb-3 pl-11 text-[14px]">{details}</div>}
    </li>
  )

  return (
    <section className={card} aria-label="Plano semanal">
      <div className="flex items-baseline justify-between gap-2">
        <p className={heading}>
          Esta semana · {plan.fase} · semana {plan.semana}
        </p>
        <span className="shrink-0 text-[13px] text-dim tabular-nums">
          {doneBike + doneGym}/{plan.bicicleta.length + plan.ginasio.length}
        </span>
      </div>
      {plan.resumo && <p className="text-[15px]">{plan.resumo}</p>}
      {plan.evolucao && <p className="text-[14px] text-dim">{plan.evolucao}</p>}

      {plan.bicicleta.length > 0 && (
        <div>
          <p className="label">
            Bicicleta · {doneBike}/{plan.bicicleta.length}
          </p>
          <ul>
            {plan.bicicleta.map((b, i) =>
              row(
                `b${i}`,
                progress!.bike[i] ?? null,
                b.titulo,
                b.minutos,
                `${BIKE_KIND_LABEL[b.tipo]}${b.alvo ? ` · ${b.alvo}` : ''}`,
                <>
                  {b.estrutura && <p>{b.estrutura}</p>}
                  {b.alvo && <p className="text-dim">Alvo: {b.alvo}</p>}
                  {b.porque && <p className="text-dim">{b.porque}</p>}
                  {!progress!.bike[i] && (
                    <button
                      onClick={() => sheet.open('ja-fiz', { minutos: String(b.minutos) })}
                      className="min-h-10 rounded-xl border border-line px-3 text-[15px]"
                    >
                      Já fiz esta
                    </button>
                  )}
                </>,
              ),
            )}
          </ul>
        </div>
      )}

      {plan.ginasio.length > 0 && (
        <div>
          <p className="label">
            Ginásio · {doneGym}/{plan.ginasio.length}
          </p>
          <ul>
            {plan.ginasio.map((g, i) =>
              row(
                `g${i}`,
                progress!.gym[i] ?? null,
                g.titulo,
                g.minutos,
                GYM_FOCUS_LABEL[g.foco],
                <>
                  {g.nota && <p>{g.nota}</p>}
                  {!progress!.gym[i] && (
                    <button
                      onClick={() => navigate('/treino/ginasio')}
                      className="min-h-10 rounded-xl border border-line px-3 text-[15px]"
                    >
                      Começar no ginásio
                    </button>
                  )}
                </>,
              ),
            )}
          </ul>
        </div>
      )}

      <p className="text-[13px] text-dim">
        Os treinos do relógio e os que registas aqui riscam as sessões. A próxima semana prepara-se na segunda-feira.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
        {confirmRedo ? (
          <>
            <button disabled={busy} onClick={() => void generate(true)} className="min-h-10 text-eat">
              {busy ? 'A refazer…' : 'Sim, refazer'}
            </button>
            <button onClick={() => setConfirmRedo(false)} className="min-h-10 text-dim">
              Não
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmRedo(true)} className="min-h-10 text-eat">
            Refazer a semana
          </button>
        )}
        <button
          onClick={() => {
            setCounts({ bicicleta: prefs.bicicleta, ginasio: prefs.ginasio })
            setEditing(true)
          }}
          className="min-h-10 text-dim"
        >
          Mudar o plano ({prefs.bicicleta} bicicleta · {prefs.ginasio} ginásio)
        </button>
      </div>
      {error && <p className="text-[14px] text-pain">{error}</p>}
    </section>
  )
}
