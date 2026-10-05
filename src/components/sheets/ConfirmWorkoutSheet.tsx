import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { signedUrls } from '../../lib/photos'
import { nutritionalDay } from '../../lib/day'
import { fmtDayShort, fmtKcal, timeOf } from '../../lib/format'
import { addShots, deleteWorkout, saveWorkout, workoutTitle } from '../../lib/workout-actions'
import { instantInNutritionalDay, lisbonInstant } from '../../../api/_lib/rules/momentos'
import {
  countedMinutes,
  exerciseKcal,
  findMergeCandidate,
  kcalExplanation,
  typeOfSport,
  type WattsSource,
} from '../../../api/_lib/rules/treino'
import type { Favorite, Workout, WorkoutImport } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import { OTHER_SPORTS, SPORT_LABEL, isOtherSport, type OtherSport } from '../../../api/_lib/rules/targets'
import ShotButton from '../ui/ShotButton'
import Icon from '../ui/Icon'
import { DayChips, chip } from '../ui/Chips'
import ErrorReason from '../ui/ErrorReason'

type Kind = 'bike' | 'strength' | OtherSport
const KINDS: [Kind, string][] = [
  ['bike', 'Bicicleta'],
  ['strength', 'Ginásio'],
  ...OTHER_SPORTS.map((s): [Kind, string] => [s, SPORT_LABEL[s]]),
]

const toInt = (text: string): number | null => {
  const n = Number.parseInt(text, 10)
  return Number.isFinite(n) ? n : null
}
const str = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n)))

const SOURCE_LABEL: Record<string, string> = {
  screenshot: 'print do relógio',
  manual: 'à mão',
  strava: 'Strava',
  intervals: 'Relógio (auto)',
}

// Folha Confirmar treino: rever o que a IA leu dos prints, juntá-lo a uma
// sessão já registada ou guardar uma nova. Com ?id=, é o detalhe editável de
// um treino guardado.
export default function ConfirmWorkoutSheet() {
  const sheet = useSheet()
  const workoutId = sheet.params.get('id')
  const importId = sheet.params.get('import')
  if (workoutId) return <WorkoutDetail key={workoutId} id={workoutId} />
  if (importId) return <ImportConfirm key={importId} id={importId} target={sheet.params.get('para')} />
  return null
}

function Thumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!paths.length) return
    void signedUrls(paths, 'workout-shots').then((map) =>
      setUrls(paths.map((p) => map[p]).filter((u): u is string => !!u)),
    )
  }, [paths.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!urls.length) return null
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={url} alt="Print do treino" className="h-28 w-20 rounded-xl border border-line object-cover" />
        </a>
      ))}
    </div>
  )
}

interface Draft {
  kind: Kind
  day: string
  time: string
  minutes: string
  watts: string
  wattsSource: WattsSource | null
  avgHr: string
  maxHr: string
  cadence: string
  kcalDevice: string
}

function ImportConfirm({ id, target }: { id: string; target: string | null }) {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [row, setRow] = useState<WorkoutImport | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [candidate, setCandidate] = useState<Workout | null>(null)
  const [merge, setMerge] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lastWatts, setLastWatts] = useState<number | null>(null)
  // O que o João já corrigiu à mão: sobrevive a «Juntar outro print».
  const [edited, setEdited] = useState<Partial<Draft>>({})
  const [adding, setAdding] = useState(false)
  const kicked = useRef(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('workout_imports').select('*').eq('id', id).maybeSingle()
    setRow((data ?? null) as WorkoutImport | null)
  }, [id])

  useEffect(() => {
    void load()
    void supabase
      .from('workouts_active')
      .select('watts')
      .eq('type', 'bike')
      .not('watts', 'is', null)
      .or('watts_source.is.null,watts_source.neq.prefill')
      .order('date', { ascending: false })
      .limit(1)
      .then(({ data }) => setLastWatts((data?.[0]?.watts as number | undefined) ?? null))
  }, [load])

  // Enquanto lê, pergunta de 2,5 em 2,5 s; se a leitura parou (a função
  // morreu), pede outra vez uma única vez.
  useEffect(() => {
    if (row?.status !== 'a_ler') return
    const stale =
      Date.now() - Date.parse(row.created_at) > 20_000 &&
      (row.analysis_started_at == null || Date.now() - Date.parse(row.analysis_started_at) > 90_000)
    if (stale && !kicked.current) {
      kicked.current = true
      void postApi('/api/workout/parse-shot', { import_id: id }).then(load, load)
    }
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 2500)
    return () => clearInterval(timer)
  }, [row, id, load])

  // Rascunho a partir do que foi lido (uma vez).
  useEffect(() => {
    if (draft || !row || row.status !== 'por_confirmar' || !row.parsed) return
    const a = row.parsed.activity
    const { type, sport } = typeOfSport(a.sport)
    const kind: Kind = type === 'other' ? (isOtherSport(sport) ? sport : 'outro') : type
    const fromConsole = row.parsed.images.some((i) => i.app === 'bike_console')
    const watts = a.avg_power_w ?? null
    const time = a.start_time ? a.start_time.padStart(5, '0') : ''
    // O print mostra a data do calendário; o dia nutricional muda às 04:00.
    const day =
      a.date && time
        ? nutritionalDay(lisbonInstant(a.date, time), profile.nutrition_day_cutoff_hour)
        : (a.date ?? today)
    const next: Draft = {
      kind,
      day,
      time,
      minutes: str(countedMinutes(type, a.total_time_s, a.moving_time_s)),
      watts: str(watts),
      wattsSource: watts != null ? (fromConsole ? 'console' : 'device') : null,
      avgHr: str(a.avg_hr),
      maxHr: str(a.max_hr),
      cadence: str(a.avg_cadence),
      kcalDevice: str(a.calories_device),
    }
    setDraft({ ...next, ...edited })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, draft, today, profile.nutrition_day_cutoff_hour])

  // Sem watts no print, propõe os últimos confirmados (≈, não contam para subir).
  useEffect(() => {
    if (draft && draft.kind === 'bike' && !draft.watts && lastWatts) {
      setDraft({ ...draft, watts: String(lastWatts), wattsSource: 'prefill' })
    }
  }, [draft, lastWatts])

  // Já existe uma sessão parecida? «Juntar à Bicicleta das 07:10 (45 min)».
  const type: Workout['type'] = !draft ? 'bike' : draft.kind === 'bike' || draft.kind === 'strength' ? draft.kind : 'other'
  const startedAt = draft
    ? draft.time
      ? instantInNutritionalDay(draft.day, draft.time, profile.nutrition_day_cutoff_hour).toISOString()
      : draft.day !== today
        ? lisbonInstant(draft.day, '18:00').toISOString()
        : null
    : null
  // Prints para completar um treino escolhido (o do relógio sem km): é esse.
  useEffect(() => {
    if (!target) return
    void supabase
      .from('workouts_active')
      .select('*')
      .eq('id', target)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCandidate(data as Workout)
      })
  }, [target])
  useEffect(() => {
    if (!draft || target) return
    void supabase
      .from('workouts_active')
      .select('*')
      .eq('date', draft.day)
      .eq('type', type)
      .then(({ data }) => {
        const sessions = ((data ?? []) as Workout[]).map((w) => ({ ...w, started_at: w.started_at ?? null }))
        setCandidate(
          findMergeCandidate(
            { type, date: draft.day, minutes: toInt(draft.minutes), started_at: draft.time ? startedAt : null },
            sessions,
          ),
        )
      })
  }, [draft?.day, draft?.kind, draft?.minutes, draft?.time]) // eslint-disable-line react-hooks/exhaustive-deps

  function startManual() {
    setDraft({
      kind: 'bike',
      day: today,
      time: '',
      minutes: '45',
      watts: lastWatts ? String(lastWatts) : '',
      wattsSource: lastWatts ? 'prefill' : null,
      avgHr: '',
      maxHr: '',
      cadence: '',
      kcalDevice: '',
    })
  }

  async function retry() {
    setBusy(true)
    try {
      await postApi('/api/workout/parse-shot', { import_id: id, reset: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui ler outra vez.')
    }
    await load()
    setBusy(false)
  }

  async function discard() {
    try {
      await postApi('/api/workout/discard', { import_id: id })
      emitDataChanged()
      sheet.close()
    } catch {
      toast('Não consegui descartar.')
    }
  }

  if (row === undefined) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  if (row === null) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Este print já não existe.</p>
      </BottomSheet>
    )
  }

  if (row.status === 'guardado' || row.status === 'descartado') {
    return (
      <BottomSheet title="Print do relógio" onClose={sheet.close}>
        <div className="space-y-3 pb-2">
          <Thumbs paths={row.thumb_paths} />
          <p className="text-[15px]">{row.status === 'guardado' ? 'Já está guardado.' : 'Descartado.'}</p>
          {row.workout_id && (
            <button
              onClick={() => sheet.open('confirmar-treino', { id: row.workout_id! })}
              className="min-h-12 w-full rounded-xl border border-line text-[15px]"
            >
              Abrir o treino
            </button>
          )}
        </div>
      </BottomSheet>
    )
  }

  if (row.status === 'a_ler') {
    return (
      <BottomSheet title="Print do relógio" onClose={sheet.close}>
        <div className="space-y-4 pb-2">
          <Thumbs paths={row.thumb_paths} />
          <p className="animate-pulse text-[17px]">A ler o print…</p>
          <p className="text-[14px] text-dim">Demora 5 a 15 segundos.</p>
          <button onClick={sheet.close} className="min-h-12 w-full rounded-xl border border-line text-[15px]">
            Fechar, aviso no Hoje quando estiver pronto
          </button>
        </div>
      </BottomSheet>
    )
  }

  if (row.status === 'erro' && !draft) {
    return (
      <BottomSheet title="Print do relógio" onClose={sheet.close}>
        <div className="space-y-4 pb-2">
          <Thumbs paths={row.thumb_paths} />
          <ErrorReason stored={row.analysis_error} fallback="Não consegui ler este print." />
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => void retry()}
              className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-50"
            >
              Tentar de novo
            </button>
            <button onClick={startManual} className="min-h-12 rounded-xl border border-line text-[15px]">
              Preencher à mão
            </button>
          </div>
          <button onClick={() => void discard()} className="text-[15px] text-dim">
            Descartar
          </button>
        </div>
      </BottomSheet>
    )
  }

  if (!draft) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A preparar…</p>
      </BottomSheet>
    )
  }

  const low = new Set(row.parsed?.low_fields ?? [])
  const merging = candidate != null && merge
  const minutes = toInt(draft.minutes)
  const watts = type === 'bike' ? toInt(draft.watts) : null
  const kcal = exerciseKcal({
    type,
    minutes,
    watts,
    wattsSource: draft.wattsSource,
    deviceCalories: type === 'strength' ? null : toInt(draft.kcalDevice),
    sport: type === 'other' ? (draft.kind as OtherSport) : null,
    weightKg: null,
  })
  const canSave = minutes != null && minutes > 0
  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch })
    setEdited({ ...edited, ...patch })
  }

  // Nomes dos campos do print que o João corrigiu (a leitura nova não os mexe).
  const SHOT_FIELD: Partial<Record<keyof Draft, string[]>> = {
    kind: ['sport'],
    day: ['date'],
    time: ['start_time'],
    minutes: ['moving_time_s', 'total_time_s'],
    watts: ['avg_power_w'],
    avgHr: ['avg_hr'],
    maxHr: ['max_hr'],
    cadence: ['avg_cadence'],
    kcalDevice: ['calories_device'],
  }

  async function addMore(files: File[]) {
    if (!row || !files.length) return
    setAdding(true)
    try {
      const updated = await addShots(
        row,
        files,
        (Object.keys(edited) as (keyof Draft)[]).flatMap((k) => SHOT_FIELD[k] ?? []),
      )
      kicked.current = false
      setDraft(null)
      setRow(updated)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui juntar o print.')
    }
    setAdding(false)
  }

  const input = (label: string, key: keyof Draft, lowKey: string, unit: string) => (
    <label className="block space-y-1">
      <span className="label flex items-center gap-2">
        {label}
        {low.has(lowKey) && <span className="rounded bg-attn/20 px-1.5 text-[11px] text-attn">confirma</span>}
      </span>
      <span className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={draft[key] as string}
          onChange={(e) => set({ [key]: e.target.value.replace(/\D/g, '') } as Partial<Draft>)}
          placeholder="— adicionar"
          className={`h-12 w-full rounded-xl border bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:outline-none ${
            low.has(lowKey) ? 'border-attn' : 'border-line focus:border-eat'
          }`}
        />
        <span className="w-10 text-[15px] text-dim">{unit}</span>
      </span>
    </label>
  )

  async function save() {
    if (!canSave || minutes == null || !draft) return
    setBusy(true)
    const saved = await saveWorkout(
      {
        type,
        sport: type === 'other' ? draft.kind : null,
        minutes,
        started_at: startedAt,
        watts,
        watts_source: watts != null ? draft.wattsSource : null,
        avg_hr: toInt(draft.avgHr),
        max_hr: toInt(draft.maxHr),
        cadence: type === 'bike' ? toInt(draft.cadence) : null,
        kcal_device: toInt(draft.kcalDevice),
        import_id: id,
        merge_into: merging ? candidate!.id : null,
      },
      toast,
    )
    setBusy(false)
    if (saved) sheet.close()
  }

  return (
    <BottomSheet
      title="Confirmar treino"
      onClose={sheet.close}
      footer={
        <div className="flex gap-2">
          <button
            disabled={!canSave || busy}
            onClick={() => void save()}
            className="min-h-14 flex-1 rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            {busy ? 'A guardar…' : merging ? 'Juntar' : `Guardar${kcal.kcal > 0 ? ` · +${fmtKcal(kcal.kcal)}` : ''}`}
          </button>
          <button onClick={() => void discard()} className="min-h-14 rounded-2xl border border-line px-4 text-[15px]">
            Descartar
          </button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <Thumbs paths={row.thumb_paths} />
        {row.source_paths.length < 4 && (
          <label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[15px] ${adding ? 'opacity-50' : ''}`}>
            <Icon name="watch" size={18} /> {adding ? 'A enviar…' : 'Juntar outro print'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={adding}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                void addMore(files)
              }}
            />
          </label>
        )}
        {row.parsed?.same_activity === false && (
          <p className="rounded-xl bg-attn/15 px-3 py-2 text-[15px] text-attn">
            Estes prints parecem de treinos diferentes
            {row.parsed.mismatch_reason ? ` (${row.parsed.mismatch_reason})` : ''}. Guarda um de cada vez.
          </p>
        )}
        {row.parsed?.notes && <p className="text-[14px] text-dim">{row.parsed.notes}</p>}

        {candidate && (
          <div className="space-y-2">
            <p className="label">Já registaste este treino?</p>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => setMerge(true)} className={`${chip(merge)} !rounded-xl !py-3 text-left`}>
                Juntar à {workoutTitle(candidate).toLowerCase()} das{' '}
                {timeOf(candidate.started_at ?? candidate.created_at)} ({candidate.minutes} min)
              </button>
              <button onClick={() => setMerge(false)} className={`${chip(!merge)} !rounded-xl !py-3 text-left`}>
                Guardar como novo
              </button>
            </div>
            {merging && (
              <p className="text-[13px] text-dim">
                {target
                  ? 'Completa o treino do relógio com o que o print tem a mais: km, calorias, potência.'
                  : 'Junta os batimentos e o resto que faltar. A duração e os watts que deste ficam.'}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {KINDS.map(([k, label]) => (
            <button key={k} onClick={() => set({ kind: k })} className={chip(draft.kind === k)}>
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="label flex items-center gap-2">
            Dia e hora
            {(low.has('date') || low.has('start_time')) && (
              <span className="rounded bg-attn/20 px-1.5 text-[11px] text-attn">confirma</span>
            )}
          </p>
          <DayChips today={today} value={draft.day} onChange={(day) => set({ day })} />
          <label className="flex items-center gap-3 text-[15px] text-dim">
            Começou às
            <input
              type="time"
              value={draft.time}
              onChange={(e) => set({ time: e.target.value })}
              className="h-11 rounded-xl border border-line bg-bg px-3 text-[17px] text-ink"
              aria-label="Hora de início"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {input('Duração', 'minutes', type === 'strength' ? 'total_time_s' : 'moving_time_s', 'min')}
          {type === 'bike' && input('Potência', 'watts', 'avg_power_w', 'W')}
          {input('Batimentos médios', 'avgHr', 'avg_hr', 'bpm')}
          {input('Batimentos máximos', 'maxHr', 'max_hr', 'bpm')}
          {type === 'bike' && input('Cadência', 'cadence', 'avg_cadence', 'rpm')}
          {type === 'other' && input('Calorias do relógio', 'kcalDevice', 'calories_device', 'kcal')}
        </div>

        {type === 'bike' && draft.wattsSource === 'prefill' && (
          <div className="space-y-2">
            <p className="text-[15px]">Qual era a potência na bicicleta?</p>
            <div className="flex flex-wrap gap-2">
              {(profile.bike_watts_options?.length ? profile.bike_watts_options : [130, 140, 150]).map((w) => (
                <button key={w} onClick={() => set({ watts: String(w), wattsSource: 'manual' })} className={chip(false)}>
                  {w} W
                </button>
              ))}
            </div>
            <p className="text-[13px] text-dim">
              ≈ {draft.watts} W da última sessão: conta nas calorias, mas não para subir a potência.
            </p>
          </div>
        )}

        <p className="text-[14px] text-dim">
          {kcalExplanation({
            type,
            minutes,
            watts,
            kcal: kcal.kcal,
            rule: kcal.rule,
            deviceCalories: toInt(draft.kcalDevice),
          })}
        </p>
      </div>
    </BottomSheet>
  )
}

// Os teus treinos pela ordem mais provável: o mesmo tipo (e desporto) primeiro.
function sortTemplates(templates: Favorite[], w: Workout): Favorite[] {
  const sport = w.sport ?? w.raw?.sport ?? null
  const score = (f: Favorite) =>
    f.workout?.type === w.type ? (w.type !== 'other' || f.workout?.sport === sport ? 2 : 1) : 0
  return templates.slice().sort((a, b) => score(b) - score(a))
}

function WorkoutDetail({ id }: { id: string }) {
  const sheet = useSheet()
  const [, navigate] = useLocation()
  const toast = useToast()
  const [workout, setWorkout] = useState<Workout | null | undefined>(undefined)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [minutes, setMinutes] = useState('')
  const [watts, setWatts] = useState('')
  const [avgHr, setAvgHr] = useState('')
  const [maxHr, setMaxHr] = useState('')
  const [busy, setBusy] = useState(false)
  const [templates, setTemplates] = useState<Favorite[]>([])

  const load = useCallback(async () => {
    const [{ data }, { data: imports }, { data: favs }] = await Promise.all([
      supabase.from('workouts').select('*').eq('id', id).maybeSingle(),
      supabase.from('workout_imports').select('thumb_paths').eq('workout_id', id),
      supabase
        .from('favorites')
        .select('*')
        .eq('kind', 'workout')
        .eq('archived', false)
        .order('use_count', { ascending: false }),
    ])
    setTemplates(((favs ?? []) as Favorite[]).filter((f) => f.workout))
    const w = (data ?? null) as Workout | null
    setWorkout(w)
    setThumbs((imports ?? []).flatMap((i) => (i.thumb_paths as string[]) ?? []))
    if (w) {
      setMinutes(str(w.minutes))
      setWatts(str(w.watts))
      setAvgHr(str(w.avg_hr))
      setMaxHr(str(w.max_hr))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (workout === undefined) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  if (workout === null) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Este treino já não existe.</p>
      </BottomSheet>
    )
  }

  const w = workout
  const dirty =
    minutes !== str(w.minutes) || watts !== str(w.watts) || avgHr !== str(w.avg_hr) || maxHr !== str(w.max_hr)
  const at = w.started_at ?? w.created_at
  const deviceCalories = w.kcal_device ?? w.raw?.calories ?? null

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy(true)
    try {
      await postApi('/api/workout/update', { workout_id: w.id, ...body })
      emitDataChanged()
      await load()
      toast(message)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar.')
    }
    setBusy(false)
  }

  const field =
    'h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none'
  const numberField = (label: string, value: string, onChange: (v: string) => void, unit: string) => (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          placeholder="— adicionar"
          className={field}
        />
        <span className="w-10 text-[15px] text-dim">{unit}</span>
      </span>
    </label>
  )

  return (
    <BottomSheet
      title={workoutTitle(w)}
      onClose={sheet.close}
      footer={
        dirty ? (
          <button
            disabled={busy}
            onClick={() =>
              void patch(
                {
                  minutes: toInt(minutes) ?? undefined,
                  ...(w.type === 'bike' ? { watts: toInt(watts) } : {}),
                  avg_hr: toInt(avgHr),
                  max_hr: toInt(maxHr),
                },
                'Guardado.',
              )
            }
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            Guardar alterações
          </button>
        ) : undefined
      }
    >
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[15px] text-dim">
            {fmtDayShort(w.date)} · {timeOf(at)} ·{' '}
            {w.favorite_id ? 'favorito' : (SOURCE_LABEL[w.source] ?? w.source)}
            {(w.merged_from?.length ?? 0) > 0 ? ' · com print' : ''}
          </p>
          <p className="num text-[40px] leading-tight text-burn">
            {w.kcal_estimated ? '≈ ' : ''}+{fmtKcal(w.kcal_est ?? 0)} <span className="text-[20px] text-dim">no plano</span>
          </p>
          <p className="text-[14px] text-dim">
            {kcalExplanation({
              type: w.type,
              minutes: w.minutes,
              watts: w.watts,
              kcal: w.kcal_est ?? 0,
              rule: w.kcal_rule ?? null,
              deviceCalories,
            })}
          </p>
        </div>

        {!w.deleted_at && templates.length > 0 && (
          <div className="space-y-2">
            <p className="label">{w.favorite_id ? 'Treino' : 'Qual dos teus treinos foi?'}</p>
            <div className="flex flex-wrap gap-2">
              {sortTemplates(templates, w).map((f) => (
                <button
                  key={f.id}
                  disabled={busy}
                  onClick={() =>
                    void patch({ favorite_id: w.favorite_id === f.id ? null : f.id }, w.favorite_id === f.id ? 'Tirado.' : `Agora é «${f.name}».`)
                  }
                  className={chip(w.favorite_id === f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {w.deleted_at ? (
          <div className="space-y-2">
            <p className="text-[15px] text-dim">Apagado — não conta para as contas.</p>
            <button
              onClick={async () => {
                await postApi('/api/workout/restore', { workout_id: w.id })
                emitDataChanged()
                await load()
              }}
              className="min-h-12 w-full rounded-xl border border-line text-[15px]"
            >
              Repor
            </button>
          </div>
        ) : (
          <>
            <Thumbs paths={thumbs} />
            <div className="grid grid-cols-2 gap-3">
              {numberField('Duração', minutes, setMinutes, 'min')}
              {w.type === 'bike' && numberField('Potência', watts, setWatts, 'W')}
              {numberField('Batimentos médios', avgHr, setAvgHr, 'bpm')}
              {numberField('Batimentos máximos', maxHr, setMaxHr, 'bpm')}
            </div>
            {(w.cadence != null || w.distance_km != null || w.aerobic_te != null) && (
              <p className="text-[14px] text-dim tabular-nums">
                {[
                  w.cadence != null ? `${w.cadence} rpm` : null,
                  w.distance_km != null ? `${String(w.distance_km).replace('.', ',')} km` : null,
                  w.distance_km != null && w.moving_s
                    ? `${String(Math.round((w.distance_km / (w.moving_s / 3600)) * 10) / 10).replace('.', ',')} km/h`
                    : null,
                  w.aerobic_te != null ? `efeito aeróbio ${w.aerobic_te}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            {w.type === 'strength' && (
              <button
                onClick={() =>
                  // Substitui o endereço da folha: fechar e navegar ao mesmo
                  // tempo corria o risco de o «voltar» desfazer a navegação.
                  navigate(`/treino/ginasio?id=${w.id}${w.favorite_id ? `&fav=${w.favorite_id}` : ''}`, { replace: true })
                }
                className="min-h-12 w-full rounded-xl border border-line text-[15px]"
              >
                {w.source === 'intervals' ? 'Registar as séries' : 'Ver e corrigir as séries'}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <ShotButton className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px]">
                <Icon name="watch" size={18} /> Juntar print
              </ShotButton>
              <button
                onClick={() => {
                  void deleteWorkout(w, toast)
                  sheet.close()
                }}
                className="min-h-12 rounded-xl border border-line text-[15px] text-pain"
              >
                Apagar
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
