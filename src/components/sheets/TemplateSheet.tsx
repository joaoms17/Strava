import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { OTHER_SPORTS, SPORT_LABEL, isOtherSport, workoutKcal, type OtherSport } from '../../../api/_lib/rules/targets'
import type { Favorite, FavoriteWorkout, TemplateExercise } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import ExercisePicker from '../ExercisePicker'
import { chip } from '../ui/Chips'
import { cleanDecimalText, decimalFromText, decimalText, intFromText } from '../../lib/campo-numero'

type Kind = 'bike' | 'strength' | OtherSport

const KINDS: [Kind, string][] = [
  ['strength', 'Ginásio'],
  ['bike', 'Bicicleta'],
  ...OTHER_SPORTS.map((s): [Kind, string] => [s, SPORT_LABEL[s]]),
]
const DURATIONS = [30, 45, 60, 75, 90]

// Os teus treinos (4 ou 5, por exemplo): nome, tipo, duração e, no ginásio,
// os exercícios com séries, repetições e carga. Ficam em favorites (kind
// 'workout'): registam-se com um toque e dão nome aos treinos do relógio.
export default function TemplateSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const id = sheet.params.get('id')
  const [loaded, setLoaded] = useState(!id)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('strength')
  const [minutes, setMinutes] = useState(45)
  const [watts, setWatts] = useState<number | null>(null)
  const [exercises, setExercises] = useState<TemplateExercise[]>([])
  const [picking, setPicking] = useState(false)
  // O texto a ser escrito em cada campo, por exercício (o nome é único) e
  // campo: «17,» fica até se escrever o 5, e apagar as séries deixa o campo
  // vazio em vez de saltar para 1 (8 → apagar → 6 dava 16; T23). Ao sair do
  // campo mostra-se o número guardado.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftKey = (name: string, field: 'sets' | 'rep_min' | 'rep_max' | 'load') => `${name}|${field}`
  const setDraft = (key: string, text: string) => setDrafts((prev) => ({ ...prev, [key]: text }))
  const dropDraft = (key: string) =>
    setDrafts((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  const dropDrafts = (name: string) =>
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${name}|`))))
  const wattsOptions = profile.bike_watts_options?.length ? profile.bike_watts_options : [130, 140, 150]

  useEffect(() => {
    if (!id) return
    void supabase
      .from('favorites')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        const fav = data as Favorite | null
        const w = fav?.workout
        if (fav && w) {
          setName(fav.name)
          setKind(w.type === 'other' ? (isOtherSport(w.sport) ? w.sport : 'outro') : w.type)
          setMinutes(w.minutes)
          setWatts(w.watts ?? null)
          setExercises(w.exercises ?? [])
        }
        setLoaded(true)
      })
  }, [id])

  const type: FavoriteWorkout['type'] = kind === 'bike' || kind === 'strength' ? kind : 'other'
  const canSave = name.trim().length > 0 && minutes > 0 && (type !== 'strength' || exercises.length > 0)

  const updateExercise = (i: number, patch: Partial<TemplateExercise>) =>
    setExercises(exercises.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= exercises.length) return
    const next = exercises.slice()
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setExercises(next)
  }

  async function save() {
    if (!canSave) return
    const workout: FavoriteWorkout = {
      type,
      minutes,
      watts: type === 'bike' ? watts : null,
      sport: type === 'other' ? (kind as OtherSport) : null,
      ...(type === 'strength' ? { exercises } : {}),
    }
    const kcal = workoutKcal({ type, minutes, watts: workout.watts ?? null, deviceCalories: null })
    const row = { name: name.trim(), workout, kcal }
    let error
    if (id) {
      ;({ error } = await supabase
        .from('favorites')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', id))
    } else {
      const { data: auth } = await supabase.auth.getUser()
      ;({ error } = await supabase.from('favorites').insert({ ...row, kind: 'workout', user_id: auth.user?.id }))
    }
    if (error) {
      toast(error.code === '23505' ? 'Já tens um treino com esse nome.' : 'Não consegui guardar.')
      return
    }
    emitDataChanged()
    toast(`«${row.name}» guardado.`)
    sheet.close()
  }

  async function remove() {
    if (!id) return
    const { error } = await supabase.from('favorites').update({ archived: true }).eq('id', id)
    if (error) {
      toast('Não consegui apagar.')
      return
    }
    emitDataChanged()
    toast(`«${name}» apagado.`, [
      {
        label: 'Anular',
        run: async () => {
          await supabase.from('favorites').update({ archived: false }).eq('id', id)
          emitDataChanged()
        },
      },
    ])
    sheet.close()
  }

  const field =
    'h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none'
  const small =
    'h-11 w-12 shrink-0 rounded-lg border border-line bg-bg text-center text-[16px] text-ink tabular-nums focus:border-eat focus:outline-none'
  // Um campo inteiro do exercício i: o texto fica enquanto se escreve; o
  // número só muda quando é válido.
  const intField = (i: number, e: TemplateExercise, field: 'sets' | 'rep_min' | 'rep_max', max: number, label: string) => {
    const key = draftKey(e.name, field)
    return (
      <input
        inputMode="numeric"
        aria-label={label}
        value={drafts[key] ?? String(e[field])}
        onFocus={(ev) => ev.target.select()}
        onChange={(ev) => {
          const text = ev.target.value.replace(/\D/g, '').slice(0, 3)
          setDraft(key, text)
          const v = intFromText(text, 1, max)
          if (v == null) return
          if (field === 'rep_min') updateExercise(i, { rep_min: v, rep_max: Math.max(v, e.rep_max) })
          else if (field === 'rep_max') updateExercise(i, { rep_max: v, rep_min: Math.min(v, e.rep_min) })
          else updateExercise(i, { sets: v })
        }}
        onBlur={() => dropDraft(key)}
        className={small}
      />
    )
  }

  return (
    <BottomSheet
      title={id ? 'Editar treino' : 'Novo treino'}
      onClose={sheet.close}
      footer={
        <BusyButton
          busy="A guardar…"
          disabled={!canSave || !loaded}
          onClick={save}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          Guardar treino
        </BusyButton>
      }
    >
      {!loaded ? (
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      ) : (
        <div className="space-y-5 pb-2">
          <label className="block space-y-1">
            <span className="label">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex.: Pernas A, Corrida longa, Padel"
              maxLength={60}
              className={field}
            />
          </label>

          <div className="space-y-2">
            <p className="label">Tipo</p>
            <div className="flex flex-wrap gap-2">
              {KINDS.map(([k, label]) => (
                <button key={k} onClick={() => setKind(k)} className={chip(kind === k, 'cta')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="label">Duração habitual</p>
            <div className="flex flex-wrap items-center gap-2">
              {DURATIONS.map((m) => (
                <button key={m} onClick={() => setMinutes(m)} className={chip(minutes === m, 'cta')}>
                  {m} min
                </button>
              ))}
              {/* Outra duração: com o aspeto de escolhida quando não é nenhuma das de cima. */}
              <label className="flex items-center gap-1.5 text-[15px] text-dim">
                <input
                  inputMode="numeric"
                  aria-label="Outra duração em minutos"
                  value={DURATIONS.includes(minutes) ? '' : String(minutes)}
                  placeholder="outra"
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10)
                    if (Number.isFinite(n) && n > 0) setMinutes(Math.min(n, 600))
                  }}
                  className={`h-11 w-20 rounded-full border px-3 text-[15px] tabular-nums placeholder:text-dim ${
                    DURATIONS.includes(minutes) ? 'border-line bg-transparent text-ink' : 'border-cta bg-cta text-on-cta'
                  }`}
                />
                min
              </label>
            </div>
          </div>

          {type === 'bike' && (
            <div className="space-y-2">
              <p className="label">Potência</p>
              <div className="flex flex-wrap gap-2">
                {wattsOptions.map((w) => (
                  <button key={w} onClick={() => setWatts(w)} className={chip(watts === w, 'cta')}>
                    {w} W
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === 'strength' && (
            <div className="space-y-2">
              <p className="label">Exercícios</p>
              {exercises.length === 0 && (
                <p className="text-[14px] text-dim">Junta os exercícios deste treino, pela ordem em que os fazes.</p>
              )}
              {exercises.map((e, i) => (
                <div key={`${e.name}-${i}`} className="space-y-2 rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{e.name}</span>
                    <button onClick={() => move(i, -1)} aria-label="Subir" className="h-11 w-11 shrink-0 rounded-lg text-dim">
                      ↑
                    </button>
                    <button onClick={() => move(i, 1)} aria-label="Descer" className="h-11 w-11 shrink-0 rounded-lg text-dim">
                      ↓
                    </button>
                    <button
                      onClick={() => {
                        setExercises(exercises.filter((_, j) => j !== i))
                        dropDrafts(e.name)
                      }}
                      aria-label={`Tirar ${e.name}`}
                      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dim"
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  {/* Duas linhas fixas: as séries e as repetições; a carga, com «kg» ao lado. */}
                  <div className="flex items-center gap-1.5 text-[14px] text-dim">
                    {intField(i, e, 'sets', 10, `Séries de ${e.name}`)}
                    séries ×
                    {intField(i, e, 'rep_min', 100, `Repetições mínimas de ${e.name}`)}
                    a
                    {intField(i, e, 'rep_max', 100, `Repetições máximas de ${e.name}`)}
                    repetições
                  </div>
                  <label className="flex items-center gap-1.5 text-[14px] text-dim">
                    Carga
                    <input
                      inputMode="decimal"
                      aria-label={`Carga de ${e.name} em kg`}
                      value={drafts[draftKey(e.name, 'load')] ?? decimalText(e.load_kg)}
                      placeholder="—"
                      onChange={(ev) => {
                        const text = cleanDecimalText(ev.target.value)
                        setDraft(draftKey(e.name, 'load'), text)
                        const load = decimalFromText(text, 0, 300)
                        if (!text.trim()) updateExercise(i, { load_kg: null })
                        else if (load != null) updateExercise(i, { load_kg: load })
                      }}
                      onBlur={() => dropDraft(draftKey(e.name, 'load'))}
                      className={small}
                    />
                    kg
                  </label>
                </div>
              ))}
              {picking ? (
                <ExercisePicker
                  exclude={exercises.map((e) => e.name)}
                  onPick={(picked) => {
                    setExercises([...exercises, { name: picked, sets: 3, rep_min: 8, rep_max: 12, load_kg: null }])
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
            </div>
          )}

          {id && (
            <BusyButton busy="A apagar…" onClick={remove} className="min-h-11 w-full text-[15px] text-pain">
              Apagar este treino
            </BusyButton>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
