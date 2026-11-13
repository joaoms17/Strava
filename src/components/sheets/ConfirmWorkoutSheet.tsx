import { useCallback, useEffect, useRef, useState } from 'react'
import { QualFoiQuestion } from '../QualFoi'
import { usePlanoTreino } from '../../lib/plano-treino'
import { askWhichWorkout } from '../../../api/_lib/rules/plano-treino'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton, runBusy } from '../../lib/busy'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { signedUrls } from '../../lib/photos'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtDayShort, fmtKcal, timeOf } from '../../lib/format'
import { addShots, deleteWorkout, saveWorkout, workoutTitle } from '../../lib/workout-actions'
import { useKcalContext } from '../../lib/kcal-context'
import { instantInNutritionalDay, lisbonInstant } from '../../../api/_lib/rules/momentos'
import {
  countedMinutes,
  exerciseKcal,
  findMergeCandidate,
  LAST_WATTS_WINDOW_DAYS,
  kcalExplanation,
  startGuessed,
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
import { useWattsChoices } from '../../lib/use-watts'
import { duplicatePairs, mergeSessions } from '../../../api/_lib/rules/sessoes'
import Duplicado from '../Duplicado'

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
  // Um treino que o relógio partiu em dois: os totais e as partes.
  const parts = (sheet.params.get('partes') ?? '').split(',').filter(Boolean)
  if (parts.length > 1) return <MergedDetail key={parts.join(',')} ids={parts} />
  if (workoutId) return <WorkoutDetail key={workoutId} id={workoutId} />
  if (importId) return <ImportConfirm key={importId} id={importId} target={sheet.params.get('para')} />
  return null
}

function MergedDetail({ ids }: { ids: string[] }) {
  const sheet = useSheet()
  const [rows, setRows] = useState<Workout[] | null>(null)
  useEffect(() => {
    void supabase
      .from('workouts_active')
      .select('*')
      .in('id', ids)
      .then(({ data }) => setRows((data ?? []) as Workout[]))
  }, [ids.join(',')])

  if (!rows) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  const session = mergeSessions(rows)[0]
  if (!session) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Este treino já não existe.</p>
      </BottomSheet>
    )
  }
  const parts = session.parts
  const comma = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ',')
  const withKm = parts.filter((p) => (p.distance_km ?? 0) > 0)
  const kmSeconds = withKm.reduce((a, p) => a + (p.moving_s ?? (p.minutes ?? 0) * 60), 0)
  const km = withKm.reduce((a, p) => a + (p.distance_km ?? 0), 0)
  const last = parts[parts.length - 1]!
  const end = last.started_at
    ? new Date(Date.parse(last.started_at) + (last.elapsed_s ?? (last.minutes ?? 0) * 60) * 1000).toISOString()
    : null
  const tiles: [string, string][] = [
    ['Duração', `${session.minutes ?? 0} min`],
    ...(km > 0 ? ([['Distância', `${comma(km, 2)} km`]] as [string, string][]) : []),
    ...(km > 0 && kmSeconds > 0 ? ([['Velocidade', `${comma(km / (kmSeconds / 3600))} km/h`]] as [string, string][]) : []),
    ...(session.watts != null ? ([['Potência', `${session.watts} W`]] as [string, string][]) : []),
    ...(session.avg_hr != null ? ([['Batimentos médios', `${session.avg_hr} bpm`]] as [string, string][]) : []),
    ...(session.max_hr != null ? ([['Batimentos máximos', `${session.max_hr} bpm`]] as [string, string][]) : []),
    ...(session.kcal_device != null ? ([['Calorias do relógio', `${fmtKcal(session.kcal_device)} kcal`]] as [string, string][]) : []),
  ]

  return (
    <BottomSheet title={workoutTitle(session)} onClose={sheet.close}>
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[15px] text-dim">
            {fmtDayShort(session.date)}
            {session.started_at ? ` · ${timeOf(session.started_at)}${end ? `–${timeOf(end)}` : ''}` : ''}
          </p>
          <p className="text-[14px] text-dim">
            {parts.length} partes juntas: o relógio dividiu o treino (parou e recomeçou).
          </p>
        </div>
        <p className="num text-[34px] leading-none font-extrabold text-burn">+{fmtKcal(session.kcal_est ?? 0)}</p>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="label text-[12px]">{label}</p>
              <p className="num text-[22px] leading-tight font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <p className="label">As partes</p>
          <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-surface">
            {parts.map((p, i) => (
              <li key={p.id}>
                <button
                  onClick={() => sheet.open('confirmar-treino', { id: p.id })}
                  className="flex min-h-14 w-full items-center gap-3 px-3 text-left"
                >
                  <span className="w-14 shrink-0 text-[15px] text-dim tabular-nums">
                    {p.started_at ? timeOf(p.started_at) : `Parte ${i + 1}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] tabular-nums">
                    {[
                      p.minutes != null ? `${p.minutes} min` : null,
                      p.distance_km != null ? `${comma(p.distance_km, 2)} km` : null,
                      p.watts != null ? `${p.watts} W` : null,
                      p.avg_hr != null ? `${p.avg_hr} bpm` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="num shrink-0 text-[18px] text-burn">+{fmtKcal(p.kcal_est ?? 0)}</span>
                  <Icon name="chevron" size={18} className="shrink-0 text-dim" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-dim">Para corrigir ou apagar, abre a parte.</p>
        </div>
      </div>
    </BottomSheet>
  )
}

function Thumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    if (!paths.length) return
    void signedUrls(paths, 'workout-shots').then((map) =>
      setUrls(paths.map((p) => map[p]).filter((u): u is string => !!u)),
    )
  }, [paths.join('|')])
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
  const [lastWatts, setLastWatts] = useState<number | null>(null)
  // O que o João já corrigiu à mão: sobrevive a «Juntar outro print».
  const [edited, setEdited] = useState<Partial<Draft>>({})
  // Os campos que o print trouxe: só esses aparecem (o que não vem, não se pede).
  const [present, setPresent] = useState<Set<keyof Draft>>(new Set())
  const [adding, setAdding] = useState(false)
  const kicked = useRef(false)
  const wattsOptions = useWattsChoices()

  const load = useCallback(async () => {
    const { data } = await supabase.from('workout_imports').select('*').eq('id', id).maybeSingle()
    setRow((data ?? null) as WorkoutImport | null)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  // Os últimos watts confirmados, com a mesma janela do servidor (30 dias
  // antes do dia do treino; L20).
  const wattsDay = draft?.day ?? today
  useEffect(() => {
    let alive = true
    void supabase
      .from('workouts_active')
      .select('watts')
      .eq('type', 'bike')
      .not('watts', 'is', null)
      .or('watts_source.is.null,watts_source.neq.prefill')
      .gte('date', shiftDate(wattsDay, -LAST_WATTS_WINDOW_DAYS))
      .lte('date', wattsDay)
      .order('date', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (alive) setLastWatts((data?.[0]?.watts as number | undefined) ?? null)
      })
    return () => {
      alive = false
    }
  }, [wattsDay])

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
    const filled = { ...next, ...edited }
    setPresent(new Set((Object.keys(filled) as (keyof Draft)[]).filter((k) => filled[k] !== '' && filled[k] != null)))
    setDraft(filled)
  }, [row, draft, today, profile.nutrition_day_cutoff_hour])

  // Sem watts no print, propõe os últimos confirmados (≈, não contam para subir).
  useEffect(() => {
    if (draft && draft.kind === 'bike' && !draft.watts && !draft.kcalDevice && lastWatts) {
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
        // Uma hora suposta («Já fiz» sem hora) não conta para comparar.
        const sessions = ((data ?? []) as Workout[]).map((w) => ({ ...w, started_at: startGuessed(w) ? null : (w.started_at ?? null) }))
        setCandidate(
          findMergeCandidate(
            // Nos «outros», só o mesmo desporto (T4).
            {
              type,
              date: draft.day,
              minutes: toInt(draft.minutes),
              started_at: draft.time ? startedAt : null,
              ...(type === 'other' ? { sport: draft.kind } : {}),
            },
            sessions,
          ),
        )
      })
    // Sem a duração nas dependências: apagar um dígito não faz a folha mudar
    // de forma (aparecer e desaparecer o «Juntar»; T17).
  }, [draft?.day, draft?.kind, draft?.time])
  // Sem calorias do relógio, o ritmo no ginásio e o peso desse dia (como o servidor).
  const context = useKcalContext(draft?.day ?? today, today, draft ? type : null)

  function startManual() {
    setPresent(new Set(['minutes', 'watts', 'kcalDevice']))
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
    try {
      await postApi('/api/workout/parse-shot', { import_id: id, reset: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui ler outra vez.')
    }
    await load()
  }

  // Descartar com Anular (T17): o print volta a ficar por confirmar.
  async function discard() {
    try {
      await postApi('/api/workout/discard', { import_id: id })
      emitDataChanged()
      sheet.close()
      toast('Print descartado.', [
        {
          label: 'Anular',
          run: async () => {
            try {
              await postApi('/api/workout/discard', { import_id: id, undo: true })
              emitDataChanged()
            } catch (err) {
              toast(err instanceof Error ? `Não anulei: ${err.message}` : 'Não consegui anular.')
            }
          },
        },
      ])
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
            <BusyButton
              busy="A ler o print…"
              onClick={retry}
              className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-50"
            >
              Tentar de novo
            </BusyButton>
            <button onClick={startManual} className="min-h-12 rounded-xl border border-line text-[15px]">
              Preencher à mão
            </button>
          </div>
          <BusyButton busy="A descartar…" onClick={discard} className="text-[15px] text-dim">
            Descartar
          </BusyButton>
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
  // As contas que o servidor faz ao gravar (no ginásio, as calorias do
  // relógio por inteiro; sem elas, o ritmo da pessoa ou o peso).
  const kcal = exerciseKcal({
    type,
    minutes,
    watts,
    wattsSource: draft.wattsSource,
    deviceCalories: toInt(draft.kcalDevice),
    sport: type === 'other' ? (draft.kind as OtherSport) : null,
    weightKg: context.weightKg,
    gymPace: context.gymPace,
  })
  // A juntar, a duração é a do treino que já lá está (um print sem tempo junta-se na mesma).
  const savedMinutes = merging ? (minutes ?? candidate!.minutes) : minutes
  const canSave = savedMinutes != null && savedMinutes > 0
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

  // O «confirma» fica por baixo do campo (que já tem a borda âmbar): no
  // rótulo partia «Batimentos médios» em duas linhas e desalinhava os campos.
  const input = (label: string, key: keyof Draft, lowKey: string, unit: string) => (
    <label className="block space-y-1">
      <span className="label block">{label}</span>
      <span className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={draft[key] as string}
          onChange={(e) =>
            set({
              [key]: e.target.value.replace(/\D/g, ''),
              // Os watts escritos são teus: deixam de ser «≈ da última sessão» (T13).
              ...(key === 'watts' ? { wattsSource: 'manual' as const } : {}),
            } as Partial<Draft>)
          }
          placeholder="— adicionar"
          className={`h-12 w-full rounded-xl border bg-bg px-3 text-[17px] tabular-nums placeholder:text-dim focus:outline-none ${
            low.has(lowKey) ? 'border-attn' : 'border-line focus:border-eat'
          }`}
        />
        <span className="w-10 text-[15px] text-dim">{unit}</span>
      </span>
      {low.has(lowKey) && <span className="inline-block rounded bg-attn/15 px-1.5 text-[12px] text-attn">confirma</span>}
    </label>
  )

  async function save() {
    if (!canSave || savedMinutes == null || !draft) return
    const saved = await saveWorkout(
      {
        type,
        sport: type === 'other' ? draft.kind : null,
        minutes: savedMinutes,
        started_at: startedAt,
        started_at_estimated: !draft.time && startedAt != null,
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
    if (saved) sheet.close()
  }

  return (
    <BottomSheet
      title="Confirmar treino"
      onClose={sheet.close}
      footer={
        <BusyButton
          busy="A guardar…"
          disabled={!canSave}
          onClick={save}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          {merging ? `Juntar à ${workoutTitle(candidate!).toLowerCase()}` : `Guardar${kcal.kcal > 0 ? ` · +${fmtKcal(kcal.kcal)}` : ''}`}
        </BusyButton>
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
                void runBusy('A enviar o print…', () => addMore(files))
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
              <button onClick={() => setMerge(true)} className={`${chip(merge, 'cta')} !rounded-xl !py-3 text-left`}>
                Juntar à {workoutTitle(candidate).toLowerCase()} das{' '}
                {timeOf(candidate.started_at ?? candidate.created_at)} ({candidate.minutes} min)
              </button>
              <button onClick={() => setMerge(false)} className={`${chip(!merge, 'cta')} !rounded-xl !py-3 text-left`}>
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

        {!merging && (
          <div className="flex flex-wrap gap-2">
            {KINDS.map(([k, label]) => (
              <button key={k} onClick={() => set({ kind: k })} className={chip(draft.kind === k, 'cta')}>
                {label}
              </button>
            ))}
          </div>
        )}

        {!merging && (
          <div className="space-y-2">
            <p className="label flex items-center gap-2">
              Dia e hora
              {(low.has('date') || low.has('start_time')) && (
                <span className="rounded bg-attn/15 px-1.5 text-[12px] text-attn">confirma</span>
              )}
            </p>
            <DayChips today={today} value={draft.day} onChange={(day) => set({ day })} tone="cta" />
            {present.has('time') && (
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
            )}
          </div>
        )}

        {/* A juntar, a duração e os watts são os do treino que já lá está:
            não se mostram campos que seriam ignorados (T17). */}
        {merging && (
          <p className="text-[15px] text-dim">
            Duração: {candidate!.minutes ?? '?'} min, a do treino que já lá está
            {candidate!.watts != null ? ` · ${candidate!.watts} W` : ''}.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!merging && input('Duração', 'minutes', type === 'strength' ? 'total_time_s' : 'moving_time_s', 'min')}
          {/* Na bicicleta vem a potência ou as calorias do relógio; sem nenhuma, pedem-se as duas. */}
          {!merging &&
            type === 'bike' &&
            (present.has('watts') || !present.has('kcalDevice')) &&
            input('Potência', 'watts', 'avg_power_w', 'W')}
          {present.has('avgHr') && input('Batimentos médios', 'avgHr', 'avg_hr', 'bpm')}
          {present.has('maxHr') && input('Batimentos máximos', 'maxHr', 'max_hr', 'bpm')}
          {/* No ginásio, só se o print as trouxe (decisão 160): contam por inteiro. */}
          {((type === 'bike' && (present.has('kcalDevice') || !present.has('watts'))) ||
            type === 'other' ||
            (type === 'strength' && present.has('kcalDevice'))) &&
            input('Calorias do relógio', 'kcalDevice', 'calories_device', 'kcal')}
        </div>

        {!merging && type === 'bike' && draft.wattsSource === 'prefill' && (
          <div className="space-y-2">
            <p className="text-[15px]">Qual era a potência na bicicleta?</p>
            <div className="flex flex-wrap gap-2">
              {/* Confirmar os mesmos watts também conta (T13): deixam de ser «≈». */}
              {[...new Set([Number(draft.watts), ...wattsOptions])]
                .filter((w) => w > 0)
                .map((w) => (
                  <button key={w} onClick={() => set({ watts: String(w), wattsSource: 'manual' })} className={chip(false, 'cta')}>
                    {String(w) === draft.watts ? `Sim, ${w} W` : `${w} W`}
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
        {/* Longe do Guardar e com Anular (T17). */}
        <BusyButton busy="A descartar…" onClick={discard} className="min-h-11 w-full text-[15px] text-pain">
          Descartar este print
        </BusyButton>
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

// O tipo de um treino guardado, como nos chips (bicicleta, ginásio ou o desporto).
function kindOf(w: Workout): Kind {
  if (w.type !== 'other') return w.type
  const sport = w.sport ?? w.raw?.sport
  return isOtherSport(sport) ? sport : 'outro'
}
const clock = (w: Workout) => (w.started_at && !startGuessed(w) ? timeOf(w.started_at) : '')

function WorkoutDetail({ id }: { id: string }) {
  const sheet = useSheet()
  const [, navigate] = useLocation()
  const toast = useToast()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [workout, setWorkout] = useState<Workout | null | undefined>(undefined)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [minutes, setMinutes] = useState('')
  const [watts, setWatts] = useState('')
  const [avgHr, setAvgHr] = useState('')
  const [maxHr, setMaxHr] = useState('')
  // Corrigir as calorias do relógio de um treino guardado (T17).
  const [kcalDevice, setKcalDevice] = useState('')
  // Corrigir o tipo, o dia e a hora (ex.: a elíptica que entrou como bicicleta).
  const [kind, setKind] = useState<Kind>('bike')
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [templates, setTemplates] = useState<Favorite[]>([])
  // O mesmo treino registado duas vezes nesse dia: «Juntar os dois» (T1).
  const [pair, setPair] = useState<[Workout, Workout] | null>(null)
  const plan = usePlanoTreino()

  // `keepEdits`: depois de um toque que grava logo («Qual dos teus treinos
  // foi?», «Qual foi?»), o que estava a ser corrigido e ainda não foi
  // guardado fica nos campos (antes voltava ao que estava; T17).
  const load = useCallback(async (keepEdits = false) => {
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
    if (w && !w.deleted_at) {
      const { data: sameDay } = await supabase.from('workouts_active').select('*').eq('date', w.date)
      setPair(duplicatePairs((sameDay ?? []) as Workout[]).find(([a, b]) => a.id === w.id || b.id === w.id) ?? null)
    }
    if (w && !keepEdits) {
      setMinutes(str(w.minutes))
      setWatts(str(w.watts))
      setAvgHr(str(w.avg_hr))
      setMaxHr(str(w.max_hr))
      setKcalDevice(str(w.kcal_device ?? w.raw?.calories ?? null))
      setKind(kindOf(w))
      setDay(w.date)
      setTime(clock(w))
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
  const asked = plan != null && askWhichWorkout([w], today).length > 0
  const kindChanged = kind !== kindOf(w)
  const kcalChanged = kcalDevice !== str(w.kcal_device ?? w.raw?.calories ?? null) && (toInt(kcalDevice) ?? 0) > 0
  const whenChanged = day !== w.date || time !== clock(w)
  const dirty =
    minutes !== str(w.minutes) ||
    watts !== str(w.watts) ||
    avgHr !== str(w.avg_hr) ||
    maxHr !== str(w.max_hr) ||
    kcalChanged ||
    kindChanged ||
    whenChanged
  const type: Workout['type'] = kind === 'bike' || kind === 'strength' ? kind : 'other'
  // Sem hora escrita, as 18:00 desse dia (hora suposta).
  const when = () =>
    time
      ? { started_at: instantInNutritionalDay(day, time, profile.nutrition_day_cutoff_hour).toISOString(), started_at_estimated: false }
      : { started_at: lisbonInstant(day, '18:00').toISOString(), started_at_estimated: true }
  const at = w.started_at ?? w.created_at
  const deviceCalories = w.kcal_device ?? w.raw?.calories ?? null

  async function patch(body: Record<string, unknown>, message: string, keepEdits = false) {
    try {
      await postApi('/api/workout/update', { workout_id: w.id, ...body })
      emitDataChanged()
      await load(keepEdits)
      toast(message)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar.')
    }
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
          <BusyButton
            busy="A guardar…"
            onClick={() =>
              patch(
                {
                  minutes: toInt(minutes) ?? undefined,
                  ...(type === 'bike' && (watts !== str(w.watts) || kindChanged) ? { watts: toInt(watts) } : {}),
                  avg_hr: toInt(avgHr),
                  max_hr: toInt(maxHr),
                  ...(kcalChanged ? { kcal_device: toInt(kcalDevice) } : {}),
                  ...(kindChanged ? { type, sport: type === 'other' ? kind : null } : {}),
                  ...(whenChanged ? when() : {}),
                },
                'Guardado.',
              )
            }
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            Guardar alterações
          </BusyButton>
        ) : undefined
      }
    >
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[15px] text-dim">
            {fmtDayShort(w.date)}
            {startGuessed(w) ? '' : ` · ${timeOf(at)}`} ·{' '}
            {w.favorite_id ? 'teu treino' : (SOURCE_LABEL[w.source] ?? w.source)}
            {(w.merged_from?.length ?? 0) > 0 ? ' · com print' : ''}
          </p>
          <p className="num text-[40px] leading-tight text-burn">
            {w.kcal_estimated ? '≈ ' : ''}+{fmtKcal(w.kcal_est ?? 0)} <span className="text-[20px] text-dim">kcal do treino</span>
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

        {pair && (
          <div className="space-y-2 rounded-2xl border border-attn/50 bg-attn/10 p-3">
            <p className="label text-attn">Possível duplicado</p>
            <Duplicado
              a={pair[0]}
              b={pair[1]}
              compact
              onSeparated={() => void load()}
              onJoined={(kept) => (kept.id === w.id ? void load() : sheet.open('confirmar-treino', { id: kept.id }))}
            />
          </div>
        )}

        {/* Com plano de treino, um treino automático sem resposta pergunta «Qual foi?» com os dias do plano (decisão 306). */}
        {asked && (
          <div className="space-y-2">
            <p className="label">Qual foi?</p>
            <QualFoiQuestion workout={w} onDone={() => void load(dirty)} />
          </div>
        )}

        {!asked && !w.deleted_at && templates.length > 0 && (
          <div className="space-y-2">
            <p className="label">{w.favorite_id ? 'Treino' : 'Qual dos teus treinos foi?'}</p>
            <div className="flex flex-wrap gap-2">
              {sortTemplates(templates, w).map((f) => (
                <button
                  key={f.id}
                  onClick={() =>
                    void runBusy('A guardar…', () =>
                      patch(
                        { favorite_id: w.favorite_id === f.id ? null : f.id },
                        w.favorite_id === f.id ? 'Tirado.' : `Agora é «${f.name}».`,
                        dirty,
                      ),
                    )
                  }
                  className={chip(w.favorite_id === f.id, 'cta')}
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
            <BusyButton
              busy="A repor…"
              onClick={async () => {
                await postApi('/api/workout/restore', { workout_id: w.id })
                emitDataChanged()
                await load()
              }}
              className="min-h-12 w-full rounded-xl border border-line text-[15px]"
            >
              Repor
            </BusyButton>
          </div>
        ) : (
          <>
            <Thumbs paths={thumbs} />
            <div className="grid grid-cols-2 gap-3">
              {numberField('Duração', minutes, setMinutes, 'min')}
              {type === 'bike' && (w.watts != null || deviceCalories == null || kindChanged) && numberField('Potência', watts, setWatts, 'W')}
              {/* Na bicicleta pedem-se sempre: sem os dois a potência não sobe. */}
              {(type === 'bike' || w.avg_hr != null) && numberField('Batimentos médios', avgHr, setAvgHr, 'bpm')}
              {(type === 'bike' || w.max_hr != null) && numberField('Batimentos máximos', maxHr, setMaxHr, 'bpm')}
              {(deviceCalories != null || type !== 'bike') && numberField('Calorias do relógio', kcalDevice, setKcalDevice, 'kcal')}
            </div>
            {/* Os watts supostos («≈ da última sessão») confirmam-se num toque,
                sem ter de escrever outro número e voltar ao mesmo (T13). */}
            {type === 'bike' && !kindChanged && w.watts_source === 'prefill' && w.watts != null && watts === str(w.watts) && (
              <div className="space-y-1">
                <BusyButton
                  busy="A guardar…"
                  onClick={() => patch({ watts: w.watts }, `Confirmado: ${w.watts} W.`, true)}
                  className="min-h-12 w-full rounded-xl border border-line text-[15px]"
                >
                  Foi isso: confirmar {w.watts} W
                </BusyButton>
                <p className="text-[13px] text-dim">≈ {w.watts} W da última sessão: confirmados, contam para subir a potência.</p>
              </div>
            )}
            {/* A nota que disseste ou escreveste («senti o ombro no fim»; T18). */}
            {w.note && (
              <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px]">
                <span className="label mr-2">Nota</span>
                {w.note}
              </p>
            )}

            <details className="text-[15px]">
              <summary className="cursor-pointer text-dim">Mudar o tipo, o dia ou a hora</summary>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {KINDS.map(([k, label]) => (
                    <button key={k} onClick={() => setKind(k)} className={chip(kind === k, 'cta')}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-dim">
                  <input
                    type="date"
                    value={day}
                    max={today}
                    onChange={(e) => e.target.value && setDay(e.target.value)}
                    className="h-11 rounded-xl border border-line bg-bg px-3 text-[17px] text-ink"
                    aria-label="Dia do treino"
                  />
                  <label className="flex items-center gap-2">
                    às
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-11 rounded-xl border border-line bg-bg px-3 text-[17px] text-ink"
                      aria-label="Hora de início"
                    />
                  </label>
                  {!time && <span className="text-[13px]">(sem hora: 18:00)</span>}
                </div>
                {w.type === 'strength' && type !== 'strength' && (
                  <p className="text-[13px] text-attn">As séries registadas ficam, mas deixam de aparecer no ginásio.</p>
                )}
              </div>
            </details>
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
              {/* O print junta-se a este treino, mesmo com outra duração (T14). */}
              <ShotButton
                target={w.id}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line text-[15px]"
              >
                <Icon name="watch" size={18} /> Juntar print a este
              </ShotButton>
              <button
                onClick={() => {
                  sheet.close()
                  void runBusy('A apagar…', () => deleteWorkout(w, toast))
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
