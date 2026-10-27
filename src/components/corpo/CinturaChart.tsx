import { useMemo } from 'react'
import { Link } from 'wouter'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useSheet } from '../../lib/sheet'
import { useReadyProfile } from '../../lib/profile'
import { fmt1, fmtDayMonth } from '../../lib/format'
import type { BodyMeasurement } from '../../lib/types'
import { sameWaistSite, targetBodyFatPct, targetWaist, withReferenceNeck, wrongWaistSite } from '../../../api/_lib/rules/composicao'
import { dayNum, fromDayNum, lowest, niceScale } from '../../../api/_lib/rules/graficos'
import { waistMarks, waistReading } from '../../../api/_lib/rules/leituras'
import { ChartCard, Key, Legend, Marks, TICK, TipBox, padBelowTarget, timeAxis, tooltipBase, useChartColors } from '../charts/kit'

const HEIGHT = 190

// Corpo › Medidas › Cintura: as medições (no mesmo sítio da última) do
// período, o alvo tracejado (a cintura da %G alvo) e a mais baixa marcada.
// Com menos de 2 medições no período, as 2 últimas. Um alvo longe dos dados
// (mais de uma marca do eixo abaixo) não estica o eixo: fica um «alvo 87 ↓» no fundo.
export default function CinturaChart({ rows, from, today }: { rows: BodyMeasurement[]; from: string; today: string }) {
  const colors = useChartColors()
  const sheet = useSheet()
  const profile = useReadyProfile()
  const model = useMemo(() => {
    // O pescoço que conta (o habitual, numa leitura que fugiu e não foi confirmada).
    const withWaist = withReferenceNeck(rows).filter((r) => r.waist_cm != null)
    const last = withWaist[withWaist.length - 1]
    if (!last) return null
    const same = withWaist.filter((r) => sameWaistSite(r, last)).map((r) => ({ date: r.date, value: Number(r.waist_cm) }))
    let shown = same.filter((p) => p.date >= from)
    if (shown.length < 2) shown = same.slice(-2)
    const height = Number(profile.height_cm ?? 183)
    const target =
      last.neck_cm != null && !wrongWaistSite(last, profile.sex)
        ? targetWaist(height, Number(last.neck_cm), targetBodyFatPct(profile.sex), profile.sex, last.hips_cm != null ? Number(last.hips_cm) : null)
        : null
    const targetCm = target != null && Number.isFinite(target) ? Math.round(target) : null
    const values = shown.map((p) => p.value)
    const dataScale = niceScale(Math.min(...values), Math.max(...values), 4, 4)
    const showTarget = targetCm != null && dataScale.domain[0] - targetCm <= dataScale.step
    const scale = showTarget
      ? padBelowTarget(niceScale(Math.min(...values, targetCm!), Math.max(...values), 4, 4), targetCm)
      : dataScale
    const start = shown[0]!.date < from ? shown[0]!.date : from
    return {
      points: shown.map((p) => ({ x: dayNum(p.date), cm: p.value })),
      shown,
      reading: waistReading(shown, lowest(same)?.value ?? null, today),
      marks: waistMarks(shown),
      targetCm,
      showTarget,
      scale,
      axis: timeAxis(start, today, 5),
      lastValue: last.waist_cm,
    }
  }, [rows, from, today, profile])

  if (!model) return null
  return (
    <ChartCard
      kicker="Cintura"
      reading={model.reading}
      aside={
        <div className="flex items-end gap-3">
          <p className="num shrink-0 text-[34px] leading-none font-extrabold whitespace-nowrap text-body">
            {fmt1(Number(model.lastValue))}
            <span className="text-[17px] font-semibold">{'\u00a0'}cm</span>
          </p>
          <p className="min-w-0 text-[14px] leading-snug text-dim">
            agora{model.targetCm != null && <> · alvo ~{model.targetCm}&nbsp;cm (a cintura da tua %G alvo)</>}
          </p>
        </div>
      }
      legend={
        <Legend>
          <Key shape="line" color={colors.weight} label="cintura medida" />
          {model.showTarget && <Key shape="dash" color={colors.dim} label="alvo" />}
        </Legend>
      }
      note={
        <div className="space-y-3">
          <p>A cintura em cm é o número mais honesto: não passa por nenhum modelo.</p>
          <div className="grid grid-cols-2 gap-2 text-[15px] text-ink">
            <button onClick={() => sheet.open('medidas')} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta">
              Medir
            </button>
            <Link href="/corpo/medidas" className="flex min-h-12 items-center justify-center rounded-xl border border-line">
              Histórico ›
            </Link>
          </div>
        </div>
      }
    >
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={model.points} margin={{ top: 20, right: 14, bottom: 0, left: 0 }}>
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
                const p = payload?.[0]?.payload as { x: number; cm: number } | undefined
                if (!active || !p) return null
                return <TipBox title={fmtDayMonth(fromDayNum(p.x))} rows={[{ label: 'cintura', value: `${fmt1(p.cm)} cm`, color: colors.weight }]} colors={colors} />
              }}
            />
            {model.showTarget && <ReferenceLine y={model.targetCm!} stroke={colors.dim} strokeDasharray="3 4" strokeWidth={1.5} />}
            <Line dataKey="cm" stroke={colors.weight} strokeWidth={2.5} isAnimationActive={false} dot={{ r: 4, fill: colors.weight, stroke: colors.surface, strokeWidth: 2 }} activeDot={{ r: 6, fill: colors.weight, stroke: colors.surface, strokeWidth: 2 }} />
            <Marks
              marks={model.marks}
              color={colors.weight}
              colors={colors}
              x={(d) => dayNum(d)}
              refs={
                model.targetCm == null
                  ? []
                  : model.showTarget
                    ? [{ y: model.targetCm, text: `alvo ${model.targetCm}`, side: 'left' }]
                    : [{ y: model.targetCm, text: `alvo ${model.targetCm} ↓`, bottom: true }]
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
