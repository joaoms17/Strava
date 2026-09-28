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
import { fmt1, fmtDayMonth, monthLong } from '../lib/format'
import {
  FAST_LOSS_KG_WEEK,
  MIN_WEIGHINGS_FOR_TREND,
  projectWeight,
  trend7,
  weeklyRate,
} from '../../api/_lib/rules/weight'
import type { WeightRow } from '../lib/types'

type Range = '1M' | '3M' | 'Tudo'
const RANGE_DAYS: Record<Range, number | null> = { '1M': 30, '3M': 91, Tudo: null }

function rateText(rate: number): string {
  const abs = fmt1(Math.abs(rate))
  if (Math.abs(rate) < 0.05) return 'estável'
  return rate < 0 ? `a descer ${abs} kg por semana` : `a subir ${abs} kg por semana`
}

// O resultado: peso médio e gráfico. Gordura, massa magra e cintura chegam
// com as medidas (Fase 4).
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
  const todayWeight = weights.find((w) => w.date === today)
  const enough = weights.length >= MIN_WEIGHINGS_FOR_TREND

  const from = RANGE_DAYS[range] != null ? shiftDate(today, -RANGE_DAYS[range]!) : null
  const points = weights
    .filter((w) => from == null || w.date >= from)
    .map((w) => ({
      date: w.date,
      kg: w.kg,
      trend: trend.find((t) => t.date === w.date)?.value,
    }))
  const values = points.flatMap((p) => [p.kg, p.trend ?? p.kg])
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
        {weights.length === 0 ? (
          <p className="text-[15px] text-dim">Pesa-te de manhã. Com 3 pesagens mostro o teu peso médio.</p>
        ) : !enough ? (
          <p className="text-[15px] text-dim">
            Mais {MIN_WEIGHINGS_FOR_TREND - weights.length}{' '}
            {MIN_WEIGHINGS_FOR_TREND - weights.length === 1 ? 'pesagem' : 'pesagens'} e mostro o teu peso médio.
          </p>
        ) : (
          lastTrend && (
            <div className="space-y-1">
              <p className="text-[15px] text-dim">Peso médio</p>
              <p className="text-[48px] leading-none font-bold tracking-tight tabular-nums text-body">
                {fmt1(lastTrend.value)} <span className="text-[22px] font-semibold">kg</span>
              </p>
              {rate != null && <p className="text-[15px]">{rateText(rate)}</p>}
              {todayWeight && !profile.calm_mode && (
                <p className="text-[13px] text-dim tabular-nums">Hoje {fmt1(todayWeight.kg)}</p>
              )}
            </div>
          )
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
                    const point = payload?.[0]?.payload as { date: string; kg: number; trend?: number } | undefined
                    if (!active || !point) return null
                    return (
                      <div
                        className="rounded-xl px-3 py-2 text-[13px] tabular-nums shadow"
                        style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }}
                      >
                        <p className="text-dim">{fmtDayMonth(point.date)}</p>
                        <p>pesagem {fmt1(point.kg)} kg</p>
                        {enough && point.trend != null && <p style={{ color: colors.body }}>peso médio {fmt1(point.trend)} kg</p>}
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
                  stroke="none"
                  isAnimationActive={false}
                  dot={{ r: 3, fill: colors.body, fillOpacity: 0.3, stroke: 'none' }}
                  activeDot={{ r: 4, fill: colors.body, fillOpacity: 0.6, stroke: 'none' }}
                />
                {enough && (
                  <Line
                    dataKey="trend"
                    stroke={colors.body}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {goalText && <p className="text-[15px]">{goalText}</p>}
          <p className="text-[13px] text-dim">O peso de cada dia varia ±1 kg com água e sal. Olha para a linha.</p>
        </section>
      )}
    </div>
  )
}
