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
  goalDate,
  trend7,
  weeklyMeans,
  weeklyRate,
} from '../../api/_lib/rules/weight'
import { inWaterPhase } from '../../api/_lib/rules/manutencao'
import Ciclo from '../components/Ciclo'
import type { WeightRow } from '../lib/types'
import CompositionCards from '../components/CompositionCards'
import Evolucao from '../components/Evolucao'

type Range = '1M' | '3M' | 'Tudo'
const RANGE_DAYS: Record<Range, number | null> = { '1M': 30, '3M': 91, Tudo: null }
// O Supabase devolve no máximo 1000 linhas por pedido (sem limite, vinham as
// mais antigas). As 400 mais recentes chegam para o cartão, o ritmo e 1M/3M;
// «Tudo» pede o resto às páginas e, com muitas, mostra a média de cada semana.
const RECENT_WEIGHINGS = 400
const PAGE = 1000
const WEEKLY_ABOVE = 180

function rateText(rate: number): string {
  const abs = fmt1(Math.abs(rate))
  if (Math.abs(rate) < 0.05) return 'estável'
  return rate < 0 ? `a descer ${abs} kg por semana` : `a subir ${abs} kg por semana`
}

// O resultado em 3 cartões: peso médio (com o gráfico), gordura e massa
// magra, e cintura; depois a evolução do relógio e do treino.
export default function Corpo() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const version = useDataVersion()
  const colors = useThemeColors()
  const [weights, setWeights] = useState<WeightRow[] | null>(null)
  const [range, setRange] = useState<Range>('3M')
  const [all, setAll] = useState<WeightRow[] | null>(null)
  const today = localCalendarDate()

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('weights')
      .select('date,kg')
      .order('date', { ascending: false })
      .limit(RECENT_WEIGHINGS)
    setWeights(((data ?? []) as WeightRow[]).map((w) => ({ date: w.date, kg: Number(w.kg) })).reverse())
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    if (range !== 'Tudo') return
    let alive = true
    void (async () => {
      const rows: WeightRow[] = []
      for (;;) {
        const { data, error } = await supabase
          .from('weights')
          .select('date,kg')
          .order('date')
          .range(rows.length, rows.length + PAGE - 1)
        // Sem rede a meio, fica o gráfico com as recentes.
        if (error) return
        if (!data.length) break
        rows.push(...(data as WeightRow[]).map((w) => ({ date: w.date, kg: Number(w.kg) })))
      }
      if (alive) setAll(rows)
    })()
    return () => {
      alive = false
    }
  }, [range, version])

  const derived = useMemo(() => {
    if (!weights) return null
    const series = weights.map((w) => ({ date: w.date, value: w.kg }))
    const trend = trend7(series)
    const rate = weeklyRate(series)
    // Estável há 3 semanas: o peso médio não mexeu mais de 0,3 kg em 21 dias.
    const last = trend[trend.length - 1]
    const threeWeeksAgo = last ? trend.find((p) => p.date >= shiftDate(last.date, -21)) : undefined
    const stable =
      last != null &&
      threeWeeksAgo != null &&
      threeWeeksAgo.date <= shiftDate(last.date, -18) &&
      Math.abs(last.value - threeWeeksAgo.value) < 0.3
    return { trend, rate, stable }
  }, [weights])

  if (!weights || !derived) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  const { trend, rate, stable } = derived
  const target = Number(profile.target_weight_kg)
  const waterPhase = inWaterPhase(profile.maintenance_anchor, today, profile.maintenance_enabled !== false)
  const lastTrend = trend[trend.length - 1]
  const latest = weights[weights.length - 1]
  const previous = weights[weights.length - 2]
  const enough = weights.length >= MIN_WEIGHINGS_FOR_TREND
  const when = (date: string) =>
    date === today ? 'hoje' : date === shiftDate(today, -1) ? 'ontem' : fmtDayShort(date)
  const diff = latest && previous ? Math.round((latest.kg - previous.kg) * 10) / 10 : null

  const from = RANGE_DAYS[range] != null ? shiftDate(today, -RANGE_DAYS[range]!) : null
  const full = range === 'Tudo' ? (all ?? weights) : weights
  const weekly = range === 'Tudo' && full.length > WEEKLY_ABOVE
  const points = weekly ? weeklyMeans(full) : full.filter((w) => from == null || w.date >= from)
  const values = points.map((p) => p.kg)
  const showTarget = values.length > 0 && Math.min(...values) - target < 4
  const yMin = Math.floor(Math.min(...values, showTarget ? target : Infinity) - 0.5)
  const yMax = Math.ceil(Math.max(...values) + 0.5)
  const tickStep = yMax - yMin > 8 ? 2 : 1
  const ticks = Array.from({ length: Math.floor((yMax - yMin) / tickStep) + 1 }, (_, i) => yMin + i * tickStep)

  // Ao ritmo da semana, com pesagens desta semana e fora da fase de água (a
  // descida rápida do início prometia um mês cedo demais); o ano quando não é este.
  let goalText: string | null = null
  const recent = lastTrend != null && lastTrend.date >= shiftDate(today, -7)
  const goal = recent && !waterPhase ? goalDate(lastTrend.date, lastTrend.value, target, rate) : null
  if (goal) {
    const month = Number(goal.slice(5, 7)) - 1
    const endYear = Number(goal.slice(0, 4)) + (month === 11 ? 1 : 0)
    const year = endYear !== Number(today.slice(0, 4)) ? ` de ${endYear}` : ''
    goalText = `Meta: cerca de ${monthLong(month)}–${monthLong((month + 1) % 12)}${year}`
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

        {rate != null && rate < -FAST_LOSS_KG_WEEK && (waterPhase ? (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">
            A descer depressa, mas é normal agora: nas primeiras semanas (da dieta ou depois da manutenção) sai
            sobretudo água.
          </p>
        ) : (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-attn">
            Estás a perder depressa (mais de 0,85 kg por semana). Come um pouco mais para proteger o músculo.
          </p>
        ))}
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
                        <p className="text-dim">{weekly ? `semana de ${fmtDayMonth(point.date)}` : fmtDayMonth(point.date)}</p>
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
                  dot={points.length <= 120 ? { r: 3, fill: colors.body, stroke: 'none' } : false}
                  activeDot={{ r: 5, fill: colors.body, stroke: 'none' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {goalText && <p className="text-[15px]">{goalText}</p>}
          {weekly && <p className="text-[13px] text-dim">Em «Tudo», cada ponto é a média de uma semana.</p>}
          <p className="text-[13px] text-dim">O peso varia ±1 kg de um dia para o outro com água e sal.</p>
        </section>
      )}
      <CompositionCards />
      {profile.sex === 'f' && <Ciclo today={today} />}
      <Evolucao />
    </div>
  )
}
