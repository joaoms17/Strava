import { useEffect, useRef, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import KneePicker from '../ui/KneePicker'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { recomputeFrom } from '../../lib/recompute'
import { localCalendarDate, shiftDate } from '../../lib/day'
import { fmt1, parseDecimal } from '../../lib/format'
import { checkWeighing, trend7 } from '../../../api/_lib/rules/weight'
import type { WeightRow, Workout } from '../../lib/types'

type Stage =
  | { kind: 'input' }
  | { kind: 'check'; value: number; suggestion: number | null }
  | { kind: 'saved'; trend: number | null; kg: number }

const TYPE_LABEL: Record<Workout['type'], string> = {
  bike: 'da bicicleta',
  strength: 'do ginásio',
  other: 'do treino',
}

// Pesagem em 2 toques mais o número, sem gravar sem querer o peso de ontem.
export default function WeighSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = localCalendarDate()
  const [date, setDate] = useState(sheet.params.get('data') ?? today)
  const [value, setValue] = useState(sheet.params.get('valor') ?? '')
  const [fatPct, setFatPct] = useState('')
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [pendingKnee, setPendingKnee] = useState<Workout | null>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'input' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const [{ data: rows }, { data: yesterdayWorkouts }] = await Promise.all([
        supabase
          .from('weights')
          .select('date,kg,body_fat_pct')
          .gte('date', shiftDate(today, -60))
          .order('date'),
        supabase
          .from('workouts_active')
          .select('*')
          .eq('date', shiftDate(today, -1))
          .is('pain_next_day', null),
      ])
      setWeights(((rows ?? []) as WeightRow[]).map((w) => ({ ...w, kg: Number(w.kg) })))
      setPendingKnee(((yesterdayWorkouts ?? []) as Workout[])[0] ?? null)
    }
    void load()
  }, [today])

  const before = weights.filter((w) => w.date !== date && w.date < date)
  const last = before[before.length - 1] ?? null
  const trendSeries = trend7(before.map((w) => ({ date: w.date, value: w.kg })))
  const reference = trendSeries[trendSeries.length - 1]?.value ?? last?.kg ?? null
  const existing = weights.find((w) => w.date === date) ?? null

  function step(delta: number) {
    const current = value.trim() ? parseDecimal(value) : (last?.kg ?? NaN)
    if (!Number.isFinite(current)) return
    setValue(fmt1(current + delta))
  }

  async function save(kg: number) {
    setBusy(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      setError('Sessão expirada. Volta a entrar.')
      return
    }
    const fat = parseDecimal(fatPct)
    const { error: upsertError } = await supabase.from('weights').upsert(
      {
        user_id: user.id,
        date,
        kg,
        source: 'manual',
        measured_at: new Date().toISOString(),
        ...(profile.scale_has_bodyfat && Number.isFinite(fat) && fat > 2 && fat < 70
          ? { body_fat_pct: fat }
          : {}),
      },
      { onConflict: 'user_id,date' },
    )
    setBusy(false)
    if (upsertError) {
      setError('Não consegui guardar. Tenta outra vez.')
      return
    }
    emitDataChanged()
    // Uma pesagem num dia passado muda o peso médio e o gasto dos dias seguintes.
    recomputeFrom(date, today)

    const series = trend7(
      [...weights.filter((w) => w.date !== date), { date, kg }]
        .filter((w) => w.date <= date)
        .map((w) => ({ date: w.date, value: w.kg })),
    )
    const trend = series[series.length - 1]?.value ?? null
    const undo = async () => {
      if (existing) {
        await supabase
          .from('weights')
          .update({ kg: existing.kg, body_fat_pct: existing.body_fat_pct ?? null })
          .eq('user_id', user.id)
          .eq('date', date)
      } else {
        await supabase.from('weights').delete().eq('user_id', user.id).eq('date', date)
      }
      emitDataChanged()
    }
    const text = `Guardado${trend != null && series.length >= 3 ? ` · peso médio ${fmt1(trend)}` : ''}`
    toast(text, [{ label: 'Anular', run: undo }])
    if (pendingKnee && date === today) {
      setStage({ kind: 'saved', trend, kg })
    } else {
      sheet.close()
    }
  }

  function submit() {
    const kg = parseDecimal(value)
    if (!Number.isFinite(kg) || kg <= 0) {
      setError('Escreve o peso em kg, por exemplo 84,6.')
      return
    }
    // Primeiro a correção óbvia (854 → 85,4); só depois o que não faz sentido.
    const check = checkWeighing(kg, reference)
    if (check.kind === 'suggest') {
      setStage({ kind: 'check', value: kg, suggestion: check.value })
      return
    }
    if (kg < 30 || kg > 300) {
      setError('Escreve o peso em kg, por exemplo 84,6.')
      return
    }
    if (check.kind === 'ok') void save(Math.round(kg * 10) / 10)
    else setStage({ kind: 'check', value: kg, suggestion: null })
  }

  async function answerKnee(pain: number) {
    if (!pendingKnee) return
    setBusy(true)
    try {
      await postApi('/api/workout/checkin', { workout_id: pendingKnee.id, pain_next_day: pain })
      emitDataChanged()
      sheet.close()
    } catch {
      setError('Não consegui gravar o joelho. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  if (stage.kind === 'saved') {
    const aboveTrend = stage.trend != null && stage.kg - stage.trend > 1
    return (
      <BottomSheet title="Peso guardado" onClose={sheet.close}>
        <div className="space-y-4 pb-2">
          {aboveTrend && (
            <p className="text-[15px] text-dim">
              Subida de água, normal depois de refeições mais salgadas ou de treino de força. Olha
              para o peso médio.
            </p>
          )}
          {pendingKnee && (
            <div className="space-y-2">
              <p className="text-[17px]">E o joelho depois {TYPE_LABEL[pendingKnee.type]} de ontem?</p>
              <KneePicker busy={busy} onAnswer={(pain) => void answerKnee(pain)} />
            </div>
          )}
          {error && <p className="text-[15px] text-pain">{error}</p>}
        </div>
      </BottomSheet>
    )
  }

  if (stage.kind === 'check') {
    return (
      <BottomSheet title="Confirma o peso" onClose={sheet.close}>
        <div className="space-y-3 pb-2">
          {stage.suggestion != null ? (
            <>
              <p className="text-[17px]">Queres dizer {fmt1(stage.suggestion)}?</p>
              <button
                disabled={busy}
                onClick={() => void save(stage.suggestion!)}
                className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
              >
                Sim, {fmt1(stage.suggestion)}
              </button>
              {stage.value >= 30 && stage.value <= 300 ? (
                <button
                  disabled={busy}
                  onClick={() => void save(Math.round(stage.value * 10) / 10)}
                  className="min-h-12 w-full rounded-2xl border border-line text-[15px]"
                >
                  Não, está certo ({fmt1(stage.value)})
                </button>
              ) : (
                <button
                  onClick={() => setStage({ kind: 'input' })}
                  className="min-h-12 w-full rounded-2xl border border-line text-[15px]"
                >
                  Corrigir
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-[17px]">Confirma: {fmt1(stage.value)} kg?</p>
              <button
                disabled={busy}
                onClick={() => void save(Math.round(stage.value * 10) / 10)}
                className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
              >
                Sim, {fmt1(stage.value)} kg
              </button>
              <button
                onClick={() => setStage({ kind: 'input' })}
                className="min-h-12 w-full rounded-2xl border border-line text-[15px]"
              >
                Corrigir
              </button>
            </>
          )}
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet
      title="Peso"
      onClose={sheet.close}
      footer={
        <button
          disabled={busy || !value.trim()}
          onClick={submit}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => step(-0.1)}
            className="h-12 w-12 shrink-0 rounded-xl bg-surface2 text-[17px] tabular-nums"
            aria-label="menos 0,1"
          >
            −0,1
          </button>
          <div className="relative flex-1">
            <input
              ref={input}
              autoFocus
              inputMode="decimal"
              enterKeyHint="done"
              value={value}
              placeholder={last ? fmt1(last.kg) : ''}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              className="h-16 w-full rounded-2xl border border-line bg-bg text-center font-display text-[44px] font-bold tabular-nums placeholder:text-dim/60 focus:border-eat focus:outline-none"
              aria-label="Peso em kg"
            />
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[15px] text-dim">
              kg
            </span>
          </div>
          <button
            onClick={() => step(0.1)}
            className="h-12 w-12 shrink-0 rounded-xl bg-surface2 text-[17px] tabular-nums"
            aria-label="mais 0,1"
          >
            +0,1
          </button>
        </div>
        {last && !value && (
          <p className="text-center text-[13px] text-dim">
            {last.date === shiftDate(date, -1) ? 'ontem' : 'última'} {fmt1(last.kg)}
          </p>
        )}

        <div className="flex gap-2">
          {[0, -1, -2].map((back) => {
            const day = shiftDate(today, back)
            return (
              <button
                key={back}
                onClick={() => setDate(day)}
                className={`rounded-full px-3 py-1.5 text-[15px] ${day === date ? 'bg-eat text-bg' : 'bg-surface2'}`}
              >
                {back === 0 ? 'Hoje' : back === -1 ? 'Ontem' : 'Anteontem'}
              </button>
            )
          })}
        </div>
        {existing && (
          <p className="text-[13px] text-dim">
            Já há {fmt1(existing.kg)} kg neste dia; guardar substitui.
          </p>
        )}

        {profile.scale_has_bodyfat && (
          <label className="flex items-center justify-between gap-3 text-[15px]">
            <span className="text-dim">% de gordura da balança (opcional)</span>
            <input
              inputMode="decimal"
              value={fatPct}
              onChange={(e) => setFatPct(e.target.value.replace(/[^\d.,]/g, ''))}
              className="h-11 w-20 rounded-xl border border-line bg-bg text-center tabular-nums focus:border-eat focus:outline-none"
            />
          </label>
        )}

        <p className="text-[13px] text-dim">De manhã, depois da casa de banho, antes de comer, sem roupa.</p>
        {error && <p className="text-[15px] text-pain">{error}</p>}
      </div>
    </BottomSheet>
  )
}
