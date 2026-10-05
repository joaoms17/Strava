import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { emitDataChanged } from '../../lib/events'
import { saveWorkout } from '../../lib/workout-actions'
import { MAX_AUDIO_SECONDS, canRecord, startRecording, toWavBase64, type Recording } from '../../lib/audio'
import { lisbonInstant } from '../../../api/_lib/rules/momentos'
import { SPORT_LABEL, workoutKcal } from '../../../api/_lib/rules/targets'
import { favoriteExercises, saidSummary, strengthSets, type SaidWorkout } from '../../../api/_lib/rules/treino-dito'
import type { Favorite, FavoriteWorkout, Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import { DayChips } from '../ui/Chips'

type Phase = 'input' | 'recording' | 'reading' | 'review'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Treino › «Dizer ou escrever»: o que fizeste, por texto ou num áudio; a IA
// passa para o registo (tipo, minutos, exercícios e séries), confirmas e
// gravas, e podes guardá-lo nos teus treinos. Por baixo, os teus treinos.
export default function DizerTreinoSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const [, navigate] = useLocation()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [said, setSaid] = useState<SaidWorkout | null>(null)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [day, setDay] = useState(sheet.params.get('data') ?? today)
  const [keep, setKeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const recording = useRef<Recording | null>(null)

  useEffect(() => {
    void supabase
      .from('favorites')
      .select('*')
      .eq('kind', 'workout')
      .eq('archived', false)
      .order('use_count', { ascending: false })
      .then(({ data }) => setFavorites((data ?? []) as Favorite[]))
    return () => recording.current?.cancel()
  }, [])

  // Conta o tempo a gravar e pára sozinho no limite.
  useEffect(() => {
    if (phase !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000)
      setSeconds(s)
      if (s >= MAX_AUDIO_SECONDS) void stopAndRead()
    }, 250)
    return () => window.clearInterval(timer)
  }, [phase])

  async function read(audio?: string) {
    setPhase('reading')
    setError(null)
    try {
      const { workout } = await postApi<{ workout: SaidWorkout }>('/api/workout/parse-said', {
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(audio ? { audio } : {}),
      })
      setSaid(workout)
      setTitle(workout.title)
      setMinutes(workout.minutes != null ? String(workout.minutes) : '')
      if (workout.date && !sheet.params.get('data')) setDay(workout.date)
      if (workout.transcript && !text.trim()) setText(workout.transcript)
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui perceber o treino.')
      setPhase('input')
    }
  }

  async function record() {
    setError(null)
    try {
      recording.current = await startRecording()
      setSeconds(0)
      setPhase('recording')
    } catch {
      setError('Não consegui usar o microfone. Dá autorização nas definições do telemóvel, ou escreve.')
    }
  }

  async function stopAndRead() {
    const current = recording.current
    recording.current = null
    if (!current) return
    setPhase('reading')
    try {
      const blob = await current.stop()
      await read(await toWavBase64(blob))
    } catch {
      setError('Não consegui ler o áudio. Tenta outra vez ou escreve.')
      setPhase('input')
    }
  }

  const mins = Number(minutes)
  const canSave = said != null && Number.isInteger(mins) && mins >= 1 && mins <= 600

  async function save() {
    if (!said || !canSave) return
    setBusy(true)
    const startedAt = day !== today ? lisbonInstant(day, '18:00').toISOString() : null
    const name = title.trim() || null
    let saved: Workout | null = null
    if (said.type === 'strength') {
      try {
        const { workout } = await postApi<{ workout: Workout }>('/api/workout/strength', {
          client_id: crypto.randomUUID(),
          started_at: startedAt,
          minutes: mins,
          sets: strengthSets(said.exercises),
          name,
          note: said.note,
        })
        saved = workout
        emitDataChanged()
        toast(`${name ?? 'Ginásio'} registado`)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Não consegui gravar.')
      }
    } else {
      saved = await saveWorkout(
        {
          type: said.type,
          sport: said.type === 'other' ? said.sport : null,
          minutes: mins,
          started_at: startedAt,
          watts: said.watts,
          watts_source: said.watts != null ? 'manual' : null,
          avg_hr: said.avg_hr,
          kcal_device: said.kcal_device,
          note: said.note,
          name,
        },
        toast,
      )
    }
    if (saved && keep && name) {
      const workout: FavoriteWorkout = {
        type: said.type,
        minutes: mins,
        watts: said.watts,
        sport: said.type === 'other' ? said.sport : null,
        ...(said.type === 'strength' ? { exercises: favoriteExercises(said.exercises) } : {}),
      }
      const { data: auth } = await supabase.auth.getUser()
      const { error: favError } = await supabase.from('favorites').insert({
        kind: 'workout',
        user_id: auth.user?.id,
        name,
        workout,
        kcal: workoutKcal({ type: said.type, minutes: mins, watts: said.watts, deviceCalories: null }),
      })
      if (favError) toast(favError.code === '23505' ? `Já tens um treino «${name}».` : 'Registado, mas não consegui guardar nos teus treinos.')
      else {
        emitDataChanged()
        toast(`Registado e guardado em «Os meus treinos».`)
      }
    }
    setBusy(false)
    if (saved) sheet.close()
  }

  const openFavorite = (f: Favorite) =>
    f.workout?.type === 'strength'
      ? (sheet.close(), navigate(`/treino/ginasio?fav=${f.id}`))
      : sheet.open('registar-treino', { fav: f.id, ...(sheet.params.get('data') ? { data: sheet.params.get('data')! } : {}) })

  const primary =
    'min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40'

  return (
    <BottomSheet
      title="O que fizeste?"
      onClose={sheet.close}
      footer={
        phase === 'review' ? (
          <button disabled={!canSave || busy} onClick={() => void save()} className={primary}>
            {busy ? 'A guardar…' : 'Registar'}
          </button>
        ) : phase === 'recording' ? (
          <button onClick={() => void stopAndRead()} className={`${primary} flex items-center justify-center gap-3`}>
            <span className="h-3 w-3 animate-pulse rounded-full bg-pain" /> Parar · {mmss(seconds)}
          </button>
        ) : (
          <button
            disabled={!text.trim() || phase === 'reading'}
            onClick={() => void read()}
            className={primary}
          >
            {phase === 'reading' ? 'A perceber o treino…' : 'Ler o treino'}
          </button>
        )
      }
    >
      <div className="space-y-4 pb-2">
        {phase !== 'review' ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              disabled={phase !== 'input'}
              placeholder={'Ex.: «Ginásio 50 min: supino 3×10 a 60 kg, remada 3×12 a 45 kg»\nou «45 min de bicicleta a 140 W, FC média 128»'}
              className="w-full rounded-2xl border border-line bg-bg p-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
              aria-label="O que fizeste no treino"
            />
            {canRecord() && phase === 'input' && (
              <button
                onClick={() => void record()}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface2 font-display text-[18px] font-bold tracking-[0.06em] uppercase"
              >
                <Icon name="mic" size={20} /> Gravar áudio
              </button>
            )}
            {phase === 'recording' && (
              <p className="text-center text-[15px] text-dim">
                A gravar… diz o que fizeste (até {MAX_AUDIO_SECONDS} s) e carrega em Parar.
              </p>
            )}
            {error && <p className="text-[15px] text-pain">{error}</p>}
            {phase === 'input' && favorites.length > 0 && (
              <div className="space-y-2">
                <p className="label">Os meus treinos</p>
                <div className="flex flex-wrap gap-2">
                  {favorites.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => openFavorite(f)}
                      className="min-h-10 rounded-full border border-line px-3 text-[15px]"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          said && (
            <>
              <div className="space-y-2 rounded-2xl border border-line bg-surface2 p-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nome do treino"
                  aria-label="Nome do treino"
                  className="w-full bg-transparent text-[18px] font-semibold placeholder:text-dim focus:outline-none"
                />
                <p className="text-[14px] text-dim">{saidSummary(said, (s) => SPORT_LABEL[s])}</p>
                {said.exercises.length > 0 && (
                  <ul className="space-y-1 text-[15px]">
                    {said.exercises.map((e, i) => (
                      <li key={`${e.name}-${i}`} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{e.name}</span>
                        <span className="shrink-0 text-dim tabular-nums">
                          {e.sets.length
                            ? e.sets
                                .map((s) => `${s.reps ?? '?'}${s.load_kg != null ? `×${String(s.load_kg).replace('.', ',')}` : ''}`)
                                .join(' · ')
                            : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {said.note && <p className="text-[14px] text-dim">{said.note}</p>}
              </div>
              {said.transcript && <p className="text-[14px] text-dim italic">Ouvi: «{said.transcript}»</p>}

              <div className="space-y-2">
                <p className="label">Quando</p>
                <DayChips today={today} value={day} onChange={setDay} />
              </div>
              <label className="flex items-center gap-3 text-[16px]">
                Duração
                <input
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
                  placeholder="min"
                  aria-label="Duração em minutos"
                  className="h-11 w-24 rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none"
                />
                <span className="text-dim">min</span>
              </label>
              <label className="flex min-h-11 items-center gap-3 text-[16px]">
                <input
                  type="checkbox"
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                  className="h-5 w-5 accent-[var(--color-eat)]"
                />
                Guardar nos meus treinos
              </label>
              {keep && !title.trim() && <p className="text-[14px] text-attn">Dá-lhe um nome para o guardar.</p>}
              <button onClick={() => setPhase('input')} className="min-h-10 text-[15px] text-dim">
                Não é isto: corrigir
              </button>
            </>
          )
        )}
      </div>
    </BottomSheet>
  )
}
