import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useReadyProfile } from '../lib/profile'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import { useThemeColors } from '../lib/colors'
import { localCalendarDate, shiftDate } from '../lib/day'
import { fmt1, fmtDayMonth, fmtDayShort, monthLong } from '../lib/format'
import {
  FAST_LOSS_KG_WEEK,
  MIN_WEIGHINGS_FOR_TREND,
  projectWeight,
  trend7,
  weeklyRate,
} from '../../api/_lib/rules/weight'
import type { WeightRow } from '../lib/types'
import CompositionCards from '../components/CompositionCards'

type Range = '1M' | '3M' | 'Tudo'
const RANGE_DAYS: Record<Range, number | null> = { '1M': 30, '3M': 91, Tudo: null }

function rateText(rate: number): string {
  const abs = fmt1(Math.abs(rate))
  if (Math.abs(rate) < 0.05) return 'estável'
  return rate < 0 ? `a descer ${abs} kg por semana` : `a subir ${abs} kg por semana`
}

// O resultado em 3 cartões: peso médio (com o gráfico), gordura e massa
// magra, e cintura.
export default function Corpo() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const version = useDataVersion()
  const colors = useThemeColors()
  const [weights, setWeights] = useState<WeightRow[] | null>(null)
  const [range, setRange] = useState<Range>('3M')
  const today = localCalendarDate()

  const load = useCallback(async () => {
    const { data } = await supabase.from('weights').select('date,kg').order('date')
    setWeights(((data ?? []) as WeightRow[]).map((w) => ({ date: w.date, kg: Number(w.kg) })))
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  const derived = useMemo(() => {
    if (!weights) return null
    const series = weights.map((w) => ({ date: w.date, value: w.kg }))
    const trend = trend7(series)
    const rate = weeklyRate(series)
    const projection = projectWeight(trend, Number(profile.target_weight_kg))
    // Estável há 3 semanas: o peso médio não mexeu mais de 0,3 kg em 21 dias.
    const last = trend[trend.length - 1]
    const threeWeeksAgo = last ? trend.find((p) => p.date >= shiftDate(last.date, -21)) : undefined
    const stable =
      last != null &&
      threeWeeksAgo != null &&
      threeWeeksAgo.date <= shiftDate(last.date, -18) &&
      Math.abs(last.value - threeWeeksAgo.value) < 0.3
    return { trend, rate, projection, stable }
  }, [weights, profile.target_weight_kg])

  if (!weights || !derived) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  const { trend, rate, projection, stable } = derived
  const target = Number(profile.target_weight_kg)
  const lastTrend = trend[trend.length - 1]
  const latest = weights[weights.length - 1]
  const previous = weights[weights.length - 2]
  const enough = weights.length >= MIN_WEIGHINGS_FOR_TREND
  const when = (date: string) =>
    date === today ? 'hoje' : date === shiftDate(today, -1) ? 'ontem' : fmtDayShort(date)
  const diff = latest && previous ? Math.round((latest.kg - previous.kg) * 10) / 10 : null

  const from = RANGE_DAYS[range] != null ? shiftDate(today, -RANGE_DAYS[range]!) : null
  const points = weights.filter((w) => from == null || w.date >= from)
  const values = points.map((p) => p.kg)
  const showTarget = values.length > 0 && Math.min(...values) - target < 4
  const yMin = Math.floor(Math.min(...values, showTarget ? target : Infinity) - 0.5)
  const yMax = Math.ceil(Math.max(...values) + 0.5)
  const tickStep = yMax - yMin > 8 ? 2 : 1
  const ticks = Array.from({ length: Math.floor((yMax - yMin) / tickStep) + 1 }, (_, i) => yMin + i * tickStep)

  let goalText: string | null = null
  if (projection.targetDate && lastTrend && lastTrend.value > target) {
    const month = Number(projection.targetDate.slice(5, 7)) - 1
    goalText = `Meta: cerca de ${monthLong(month)}–${monthLong((month + 1) % 12)}`
  }

  return (
    <div className="space-y-4 pt-1">
      <section className="space-y-4 rounded-3xl bg-surface p-5">
        {!latest ? (
          <p className="text-[15px] text-dim">Pesa-te de manhã, antes de comer.</p>
        ) : profile.calm_mode && enough && lastTrend ? (
          // Modo calmo: sem o peso de cada dia, só a média da semana.
          <div className="space-y-1">
            <p className="label">Peso médio</p>
            <p className="num text-[64px] leading-none font-extrabold text-body">
              {fmt1(lastTrend.value)} <span className="text-[22px] font-semibold">kg</span>
            </p>
            {rate != null && <p className="text-[15px]">{rateText(rate)}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="label">Último peso · {when(latest.date)}</p>
            <p className="num text-[64px] leading-none font-extrabold text-body">
              {fmt1(latest.kg)} <span className="text-[22px] font-semibold">kg</span>
            </p>
            {diff != null && previous && (
              <p className="text-[15px] tabular-nums">
                {diff === 0
                  ? `Igual a ${when(previous.date)}`
                  : `${diff < 0 ? '−' : '+'}${fmt1(Math.abs(diff))} kg desde ${when(previous.date)}`}
              </p>
            )}
            {rate != null && <p className="text-[13px] text-dim">{rateText(rate)}</p>}
          </div>
        )}

        {rate != null && rate < -FAST_LOSS_KG_WEEK && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-attn">
            Estás a perder depressa (mais de 0,85 kg por semana). Come um pouco mais para proteger o músculo.
          </p>
        )}
        {stable && rate != null && Math.abs(rate) < 0.1 && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">
            Peso estável há 3 semanas. A app ajusta o gasto sozinha.
          </p>
        )}

        <button
          onClick={() => sheet.open('peso')}
          className="min-h-12 w-full rounded-2xl bg-surface2 text-[15px] font-semibold"
        >
          Pesar
        </button>
      </section>

      {weights.length >= 2 && (
        <section className="space-y-3 rounded-3xl bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Peso</h2>
            <div className="flex rounded-lg bg-surface2 p-0.5 text-[13px]">
              {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`min-h-8 rounded-md px-3 ${range === r ? 'bg-surface font-semibold' : 'text-dim'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.line} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => fmtDayMonth(d)}
                  tick={{ fill: colors.dim, fontSize: 12 }}
                  axisLine={{ stroke: colors.line }}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  ticks={ticks}
                  tickFormatter={(v: number) => String(v)}
                  tick={{ fill: colors.dim, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  cursor={{ stroke: colors.line }}
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as { date: string; kg: number } | undefined
                    if (!active || !point) return null
                    return (
                      <div
                        className="rounded-xl px-3 py-2 text-[13px] tabular-nums shadow"
                        style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }}
                      >
                        <p className="text-dim">{fmtDayMonth(point.date)}</p>
                        <p>{fmt1(point.kg)} kg</p>
                      </div>
                    )
                  }}
                />
                {showTarget && (
                  <ReferenceLine
                    y={target}
                    stroke={colors.dim}
                    strokeDasharray="3 5"
                    label={{ value: `meta ${fmt1(target)}`, position: 'insideBottomLeft', fill: colors.dim, fontSize: 12 }}
                  />
                )}
                <Line
                  dataKey="kg"
                  stroke={colors.body}
                  strokeWidth={2.5}
                  isAnimationActive={false}
                  dot={{ r: 3, fill: colors.body, stroke: 'none' }}
                  activeDot={{ r: 5, fill: colors.body, stroke: 'none' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {goalText && <p className="text-[15px]">{goalText}</p>}
          <p className="text-[13px] text-dim">O peso varia ±1 kg de um dia para o outro com água e sal.</p>
        </section>
      )}
      <CompositionCards />
    </div>
  )
}
