import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useReadyProfile } from '../../lib/profile'
import { fmt1, fmtDayMonth } from '../../lib/format'
import type { BodyMeasurement } from '../../lib/types'
import {
  explainMeasurement,
  measurementComposition,
  neckUses,
  sameWaistSite,
  targetBodyFatPct,
  usualNeckLabel,
  withReferenceNeck,
} from '../../../api/_lib/rules/composicao'
import { dayNum, fromDayNum, lowest, niceScale } from '../../../api/_lib/rules/graficos'
import { fatMarks, fatReading } from '../../../api/_lib/rules/leituras'
import { ChartCard, Key, Legend, Marks, TICK, TipBox, padBelowTarget, timeAxis, tooltipBase, useChartColors } from '../charts/kit'
import ExplicacaoGordura from './ExplicacaoGordura'

const HEIGHT = 190

interface FatPoint {
  x: number
  date: string
  value: number
  index: number // em `rows`
  usual: number | null // o pescoço habitual que contou (oco no gráfico)
}

const cm = (n: number) => (Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : fmt1(n))

// Corpo › Medidas › %G ao longo do tempo (decisão 303): a %G de cada
// medição (com a cintura no mesmo sítio da última), o alvo tracejado
// (15 % nos homens, 25 % nas mulheres), o início e a mais baixa marcados.
// As medições em que contou o pescoço habitual ficam com o ponto oco e uma
// nota. Tocar num ponto mostra porque mudou desde a anterior.
export default function GorduraChart({ rows, from, today }: { rows: BodyMeasurement[]; from: string; today: string }) {
  const colors = useChartColors()
  const profile = useReadyProfile()
  const [picked, setPicked] = useState<number | null>(null)
  const height = Number(profile.height_cm ?? 183)
  const model = useMemo(() => {
    const ref = withReferenceNeck(rows)
    const uses = neckUses(rows)
    const all: FatPoint[] = []
    ref.forEach((r, index) => {
      const c = measurementComposition(height, r, profile.sex)
      if (c) all.push({ x: dayNum(r.date), date: r.date, value: Math.round(c.pct * 10) / 10, index, usual: uses[index]?.useUsual ? uses[index]!.used : null })
    })
    const last = all[all.length - 1]
    if (!last) return null
    const same = all.filter((p) => sameWaistSite(rows[p.index]!, rows[last.index]!))
    let shown = same.filter((p) => p.date >= from)
    if (shown.length < 2) shown = same.slice(-2)
    const target = targetBodyFatPct(profile.sex)
    const values = shown.map((p) => p.value)
    const dataScale = niceScale(Math.min(...values), Math.max(...values), 4, 4)
    const showTarget = dataScale.domain[0] - target <= dataScale.step
    const scale = showTarget ? padBelowTarget(niceScale(Math.min(...values, target), Math.max(...values), 4, 4), target) : dataScale
    const start = shown[0]!.date < from ? shown[0]!.date : from
    return {
      shown,
      reading: fatReading(shown, lowest(same)?.value ?? null, today),
      marks: fatMarks(shown),
      target,
      showTarget,
      scale,
      axis: timeAxis(start, today, 5),
      last,
      anyUsual: shown.some((p) => p.usual != null),
    }
  }, [rows, from, today, profile.sex, height])

  if (!model) return null
  const selected = model.shown.find((p) => p.index === picked) ?? model.last
  const pos = model.shown.indexOf(selected)
  const explanation = explainMeasurement(rows, selected.index, height, profile.sex)
  const dot = (props: { cx?: number; cy?: number; index?: number; payload?: FatPoint }) => {
    const p = props.payload
    if (props.cx == null || props.cy == null || !p) return <g key={props.index} />
    const strong = p.index === selected.index
    return (
      <circle
        key={props.index}
        cx={props.cx}
        cy={props.cy}
        r={strong ? 5.5 : 4}
        fill={p.usual != null ? colors.surface : colors.weight}
        stroke={p.usual != null ? colors.weight : colors.surface}
        strokeWidth={p.usual != null ? 2.25 : 2}
      />
    )
  }

  return (
    <ChartCard
      kicker="%G ao longo do tempo"
      reading={model.reading}
      aside={
        <div className="flex items-end gap-3">
          <p className="num shrink-0 text-[34px] leading-none font-extrabold whitespace-nowrap text-body">
            {fmt1(model.last.value)}
            <span className="text-[17px] font-semibold">{' '}%</span>
          </p>
          <p className="min-w-0 text-[14px] leading-snug text-dim">
            agora · alvo {model.target}&nbsp;%{model.last.usual != null && <> · {usualNeckLabel(model.last.usual)}</>}
          </p>
        </div>
      }
      legend={
        <Legend>
          <Key shape="line" color={colors.weight} label="%G pela fita" />
          {model.anyUsual && <Key shape="ring" color={colors.weight} label="com o pescoço habitual" />}
          {model.showTarget && <Key shape="dash" color={colors.dim} label="alvo" />}
        </Legend>
      }
      note={
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-ink">
              {fmtDayMonth(selected.date)} · {fmt1(selected.value)}&nbsp;%
            </p>
            {model.shown.length > 1 && (
              <div className="flex shrink-0 gap-1">
                <button
                  disabled={pos <= 0}
                  onClick={() => setPicked(model.shown[pos - 1]!.index)}
                  aria-label="Medição anterior"
                  className="h-10 w-10 rounded-lg text-[19px] text-dim disabled:opacity-30"
                >
                  ‹
                </button>
                <button
                  disabled={pos >= model.shown.length - 1}
                  onClick={() => setPicked(model.shown[pos + 1]!.index)}
                  aria-label="Medição seguinte"
                  className="h-10 w-10 rounded-lg text-[19px] text-dim disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <div className="text-ink">
            {explanation ? (
              <ExplicacaoGordura explanation={explanation} row={rows[selected.index]} compact />
            ) : (
              <p className="text-[14px] text-dim">A primeira medição: a partir da próxima digo porque mudou.</p>
            )}
          </div>
          <p>
            A fita erra cerca de ±4 pontos, mas acerta na direção ao longo de semanas.
            {model.shown.length > 1 && ' Toca num ponto para veres porque mudou.'}
          </p>
        </div>
      }
    >
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={model.shown}
            margin={{ top: 20, right: 14, bottom: 0, left: 0 }}
            onClick={(state: unknown) => {
              const i = Number((state as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex)
              const p = Number.isInteger(i) ? model.shown[i] : undefined
              if (p) setPicked(p.index)
            }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[model.axis.domain[0] - 1, model.axis.domain[1] + 1]}
              ticks={model.axis.ticks}
              tickFormatter={model.axis.format}
              tick={TICK(colors)}
              axisLine={{ stroke: colors.grid }}
              tickLine={false}
            />
            <YAxis domain={model.scale.domain} ticks={model.scale.ticks} tick={TICK(colors)} axisLine={false} tickLine={false} width={34} />
            <Tooltip
              {...tooltipBase(colors)}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as FatPoint | undefined
                if (!active || !p) return null
                return (
                  <TipBox
                    title={fmtDayMonth(fromDayNum(p.x))}
                    rows={[
                      { label: '%G', value: `${fmt1(p.value)} %`, color: colors.weight },
                      ...(p.usual != null ? [{ label: '', value: `pescoço habitual (${cm(p.usual)} cm)` }] : []),
                    ]}
                    colors={colors}
                  />
                )
              }}
            />
            {model.showTarget && <ReferenceLine y={model.target} stroke={colors.dim} strokeDasharray="3 4" strokeWidth={1.5} />}
            <Line dataKey="value" stroke={colors.weight} strokeWidth={2.5} isAnimationActive={false} dot={dot} activeDot={false} />
            <Marks
              marks={model.marks.map((m) => ({ ...m, strong: m.date === selected.date }))}
              color={colors.weight}
              colors={colors}
              x={(d) => dayNum(d)}
              dots={false}
              avoid={model.shown}
              extraObstacles={[]}
              refs={
                model.showTarget
                  ? [{ y: model.target, text: `alvo ${model.target} %`, side: 'left' }]
                  : [{ y: model.target, text: `alvo ${model.target} % ↓`, bottom: true }]
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
