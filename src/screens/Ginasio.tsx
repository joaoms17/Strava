import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { emitDataChanged } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import { nutritionalDay } from '../lib/day'
import { fmtDayShort } from '../lib/format'
import { lisbonInstant } from '../../api/_lib/rules/momentos'
import { exerciseKey, sameExercise } from '../../api/_lib/rules/exercicios'
import {
  FREE_REP_MAX,
  FREE_REP_MIN,
  loadStep,
  loadStepDown,
  setsSummary,
  suggestExercise,
  type ExerciseSuggestion,
  type LoggedSet,
} from '../../api/_lib/rules/progressao-forca'
import type { ExerciseLogRow, Favorite, TemplateExercise, Workout } from '../lib/types'
import ExercisePicker from '../components/ExercisePicker'
import Icon from '../components/ui/Icon'
import { readScoped, writeScoped } from '../lib/scoped'
import { kcalOfWorkout } from '../lib/workout-actions'
import { workoutKcal } from '../../api/_lib/rules/targets'

interface DraftSet {
  reps: number
  load: number | null
  done: boolean
}
interface DraftExercise {
  name: string
  sets: DraftSet[]
  rpe: number | null
  repMax?: number // o topo das repetições no teu treino (sobe a carga aí)
}
interface Draft {
  startedAt: number
  favoriteId: string | null
  exercises: DraftExercise[]
  day?: string | null // um dia passado (do ＋ nesse dia): sem cronómetro
  minutes?: number | null // a duração escrita; sem ela, o cronómetro
}

const MAX_MINUTES = 600
const MAX_REPS = 600

const DRAFT_KEY = 'regresso.ginasio'
const DRAFT_MAX_AGE_MS = 6 * 3600_000

function readDraft(): Draft | null {
  try {
    const raw = readScoped(localStorage, DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Draft
    return Date.now() - draft.startedAt < DRAFT_MAX_AGE_MS ? draft : null
  } catch {
    return null
  }
}
function writeDraft(draft: Draft | null) {
  // Sem armazenamento local, o rascunho vive só neste ecrã.
  writeScoped(localStorage, DRAFT_KEY, draft ? JSON.stringify(draft) : null)
}

// Sessão de ginásio livre: séries de 8 a 12 repetições (ou as do teu treino)
// com as cargas da última vez já preenchidas. ?fav= começa de um dos teus
// treinos; ?id= edita uma sessão antiga; ?data= regista num dia passado.
export default function Ginasio() {
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const editId = params.get('id')
  const favParam = params.get('fav')
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const dataParam = params.get('data')
  const pastDay = dataParam && /^\d{4}-\d{2}-\d{2}$/.test(dataParam) && dataParam < today ? dataParam : null
  const toast = useToast()
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [history, setHistory] = useState<Record<string, LoggedSet[][]>>({})
  const [editing, setEditing] = useState<Workout | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picking, setPicking] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [favName, setFavName] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const clientId = useRef(crypto.randomUUID())

  // Cronómetro.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    void (async () => {
      const [{ data: favs }, { data: logs }, { data: strengthWorkouts }] = await Promise.all([
        supabase
          .from('favorites')
          .select('*')
          .eq('kind', 'workout')
          .eq('archived', false)
          .order('use_count', { ascending: false }),
        supabase
          .from('exercise_log')
          .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
          .order('created_at', { ascending: false })
          .limit(600),
        supabase.from('workouts_active').select('id,date').eq('type', 'strength'),
      ])
      const strengthFavs = ((favs ?? []) as Favorite[]).filter((f) => f.workout?.type === 'strength')
      setFavorites(strengthFavs)

      // Séries por exercício e por sessão, por ordem de data (sem a sessão a editar).
      const dates = new Map(((strengthWorkouts ?? []) as { id: string; date: string }[]).map((w) => [w.id, w.date]))
      const perExercise = new Map<string, Map<string, LoggedSet[]>>()
      // Pelo nome sem acentos nem maiúsculas: «Supino plano com barra» dito ou
      // escolhido é o mesmo.
      for (const row of ((logs ?? []) as ExerciseLogRow[]).slice().reverse()) {
        if (row.workout_id === editId || !dates.has(row.workout_id)) continue
        const key = exerciseKey(row.exercise)
        const bySession = perExercise.get(key) ?? new Map<string, LoggedSet[]>()
        const sets = bySession.get(row.workout_id) ?? []
        sets.push({ reps: row.reps, load_kg: row.load_kg != null ? Number(row.load_kg) : null, rpe: row.rpe })
        bySession.set(row.workout_id, sets)
        perExercise.set(key, bySession)
      }
      const hist: Record<string, LoggedSet[][]> = {}
      for (const [exercise, bySession] of perExercise) {
        hist[exercise] = [...bySession.entries()]
          .sort(([a], [b]) => (dates.get(a) ?? '').localeCompare(dates.get(b) ?? ''))
          .map(([, sets]) => sets)
      }
      setHistory(hist)

      if (editId) {
        const [{ data: w }, { data: sets }] = await Promise.all([
          supabase.from('workouts').select('*').eq('id', editId).maybeSingle(),
          supabase.from('exercise_log').select('*').eq('workout_id', editId).order('set_index'),
        ])
        const workout = (w ?? null) as Workout | null
        setEditing(workout)
        // Sessão sem séries (veio do relógio): começa com o teu treino.
        const template = strengthFavs.find((f) => f.id === (favParam ?? workout?.favorite_id))
        const repMaxOf = (name: string) => template?.workout?.exercises?.find((e) => sameExercise(e.name, name))?.rep_max
        const byName = new Map<string, DraftExercise>()
        for (const s of (sets ?? []) as ExerciseLogRow[]) {
          const ex = byName.get(s.exercise) ?? { name: s.exercise, sets: [], rpe: s.rpe, repMax: repMaxOf(s.exercise) }
          ex.sets.push({ reps: s.reps ?? 0, load: s.load_kg != null ? Number(s.load_kg) : null, done: true })
          byName.set(s.exercise, ex)
        }
        setDraft({
          startedAt: Date.parse(workout?.started_at ?? workout?.created_at ?? new Date().toISOString()),
          favoriteId: template?.id ?? workout?.favorite_id ?? null,
          minutes: workout?.minutes ?? null,
          exercises:
            byName.size > 0 || !template
              ? [...byName.values()]
              : (template.workout?.exercises ?? []).map((e) => newExercise(e, hist[exerciseKey(e.name)] ?? [])),
        })
        return
      }
      const saved = readDraft()
      if (saved && !favParam) {
        setDraft(saved)
        return
      }
      const fav = strengthFavs.find((f) => f.id === favParam)
      setDraft({
        startedAt: Date.now(),
        favoriteId: fav?.id ?? null,
        exercises: fav ? (fav.workout?.exercises ?? []).map((e) => newExercise(e, hist[exerciseKey(e.name)] ?? [])) : [],
        // Num dia passado não há cronómetro: a duração do teu treino.
        ...(pastDay ? { day: pastDay, minutes: fav?.workout?.minutes ?? 60 } : {}),
      })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, favParam, pastDay])

  // Guarda o rascunho a cada mudança (só sessões novas).
  useEffect(() => {
    if (draft && !editId && !savedId) writeDraft(draft)
  }, [draft, editId, savedId])

  const suggestions = useMemo(() => {
    const out: Record<string, ExerciseSuggestion> = {}
    for (const ex of draft?.exercises ?? []) {
      out[ex.name] = suggestExercise(history[exerciseKey(ex.name)] ?? [], ex.repMax ?? FREE_REP_MAX)
    }
    return out
  }, [draft?.exercises, history])

  if (!draft) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  const d = draft
  const setExercises = (exercises: DraftExercise[]) => setDraft({ ...d, exercises })
  const updateSet = (ei: number, si: number, patch: Partial<DraftSet>) =>
    setExercises(
      d.exercises.map((ex, i) =>
        i === ei ? { ...ex, sets: ex.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : ex,
      ),
    )
  // «✓ Todas»: as séries que faltam deste exercício ficam feitas com o que se
  // vê (as de 0 repetições ficam como estão).
  const markAll = (ei: number) =>
    setExercises(
      d.exercises.map((ex, i) => (i === ei ? { ...ex, sets: ex.sets.map((s) => (s.reps > 0 ? { ...s, done: true } : s)) } : ex)),
    )
  // A duração escrita; sem ela, a guardada (ao corrigir) ou o cronómetro.
  const timerMinutes = Math.max(1, Math.round((now - d.startedAt) / 60_000))
  const minutes = Math.max(1, Math.min(MAX_MINUTES, d.minutes ?? editing?.minutes ?? (d.day ? 60 : timerMinutes)))
  const doneSets = d.exercises.reduce((a, ex) => a + ex.sets.filter((s) => s.done).length, 0)

  function startFrom(fav: Favorite) {
    setDraft({
      ...d,
      startedAt: Date.now(),
      favoriteId: fav.id,
      exercises: (fav.workout?.exercises ?? []).map((e) => newExercise(e, history[exerciseKey(e.name)] ?? [])),
      ...(d.day ? { minutes: fav.workout?.minutes ?? d.minutes ?? 60 } : {}),
    })
  }

  // Recomeçar e tirar um exercício com séries feitas: com Anular.
  function restart() {
    const before = d
    writeDraft(null)
    setDraft({ startedAt: Date.now(), favoriteId: null, exercises: [], ...(d.day ? { day: d.day, minutes: 60 } : {}) })
    toast('Sessão recomeçada.', [
      {
        label: 'Anular',
        run: () => {
          writeDraft(before)
          setDraft(before)
        },
      },
    ])
  }
  function removeExercise(index: number) {
    const removed = d.exercises[index]!
    setExercises(d.exercises.filter((_, i) => i !== index))
    if (!removed.sets.some((s) => s.done)) return
    toast(`Tirei ${removed.name}.`, [
      {
        label: 'Anular',
        run: () =>
          setDraft((current) =>
            current
              ? { ...current, exercises: [...current.exercises.slice(0, index), removed, ...current.exercises.slice(index)] }
              : current,
          ),
      },
    ])
  }

  async function finish() {
    const sets = d.exercises.flatMap((ex) =>
      ex.sets
        .filter((s) => s.done)
        .map((s, i) => ({ exercise: ex.name, set_index: i + 1, reps: s.reps, load_kg: s.load, rpe: ex.rpe })),
    )
    try {
      const { workout } = await postApi<{ workout: Workout }>('/api/workout/strength', {
        client_id: clientId.current,
        workout_id: editId,
        // Num dia passado, as 18:00 (hora suposta).
        started_at: editId ? undefined : d.day ? lisbonInstant(d.day, '18:00').toISOString() : new Date(d.startedAt).toISOString(),
        started_at_estimated: !editId && !!d.day,
        minutes,
        sets,
        favorite_id: d.favoriteId,
      })
      writeDraft(null)
      emitDataChanged()
      setSavedId(workout.id)
      toast(
        editId
          ? 'Sessão corrigida.'
          : `Ginásio registado · ${sets.length} séries${kcalOfWorkout(workout)}`,
      )
      // De um dos teus treinos ou a corrigir, o «Feito» não tem mais nada
      // (o aviso já diz as séries): volta logo ao Treino. Numa sessão livre
      // fica, para a guardar nos teus treinos.
      if (editId || d.favoriteId) navigate('/treino')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar. Tenta outra vez.')
    }
  }

  async function saveAsFavorite() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const name = favName?.trim()
    if (!name) return
    const { error } = await supabase.from('favorites').insert({
      user_id: user.id,
      kind: 'workout',
      name,
      // Sem relógio, pelos minutos (a lista dos teus treinos mostra o ritmo de agora).
      kcal: workoutKcal({ type: 'strength', minutes, watts: null, deviceCalories: null }),
      workout: {
        type: 'strength',
        minutes,
        exercises: d.exercises.map((ex) => ({
          name: ex.name,
          sets: Math.max(1, ex.sets.filter((s) => s.done).length),
          rep_min: FREE_REP_MIN,
          rep_max: FREE_REP_MAX,
        })),
      },
    })
    toast(error ? 'Não consegui guardar o treino.' : `Guardado nos teus treinos · ${name}`)
    if (!error) {
      setFavName(null)
      emitDataChanged()
    }
  }

  if (savedId) {
    return (
      <div className="space-y-4 pt-4 text-center">
        <p className="num text-[40px] leading-none font-extrabold text-burn">Feito</p>
        <p className="text-[15px] text-dim">
          {doneSets} séries · {minutes} min
        </p>
        {!editId && !d.favoriteId && favName == null && (
          <button onClick={() => setFavName('')} className="min-h-12 w-full rounded-xl border border-line text-[15px]">
            ☆ Guardar nos meus treinos
          </button>
        )}
        {favName != null && (
          <div className="flex gap-2">
            <input
              autoFocus
              value={favName}
              onChange={(e) => setFavName(e.target.value)}
              placeholder="Nome, ex.: Pernas C"
              aria-label="Nome do treino"
              className="h-12 flex-1 rounded-xl border border-line bg-bg px-3 text-[17px]"
            />
            <BusyButton
              busy="A guardar…"
              disabled={!favName.trim()}
              onClick={saveAsFavorite}
              className="min-h-12 rounded-xl bg-cta px-4 font-semibold text-on-cta disabled:opacity-40"
            >
              Guardar
            </BusyButton>
          </div>
        )}
        <button
          onClick={() => navigate('/treino')}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase"
        >
          Voltar ao Treino
        </button>
      </div>
    )
  }

  const used = new Set(d.exercises.map((e) => e.name))
  const step = 'flex h-10 w-10 items-center justify-center rounded-lg border border-line text-[20px] leading-none'

  return (
    <div className="space-y-4 pt-1 pb-24">
      <div className="flex items-center justify-between">
        <p className="num text-[28px]">
          {minutes} min <span className="text-[16px] font-semibold text-dim">· {doneSets} séries</span>
          {d.day && <span className="block text-[15px] font-semibold text-dim">Em {fmtDayShort(d.day)}</span>}
        </p>
        {!editId && d.exercises.length > 0 && (
          <button onClick={restart} className="-mr-3 min-h-11 px-3 text-[14px] text-dim">
            Recomeçar
          </button>
        )}
      </div>

      {d.exercises.length === 0 && (
        <div className="space-y-3">
          {favorites.length > 0 && <p className="label">Começar de um dos teus treinos</p>}
          {favorites.map((f) => (
            <button
              key={f.id}
              onClick={() => startFrom(f)}
              className="flex min-h-16 w-full items-center gap-3 rounded-[18px] bg-burn px-4 text-left text-bg"
            >
              <Icon name="dumbbell" size={26} />
              <span className="flex-1">
                <span className="block font-display text-[22px] leading-none font-extrabold uppercase">{f.name}</span>
                <span className="text-[14px] font-semibold">{f.workout?.exercises?.map((e) => e.name).join(' · ')}</span>
              </span>
            </button>
          ))}
          <p className="text-[15px] text-dim">
            Ou escolhe o primeiro exercício.
          </p>
        </div>
      )}

      {d.exercises.map((ex, ei) => {
        const sug = suggestions[ex.name]
        return (
          <section key={ex.name} className="space-y-2 rounded-[18px] border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[17px] font-semibold">{ex.name}</p>
                <p className="text-[14px] text-dim">
                  {sug?.firstTime
                    ? `Primeira vez: escolhe um peso com que faças ${ex.repMax ?? FREE_REP_MAX} repetições com folga.`
                    : `Última: ${setsSummary(sug?.lastSets ?? [])}`}
                  {sug?.today != null && (
                    <span className={sug.ready ? 'font-semibold text-burn' : ''}> · Hoje: {String(sug.today).replace('.', ',')} kg</span>
                  )}
                </p>
              </div>
              <div className="-mt-1 -mr-2 flex shrink-0 items-center">
                {ex.sets.some((s) => !s.done && s.reps > 0) && (
                  <button
                    onClick={() => markAll(ei)}
                    className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-[14px] font-semibold text-burn"
                    aria-label={`Marcar as séries de ${ex.name} como feitas`}
                  >
                    <Icon name="check" size={16} /> Todas
                  </button>
                )}
                <button
                  onClick={() => removeExercise(ei)}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-dim"
                  aria-label={`Tirar ${ex.name}`}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>
            {ex.sets.map((s, si) => (
              <div key={si} className="flex items-center gap-2">
                <button
                  onClick={() => updateSet(ei, si, { done: !s.done })}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                    s.done ? 'border-burn bg-burn text-bg' : 'border-line text-dim'
                  }`}
                  aria-label={`Série ${si + 1} feita`}
                  aria-pressed={s.done}
                >
                  <Icon name="check" size={20} />
                </button>
                <div className="flex items-center gap-1">
                  <button className={step} onClick={() => updateSet(ei, si, { reps: Math.max(0, s.reps - 1) })} aria-label="menos uma repetição">
                    −
                  </button>
                  <span className="num w-9 text-center text-[20px]">{s.reps}</span>
                  <button
                    className={step}
                    onClick={() => updateSet(ei, si, { reps: Math.min(MAX_REPS, s.reps + 1) })}
                    aria-label="mais uma repetição"
                  >
                    +
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className={step}
                    onClick={() => updateSet(ei, si, { load: Math.max(0, (s.load ?? 0) - loadStepDown(s.load ?? 0)) })}
                    aria-label={`menos ${loadStepDown(s.load ?? 0)} kg`}
                  >
                    −
                  </button>
                  <input
                    inputMode="decimal"
                    value={s.load == null ? '' : String(s.load).replace('.', ',')}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(',', '.'))
                      updateSet(ei, si, { load: e.target.value === '' || !Number.isFinite(v) ? null : v })
                    }}
                    placeholder="kg"
                    aria-label={`Carga da série ${si + 1}`}
                    className="num h-10 w-14 rounded-lg border border-line bg-bg text-center text-[18px]"
                  />
                  <button
                    className={step}
                    onClick={() => updateSet(ei, si, { load: (s.load ?? 0) + loadStep(s.load ?? 0) })}
                    aria-label={`mais ${loadStep(s.load ?? 0)} kg`}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  const last = ex.sets[ex.sets.length - 1]
                  setExercises(
                    d.exercises.map((e, i) =>
                      i === ei ? { ...e, sets: [...e.sets, { reps: last?.reps ?? 10, load: last?.load ?? null, done: false }] } : e,
                    ),
                  )
                }}
                className="-ml-2 min-h-11 px-2 text-[15px] text-dim"
              >
                + série
              </button>
              <label className="flex items-center gap-2 text-[14px] text-dim">
                Esforço
                <select
                  value={ex.rpe ?? ''}
                  onChange={(e) =>
                    setExercises(d.exercises.map((x, i) => (i === ei ? { ...x, rpe: e.target.value ? Number(e.target.value) : null } : x)))
                  }
                  className="h-9 rounded-lg border border-line bg-bg px-2 text-ink"
                >
                  <option value="">—</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )
      })}

      {picking ? (
        <ExercisePicker
          exclude={[...used]}
          onPick={(name) => {
            setExercises([
              ...d.exercises,
              newExercise({ name, sets: 3, rep_min: FREE_REP_MIN, rep_max: FREE_REP_MAX }, history[exerciseKey(name)] ?? []),
            ])
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : (
        <button
          onClick={() => setPicking(true)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[15px]"
        >
          <Icon name="plus" size={18} /> Exercício
        </button>
      )}

      {d.exercises.length > 0 && (
        <label className="flex items-center gap-3 text-[15px] text-dim">
          Duração
          <input
            inputMode="numeric"
            value={d.minutes != null ? String(d.minutes) : ''}
            placeholder={String(minutes)}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '')
              setDraft({ ...d, minutes: v ? Math.min(MAX_MINUTES, Number(v)) : null })
            }}
            aria-label="Duração em minutos"
            className="num h-11 w-20 rounded-xl border border-line bg-bg px-3 text-center text-[18px] text-ink placeholder:text-dim"
          />
          min
          {d.minutes == null && !d.day && !editId && <span className="text-[13px]">(pelo cronómetro; muda se te esqueceste de terminar)</span>}
        </label>
      )}

      {d.exercises.length > 0 && (
        <BusyButton
          busy="A guardar…"
          disabled={doneSets === 0}
          onClick={finish}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          {editId ? 'Guardar correções' : 'Terminar'}
        </BusyButton>
      )}
    </div>
  )
}

// Um exercício novo na sessão: as séries e cargas da última vez; sem
// histórico, as do teu treino (repetições mínimas e carga, se tiver).
function newExercise(template: TemplateExercise, history: LoggedSet[][]): DraftExercise {
  const repMax = template.rep_max > 0 ? template.rep_max : FREE_REP_MAX
  const sug = suggestExercise(history, repMax)
  const count = Math.max(template.sets, sug.lastSets.length || template.sets)
  return {
    name: template.name,
    rpe: null,
    repMax,
    sets: Array.from({ length: count }, (_, i) => {
      const last = sug.lastSets[i] ?? sug.lastSets[sug.lastSets.length - 1]
      return {
        reps: last?.reps ?? template.rep_min ?? 10,
        load: sug.today ?? last?.load_kg ?? template.load_kg ?? null,
        done: false,
      }
    }),
  }
}
