import { useCallback, useEffect, useState } from 'react'
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
import { nutritionalDay } from '../../lib/day'
import { fmtDayShort, fmtKcal, timeOf } from '../../lib/format'
import { deleteWorkout, workoutTitle } from '../../lib/workout-actions'
import { instantInNutritionalDay, lisbonInstant } from '../../../api/_lib/rules/momentos'
import { kcalExplanation, startGuessed } from '../../../api/_lib/rules/treino'
import type { Favorite, Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import { isOtherSport } from '../../../api/_lib/rules/targets'
import ShotButton from '../ui/ShotButton'
import Icon from '../ui/Icon'
import { chip } from '../ui/Chips'
import { duplicatePairs } from '../../../api/_lib/rules/sessoes'
import Duplicado from '../Duplicado'
import { type Kind, KINDS, toInt, str, SOURCE_LABEL, Thumbs } from './confirm-workout-comum'

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

// O detalhe editável de um treino guardado (?id=). Separada da
// ConfirmWorkoutSheet (T17).
export default function WorkoutDetail({ id }: { id: string }) {
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
        <p className="py-8 text-center text-[0.9375rem] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  if (workout === null) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[0.9375rem] text-dim">Este treino já não existe.</p>
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
    'h-12 w-full rounded-xl border border-line bg-bg px-3 text-[1.0625rem] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none'
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
        <span className="w-10 text-[0.9375rem] text-dim">{unit}</span>
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
            className="min-h-14 w-full rounded-2xl bg-cta font-display text-[1.1875rem] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
          >
            Guardar alterações
          </BusyButton>
        ) : undefined
      }
    >
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[0.9375rem] text-dim">
            {fmtDayShort(w.date)}
            {startGuessed(w) ? '' : ` · ${timeOf(at)}`} ·{' '}
            {w.favorite_id ? 'teu treino' : (SOURCE_LABEL[w.source] ?? w.source)}
            {(w.merged_from?.length ?? 0) > 0 ? ' · com print' : ''}
          </p>
          <p className="num text-[2.5rem] leading-tight text-burn">
            {w.kcal_estimated ? '≈ ' : ''}+{fmtKcal(w.kcal_est ?? 0)} <span className="text-[1.25rem] text-dim">kcal do treino</span>
          </p>
          <p className="text-[0.875rem] text-dim">
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
            <p className="text-[0.9375rem] text-dim">Apagado — não conta para as contas.</p>
            <BusyButton
              busy="A repor…"
              onClick={async () => {
                await postApi('/api/workout/restore', { workout_id: w.id })
                emitDataChanged()
                await load()
              }}
              className="min-h-12 w-full rounded-xl border border-line text-[0.9375rem]"
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
                  className="min-h-12 w-full rounded-xl border border-line text-[0.9375rem]"
                >
                  Foi isso: confirmar {w.watts} W
                </BusyButton>
                <p className="text-[0.8125rem] text-dim">≈ {w.watts} W da última sessão: confirmados, contam para subir a potência.</p>
              </div>
            )}
            {/* A nota que disseste ou escreveste («senti o ombro no fim»; T18). */}
            {w.note && (
              <p className="rounded-xl bg-surface2 px-3 py-2 text-[0.9375rem]">
                <span className="label mr-2">Nota</span>
                {w.note}
              </p>
            )}

            <details className="text-[0.9375rem]">
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
                    className="h-11 rounded-xl border border-line bg-bg px-3 text-[1.0625rem] text-ink"
                    aria-label="Dia do treino"
                  />
                  <label className="flex items-center gap-2">
                    às
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-11 rounded-xl border border-line bg-bg px-3 text-[1.0625rem] text-ink"
                      aria-label="Hora de início"
                    />
                  </label>
                  {!time && <span className="text-[0.8125rem]">(sem hora: 18:00)</span>}
                </div>
                {w.type === 'strength' && type !== 'strength' && (
                  <p className="text-[0.8125rem] text-attn">As séries registadas ficam, mas deixam de aparecer no ginásio.</p>
                )}
              </div>
            </details>
            {(w.cadence != null || w.distance_km != null || w.aerobic_te != null) && (
              <p className="text-[0.875rem] text-dim tabular-nums">
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
                className="min-h-12 w-full rounded-xl border border-line text-[0.9375rem]"
              >
                {w.source === 'intervals' ? 'Registar as séries' : 'Ver e corrigir as séries'}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {/* O print junta-se a este treino, mesmo com outra duração (T14). */}
              <ShotButton
                target={w.id}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line text-[0.9375rem]"
              >
                <Icon name="watch" size={18} /> Juntar print a este
              </ShotButton>
              <button
                onClick={() => {
                  sheet.close()
                  void runBusy('A apagar…', () => deleteWorkout(w, toast))
                }}
                className="min-h-12 rounded-xl border border-line text-[0.9375rem] text-pain"
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
