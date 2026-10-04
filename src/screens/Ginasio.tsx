import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { useToast } from '../lib/toast'
import { emitDataChanged } from '../lib/events'
import {
  FREE_REP_MAX,
  FREE_REP_MIN,
  LOAD_STEP_KG,
  setsSummary,
  suggestExercise,
  type ExerciseSuggestion,
  type LoggedSet,
} from '../../api/_lib/rules/progressao-forca'
import type { ExerciseLogRow, Favorite, TemplateExercise, Workout } from '../lib/types'
import ExercisePicker from '../components/ExercisePicker'
import Icon from '../components/ui/Icon'
import { readScoped, writeScoped } from '../lib/scoped'

interface DraftSet {
  reps: number
  load: number | null
  done: boolean
}
interface DraftExercise {
  name: string
  sets: DraftSet[]
  rpe: number | null
}
interface Draft {
  startedAt: number
  favoriteId: string | null
  exercises: DraftExercise[]
}

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

// Sessão de ginásio livre: séries de 8 a 12 repetições com as cargas da
// última vez já preenchidas. ?fav= começa de um favorito; ?id= edita uma
// sessão antiga.
export default function Ginasio() {
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const editId = params.get('id')
  const favParam = params.get('fav')
  const toast = useToast()
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [history, setHistory] = useState<Record<string, LoggedSet[][]>>({})
  const [editing, setEditing] = useState<Workout | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
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
      for (const row of ((logs ?? []) as ExerciseLogRow[]).slice().reverse()) {
        if (row.workout_id === editId || !dates.has(row.workout_id)) continue
        const bySession = perExercise.get(row.exercise) ?? new Map<string, LoggedSet[]>()
        const sets = bySession.get(row.workout_id) ?? []
        sets.push({ reps: row.reps, load_kg: row.load_kg != null ? Number(row.load_kg) : null, rpe: row.rpe })
        bySession.set(row.workout_id, sets)
        perExercise.set(row.exercise, bySession)
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
        const byName = new Map<string, DraftExercise>()
        for (const s of (sets ?? []) as ExerciseLogRow[]) {
          const ex = byName.get(s.exercise) ?? { name: s.exercise, sets: [], rpe: s.rpe }
          ex.sets.push({ reps: s.reps ?? 0, load: s.load_kg != null ? Number(s.load_kg) : null, done: true })
          byName.set(s.exercise, ex)
        }
        // Sessão sem séries (veio do relógio): começa com o teu treino.
        const template = strengthFavs.find((f) => f.id === (favParam ?? workout?.favorite_id))
        setDraft({
          startedAt: Date.parse(workout?.started_at ?? workout?.created_at ?? new Date().toISOString()),
          favoriteId: template?.id ?? workout?.favorite_id ?? null,
          exercises:
            byName.size > 0 || !template
              ? [...byName.values()]
              : (template.workout?.exercises ?? []).map((e) => newExercise(e, hist[e.name] ?? [])),
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
        exercises: fav ? (fav.workout?.exercises ?? []).map((e) => newExercise(e, hist[e.name] ?? [])) : [],
      })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, favParam])

  // Guarda o rascunho a cada mudança (só sessões novas).
  useEffect(() => {
    if (draft && !editId && !savedId) writeDraft(draft)
  }, [draft, editId, savedId])

  const suggestions = useMemo(() => {
    const out: Record<string, ExerciseSuggestion> = {}
    for (const ex of draft?.exercises ?? []) out[ex.name] = suggestExercise(history[ex.name] ?? [])
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
  const minutes = editing?.minutes ?? Math.max(1, Math.round((now - d.startedAt) / 60_000))
  const doneSets = d.exercises.reduce((a, ex) => a + ex.sets.filter((s) => s.done).length, 0)

  function startFrom(fav: Favorite) {
    setDraft({
      startedAt: Date.now(),
      favoriteId: fav.id,
      exercises: (fav.workout?.exercises ?? []).map((e) => newExercise(e, history[e.name] ?? [])),
    })
  }

  async function finish() {
    setBusy(true)
    const sets = d.exercises.flatMap((ex) =>
      ex.sets
        .filter((s) => s.done)
        .map((s, i) => ({ exercise: ex.name, set_index: i + 1, reps: s.reps, load_kg: s.load, rpe: ex.rpe })),
    )
    try {
      const { workout } = await postApi<{ workout: Workout }>('/api/workout/strength', {
        client_id: clientId.current,
        workout_id: editId,
        started_at: editId ? undefined : new Date(d.startedAt).toISOString(),
        minutes,
        sets,
        favorite_id: d.favoriteId,
      })
      writeDraft(null)
      emitDataChanged()
      setSavedId(workout.id)
      toast(editId ? 'Sessão corrigida.' : `Ginásio registado · ${sets.length} séries${workout.kcal_est ? ` · +${workout.kcal_est} no plano` : ''}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar. Tenta outra vez.')
    }
    setBusy(false)
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
      kcal: 150,
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
    toast(error ? 'Não consegui guardar o favorito.' : `Favorito guardado · ${name}`)
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
            ☆ Guardar como favorito
          </button>
        )}
        {favName != null && (
          <div className="flex gap-2">
            <input
              autoFocus
              value={favName}
              onChange={(e) => setFavName(e.target.value)}
              placeholder="Nome, ex.: Pernas C"
              aria-label="Nome do favorito"
              className="h-12 flex-1 rounded-xl border border-line bg-bg px-3 text-[17px]"
            />
            <button
              disabled={!favName.trim()}
              onClick={() => void saveAsFavorite()}
              className="min-h-12 rounded-xl bg-cta px-4 font-semibold text-on-cta disabled:opacity-40"
            >
              Guardar
            </button>
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
        </p>
        {!editId && d.exercises.length > 0 && (
          <button
            onClick={() => {
              writeDraft(null)
              setDraft({ startedAt: Date.now(), favoriteId: null, exercises: [] })
            }}
            className="text-[14px] text-dim"
          >
            Recomeçar
          </button>
        )}
      </div>

      {d.exercises.length === 0 && (
        <div className="space-y-3">
          {favorites.length > 0 && <p className="label">Começar de um favorito</p>}
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
              <div>
                <p className="text-[17px] font-semibold">{ex.name}</p>
                <p className="text-[14px] text-dim">
                  {sug?.firstTime
                    ? 'Primeira vez: escolhe um peso com que faças 12 repetições com folga.'
                    : `Última: ${setsSummary(sug?.lastSets ?? [])}`}
                  {sug?.today != null && (
                    <span className={sug.ready ? 'font-semibold text-burn' : ''}> · Hoje: {String(sug.today).replace('.', ',')} kg</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setExercises(d.exercises.filter((_, i) => i !== ei))}
                className="px-1 text-dim"
                aria-label={`Tirar ${ex.name}`}
              >
                <Icon name="close" size={18} />
              </button>
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
                  <button className={step} onClick={() => updateSet(ei, si, { reps: s.reps + 1 })} aria-label="mais uma repetição">
                    +
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className={step}
                    onClick={() => updateSet(ei, si, { load: Math.max(0, (s.load ?? 0) - LOAD_STEP_KG) })}
                    aria-label="menos 2 kg"
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
                    onClick={() => updateSet(ei, si, { load: (s.load ?? 0) + LOAD_STEP_KG })}
                    aria-label="mais 2 kg"
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
                className="text-[15px] text-dim"
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
            setExercises([...d.exercises, newExercise({ name, sets: 3, rep_min: 8, rep_max: 12 }, history[name] ?? [])])
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
        <button
          disabled={doneSets === 0 || busy}
          onClick={() => void finish()}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          {busy ? 'A guardar…' : editId ? 'Guardar correções' : 'Terminar'}
        </button>
      )}
    </div>
  )
}

// Um exercício novo na sessão: as séries e cargas da última vez; sem
// histórico, as do teu treino (repetições mínimas e carga, se tiver).
function newExercise(template: TemplateExercise, history: LoggedSet[][]): DraftExercise {
  const sug = suggestExercise(history)
  const count = Math.max(template.sets, sug.lastSets.length || template.sets)
  return {
    name: template.name,
    rpe: null,
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
