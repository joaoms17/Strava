import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import {
  Bar as RBar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { loadExpenditure, type ExpenditureContext } from '../lib/expenditure'
import { useDataVersion } from '../lib/events'
import { useThemeColors } from '../lib/colors'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmt1, fmtInt, fmtKcal, fmtRange, weekdayLetter } from '../lib/format'
import { mondayOf, isMaintenanceWeek, maintenanceTarget } from '../../api/_lib/rules/manutencao'
import { storedExerciseKcal } from '../../api/_lib/rules/targets'
import { MIN_COMPLETE_DAYS } from '../../api/_lib/rules/adaptativo'
import {
  COHERENCE_TEXT,
  baseSuggestion,
  coherence,
  kcalOut,
  measuredVsFormula,
  persistentGap,
  weekSentence,
} from '../../api/_lib/rules/gasto'
import { weeklyRate } from '../../api/_lib/rules/weight'
import { belowFloor, weekAverages, type BalanceDay } from '../../api/_lib/rules/balanco'
import type { Meal, Workout } from '../lib/types'
import BalancoMes from '../components/BalancoMes'
import { mergeSessions } from '../../api/_lib/rules/sessoes'

interface WeekData {
  days: (BalanceDay & { out: number })[]
  workouts: Workout[]
  rate: number | null
  tdee: number | null
  completeDays: number
  steps: number | null
  sleep: number | null
  sleepScore: number | null
  expenditure: ExpenditureContext
  firstDate: string | null
  review: string | null
  weeklyGaps: number[]
}

// «Estou a comer menos do que gasto, e o peso confirma?» — uma frase e um gráfico.
export default function Balanco() {
  const profile = useReadyProfile()
  const [, navigate] = useLocation()
  const version = useDataVersion()
  const colors = useThemeColors()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [monday, setMonday] = useState(() => mondayOf(today))
  const [data, setData] = useState<WeekData | null>(null)
  const [details, setDetails] = useState(false)
  const [view, setView] = useState<'semana' | 'mes'>('semana')
  const [birthYear, setBirthYear] = useState('')
  const { update } = useProfile()
  const toast = useToast()
  const sunday = shiftDate(monday, 6)

  const load = useCallback(async () => {
    const [
      { data: meals },
      { data: workouts },
      { data: dayRows },
      { data: weights },
      { data: tdeeRows },
      { count: completeCount },
      { data: health },
      { data: first },
      { data: reviews },
      { data: history },
      expenditure,
    ] = await Promise.all([
      supabase
        .from('meals_counted')
        .select('date,kcal,protein,carbs,fat')
        .gte('date', monday)
        .lte('date', sunday),
      supabase.from('workouts_active').select('*').gte('date', monday).lte('date', sunday),
      supabase.from('days').select('date,flags,kcal_out_est').gte('date', monday).lte('date', sunday),
      supabase
        .from('weights')
        .select('date,kg')
        .gte('date', shiftDate(sunday, -40))
        .lte('date', sunday)
        .order('date'),
      supabase
        .from('days')
        .select('tdee_est')
        .lte('date', sunday)
        .not('tdee_est', 'is', null)
        .order('date', { ascending: false })
        .limit(1),
      supabase.from('days').select('date', { count: 'exact', head: true }).eq('is_complete', true),
      supabase.from('health_daily').select('*').gte('date', monday).lte('date', sunday),
      // Primeira refeição (o histórico importado do relógio cria dias sem comida).
      supabase.from('meals_counted').select('date').order('date').limit(1),
      supabase.from('weekly_reviews').select('text').eq('week_start', monday).eq('kind', 'neutro').limit(1),
      // Para o gasto medido contra a fórmula nas últimas 3 semanas.
      supabase
        .from('days')
        .select('date,tdee_est,formula_base,kcal_exercise,is_complete')
        .gte('date', shiftDate(monday, -35))
        .lt('date', monday)
        .order('date'),
      loadExpenditure(profile, monday),
    ])
    const latestTdee = tdeeRows?.[0]?.tdee_est != null ? Number(tdeeRows[0].tdee_est) : null
    const workoutRows = (workouts ?? []) as Workout[]
    const flagsByDate = new Map(
      (dayRows ?? []).map((d) => [d.date as string, (d.flags ?? []) as string[]]),
    )
    const outByDate = new Map((dayRows ?? []).map((d) => [d.date as string, d.kcal_out_est as number | null]))
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(monday, i)
      const ofDay = ((meals ?? []) as Pick<Meal, 'date' | 'kcal' | 'protein' | 'carbs' | 'fat'>[]).filter(
        (m) => m.date === date,
      )
      const exercise = storedExerciseKcal(
        workoutRows
          .filter((w) => w.date === date)
          .map((w) => ({
            type: w.type,
            minutes: w.minutes,
            watts: w.watts,
            deviceCalories: w.raw?.calories ?? null,
            kcal_est: w.kcal_est,
          })),
      )
      const maintenance =
        profile.maintenance_enabled !== false &&
        profile.maintenance_anchor != null &&
        isMaintenanceWeek(profile.maintenance_anchor, date)
      const sum = (pick: (m: (typeof ofDay)[number]) => number) => ofDay.reduce((a, m) => a + Number(pick(m)), 0)
      return {
        date,
        eaten: sum((m) => m.kcal),
        protein: sum((m) => m.protein),
        carbs: sum((m) => m.carbs),
        fat: sum((m) => m.fat),
        meals: ofDay.length,
        plan: maintenance ? maintenanceTarget(latestTdee) : profile.base_kcal + exercise,
        missingSomething: (flagsByDate.get(date) ?? []).includes('faltou_algo'),
        // Gasto do dia: o guardado pelo fecho do dia ou, na semana em curso, o mesmo cálculo aqui.
        out: outByDate.get(date) ?? kcalOut(expenditure.base, exercise),
      }
    })
    // Gasto medido contra a fórmula, visto em cada uma das últimas 3 segundas-feiras.
    const hist = (history ?? []) as { date: string; tdee_est: number | null; formula_base: number | null; kcal_exercise: number | null; is_complete: boolean }[]
    const weeklyGaps: number[] = []
    for (const back of [14, 7, 0]) {
      const cut = shiftDate(monday, -back)
      const before = hist.filter((d) => d.date < cut)
      const tdee = [...before].reverse().find((d) => d.tdee_est != null)?.tdee_est
      const formula = [...before].reverse().find((d) => d.formula_base != null)?.formula_base
      const trainings = before.filter((d) => d.is_complete).slice(-14).map((d) => Number(d.kcal_exercise ?? 0))
      if (tdee != null && formula != null) {
        const avg = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
        weeklyGaps.push(measuredVsFormula(Number(tdee), Number(formula), avg))
      }
    }
    const healthRows = health ?? []
    const avgOf = (values: (number | null)[]) => {
      const known = values.filter((v): v is number => v != null)
      return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
    }
    setData({
      days,
      workouts: workoutRows,
      rate: weeklyRate(((weights ?? []) as { date: string; kg: number }[]).map((w) => ({ date: w.date, value: Number(w.kg) }))),
      tdee: latestTdee,
      completeDays: completeCount ?? 0,
      steps: avgOf(healthRows.map((h) => h.steps as number | null)),
      sleep: avgOf(healthRows.map((h) => h.sleep_minutes as number | null)),
      sleepScore: avgOf(healthRows.map((h) => (h.sleep_score as number | null | undefined) ?? null)),
      expenditure,
      firstDate: (first?.[0]?.date as string | undefined) ?? null,
      review: (reviews?.[0]?.text as string | undefined) ?? null,
      weeklyGaps,
    })
  }, [monday, sunday, profile])

  useEffect(() => {
    void load()
  }, [load, version])

  const toggle = (
    <div className="grid grid-cols-2 rounded-xl border border-line bg-surface p-1 font-display text-[15px] font-bold tracking-[0.08em] uppercase">
      {(
        [
          ['semana', 'Semana'],
          ['mes', 'Mês'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setView(id)}
          className={`min-h-10 rounded-lg ${view === id ? 'bg-cta text-on-cta' : 'text-dim'}`}
          aria-pressed={view === id}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const header = (
    <div className="flex items-center justify-between">
      <button onClick={() => setMonday(shiftDate(monday, -7))} className="h-11 w-11 text-xl text-dim" aria-label="Semana anterior">
        ‹
      </button>
      <p className="text-[17px] font-semibold tabular-nums">{fmtRange(monday, sunday)}</p>
      <button
        disabled={shiftDate(monday, 7) > today}
        onClick={() => setMonday(shiftDate(monday, 7))}
        className="h-11 w-11 text-xl text-dim disabled:opacity-30"
        aria-label="Semana seguinte"
      >
        ›
      </button>
    </div>
  )

  if (view === 'mes') {
    return (
      <div className="space-y-4 pt-1">
        {toggle}
        <BalancoMes today={today} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4 pt-1">
        {toggle}
        {header}
        <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
      </div>
    )
  }

  const averages = weekAverages(data.days, today)
  const counted = data.days.filter((d) => d.date < today && d.meals > 0 && !d.missingSomething)
  const avgOut = counted.length ? counted.reduce((a, d) => a + d.out, 0) / counted.length : null
  const hasAny = data.days.some((d) => d.meals > 0)
  const rate = data.rate
  const exp = data.expenditure
  const sessions = mergeSessions(data.workouts).length
  const minutes = data.workouts.reduce((a, w) => a + (w.minutes ?? 0), 0)
  const trainingKcal = data.workouts.reduce((a, w) => a + (w.kcal_est ?? 0), 0)
  const missingComplete = Math.max(0, MIN_COMPLETE_DAYS - data.completeDays)
  // A partir da 3.ª semana com dados, a coerência usa o gasto medido até antes da semana.
  const thirdWeek = data.firstDate != null && data.firstDate <= shiftDate(monday, -14)
  const coherent =
    thirdWeek && averages && exp.tdeeFrozen != null && rate != null ? coherence(averages.eaten, exp.tdeeFrozen, rate) : null
  const suggestion = exp.tdeeFrozen != null && !exp.learning ? baseSuggestion(exp.tdeeFrozen, exp.avgTraining, profile.base_kcal) : null
  const gapNote = persistentGap(data.weeklyGaps)
  const chart = data.days.map((d) => ({
    date: d.date,
    label: weekdayLetter(d.date),
    eaten: d.meals > 0 ? Math.round(d.eaten) : null,
    out: d.date <= today ? d.out : null,
    today: d.date === today,
  }))

  async function applyBase(value: number) {
    const previous = profile.base_kcal
    await update({ base_kcal: value })
    toast(`Plano base: ${fmtInt(value)}`, [{ label: 'Anular', run: () => void update({ base_kcal: previous }) }])
  }

  return (
    <div className="space-y-4 pt-1">
      {toggle}
      {header}

      {!hasAny ? (
        <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
          Regista alguns dias e aqui aparece a tua semana.
        </p>
      ) : (
        <>
          <section className="space-y-2 rounded-[18px] border border-line bg-surface p-5">
            {averages && avgOut != null ? (
              <p className="text-[20px] leading-snug font-semibold">{weekSentence(averages.eaten, avgOut, rate)}</p>
            ) : (
              <p className="text-[17px] text-dim">A semana começou agora. A média aparece amanhã.</p>
            )}
            {coherent && (
              <p className={`text-[16px] ${coherent === 'bate_certo' ? 'text-burn' : 'text-dim'}`}>{COHERENCE_TEXT[coherent]}</p>
            )}
            {exp.learning && (
              <p className="text-[14px] text-dim">
                Gasto (a aprender): mais {missingComplete} {missingComplete === 1 ? 'dia completo' : 'dias completos'} e passo
                a medir o teu gasto pelo peso. Até lá uso uma fórmula.
              </p>
            )}
          </section>

          {belowFloor(averages, profile.kcal_floor_week) && (
            <p className="rounded-2xl border border-attn/40 bg-attn/10 px-4 py-3 text-[15px] text-attn">
              Esta semana comeste menos de {fmtInt(profile.kcal_floor_week)} por dia em média. Come um pouco mais:
              perder devagar protege o músculo.
            </p>
          )}

          <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={colors.line} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: colors.dim, fontSize: 13 }} axisLine={{ stroke: colors.line }} tickLine={false} />
                  <YAxis
                    tick={{ fill: colors.dim, fontSize: 12 }}
                    tickFormatter={(v: number) => fmtInt(v)}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <RBar
                    dataKey="eaten"
                    radius={[4, 4, 0, 0]}
                    onClick={(entry: unknown) => {
                      const date = (entry as { payload?: { date?: string } }).payload?.date
                      if (date) navigate(date === today ? '/hoje' : `/hoje/${date}`)
                    }}
                    cursor="pointer"
                    isAnimationActive={false}
                  >
                    {chart.map((d) => (
                      <Cell key={d.date} fill={colors.eat} fillOpacity={d.today ? 0.45 : 1} />
                    ))}
                  </RBar>
                  <Line
                    dataKey="out"
                    stroke={colors.burn}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: colors.burn, stroke: 'none' }}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-[13px] text-dim">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-eat" /> o que comeste
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-burn" /> gasto{exp.learning ? ' (a aprender)' : ''}
              </span>
            </div>
          </section>

          {data.review && (
            <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
              <p className="label">Resumo da semana</p>
              {data.review.split('\n').map((line, i) => (
                <p key={i} className="text-[15px]">
                  {line}
                </p>
              ))}
            </section>
          )}

          <button onClick={() => setDetails(!details)} className="text-[15px] text-dim">
            {details ? 'Esconder detalhes' : 'Ver detalhes ›'}
          </button>

          {details && (
            <section className="space-y-3 rounded-[18px] border border-line bg-surface p-5 text-[15px]">
              {averages && (
                <>
                  <p>Proteína média {fmtInt(averages.protein)} g por dia (meta {fmtInt(profile.protein_g)} g)</p>
                  <p className="text-dim">
                    Hidratos {fmtInt(averages.carbs)} g · Gordura {fmtInt(averages.fat)} g por dia (média)
                  </p>
                </>
              )}
              <p>
                Treino: {sessions} {sessions === 1 ? 'sessão' : 'sessões'} · {fmtInt(minutes)} min
                {trainingKcal > 0 && <span className="text-burn"> · +{fmtKcal(trainingKcal)} no plano</span>}
              </p>
              {exp.tdeeFrozen != null && !exp.learning ? (
                <p>
                  Gasto medido pelo teu peso: cerca de {fmtKcal(exp.tdeeFrozen)} por dia. A fórmula dizia{' '}
                  {fmtKcal(exp.formula + exp.avgTraining)}.
                </p>
              ) : (
                <p className="text-dim">
                  Mais {missingComplete} {missingComplete === 1 ? 'dia completo' : 'dias completos'} e passo a medir o
                  teu gasto pelo peso. Até lá uso uma fórmula ({fmtKcal(exp.formula)} por dia sem treino).
                </p>
              )}
              {gapNote && (
                <p className="text-dim">
                  Pode ser porções maiores do que as fotos mostram, ou um gasto mais baixo do que o normal. A app já usa o
                  valor medido, por isso o plano continua certo.
                </p>
              )}
              {suggestion != null && (
                <div className="space-y-2 rounded-xl bg-surface2 p-3">
                  <p>
                    Para perderes cerca de 0,5 kg por semana, o plano base podia ser {fmtInt(suggestion)} (hoje é{' '}
                    {fmtInt(profile.base_kcal)}).
                  </p>
                  <button
                    onClick={() => void applyBase(suggestion)}
                    className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta"
                  >
                    Aplicar
                  </button>
                </div>
              )}
              {profile.birth_year == null && (
                <label className="block space-y-1">
                  <span>Em que ano nasceste? (opcional, para a fórmula do gasto)</span>
                  <span className="flex gap-2">
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={birthYear}
                      onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ''))}
                      placeholder="1986"
                      className="h-11 w-28 rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums"
                    />
                    <button
                      disabled={birthYear.length !== 4 || Number(birthYear) < 1920 || Number(birthYear) > 2015}
                      onClick={() => void update({ birth_year: Number(birthYear) })}
                      className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40"
                    >
                      Guardar
                    </button>
                  </span>
                </label>
              )}
              {(data.steps != null || data.sleep != null) && (
                <p className="text-dim">
                  {[
                    data.steps != null ? `Passos: ${fmtInt(data.steps)} por dia` : null,
                    data.sleep != null ? `Sono: ${fmt1(data.sleep / 60)} h` : null,
                    data.sleepScore != null ? `qualidade ${Math.round(data.sleepScore)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
