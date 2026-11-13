import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton, runBusy } from '../../lib/busy'
import { emitDataChanged } from '../../lib/events'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtKcal, timeOf } from '../../lib/format'
import { addShots, saveWorkout, workoutTitle } from '../../lib/workout-actions'
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
import type { Workout, WorkoutImport } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import { isOtherSport, type OtherSport } from '../../../api/_lib/rules/targets'
import Icon from '../ui/Icon'
import { DayChips, chip } from '../ui/Chips'
import ErrorReason from '../ui/ErrorReason'
import { useWattsChoices } from '../../lib/use-watts'
import { type Kind, KINDS, toInt, str, Thumbs } from './confirm-workout-comum'

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

// Confirmar um print (?import=): rever o que a IA leu, juntá-lo a uma sessão
// já registada ou guardar uma nova. Separada da ConfirmWorkoutSheet (T17).
export default function ImportConfirm({ id, target }: { id: string; target: string | null }) {
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
