import { useMemo } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt1, fmtDayMonth, fmtInt } from '../../lib/format'
import { mondayOf } from '../../../api/_lib/rules/manutencao'
import { bestDeficitWeek, mondaysUpTo, weeklyBalance, weeklyReading, type WeekBalance } from '../../../api/_lib/rules/balanco-graficos'
import { niceScale } from '../../../api/_lib/rules/graficos'
import type { Mark } from '../../../api/_lib/rules/leituras'
import type { BalancoLongo } from '../../lib/balanco'
import { LONG_WEEKS } from '../../lib/balanco'
import { ChartCard, EmptyChart, Key, Legend, Marks, TICK, TipBox, axisInt, categoryTicks, tooltipBase, useChartColors } from '../charts/kit'

const Y_WIDTH = 44
const MARGIN = { top: 18, right: 10, bottom: 0, left: 0 }

// Balanço › «Semana a semana»: as últimas 12 semanas, o défice médio por dia
// (barras, dos dias completos) e, por cima, o peso médio de cada semana — a
// prova de que o esforço funciona. Dois gráficos alinhados (o mesmo eixo das
// semanas), em vez de dois eixos no mesmo gráfico, cada um com a sua unidade
// escrita; uma semana sem dias completos tem «–» em vez de barra.
export default function SemanaASemana({ data, today, waterDay }: { data: BalancoLongo; today: string; waterDay?: (d: string) => boolean }) {
  const colors = useChartColors()
  const model = useMemo(() => {
    const mondays = mondaysUpTo(today, LONG_WEEKS)
    const all = weeklyBalance(data.days, data.weights, mondays, today, waterDay)
    // Começa na primeira semana com dados (uma conta nova não fica com 10 semanas vazias).
    const firstIdx = all.findIndex((w) => w.deficit != null || w.kg != null)
    const weeks = firstIdx < 0 ? [] : all.slice(firstIdx)
    const best = bestDeficitWeek(weeks)
    const marks: Mark[] = best ? [{ id: 'melhor', date: best.monday, value: best.deficit!, label: `${fmtInt(best.deficit!)} · melhor semana`, priority: 3, prefer: 'above' }] : []
    const kgs = weeks.filter((w) => w.kg != null).map((w) => w.kg!)
    const defs = weeks.filter((w) => w.deficit != null).map((w) => w.deficit!)
    const kgScale = niceScale(Math.min(...kgs), Math.max(...kgs), 3, 2)
    const defMax = Math.max(100, ...defs)
    const defScale = niceScale(Math.min(0, ...defs), defMax, 4)
    // Sem barra à vista: «–» numa semana sem dias completos, «0» num défice de zero.
    const empty: Mark[] = weeks
      .filter((w) => w.deficit == null || w.deficit === 0)
      .map((w) => ({ id: `vazia-${w.monday}`, date: w.monday, value: 0, label: w.deficit == null ? '–' : '0', priority: 1, prefer: 'above' as const }))
    return {
      weeks,
      marks,
      empty,
      reading: weeklyReading(weeks),
      kgScale,
      defScale: { ...defScale, domain: [defScale.domain[0], Math.max(defScale.domain[1], Math.ceil(defMax * 1.18))] as [number, number] },
      axis: categoryTicks(weeks.map((w) => w.monday), weeks.length >= 8 ? 4 : 5),
      current: mondayOf(today),
      enough: weeks.filter((w) => w.deficit != null).length >= 2,
      hasKg: kgs.length >= 2,
    }
  }, [data, today, waterDay])

  const tip = (w: WeekBalance) => (
    <TipBox
      title={`Semana de ${fmtDayMonth(w.monday)}${w.monday === model.current ? ' (a meio)' : ''}`}
      rows={[
        { label: 'peso médio', value: w.kg != null ? `${fmt1(w.kg)} kg` : '—', color: colors.weight },
        {
          label: w.deficit != null && w.deficit < 0 ? 'kcal/dia acima do gasto' : 'kcal/dia de défice',
          value: w.deficit != null ? fmtInt(Math.abs(w.deficit)) : '—',
          color: colors.burn,
        },
        { label: w.days === 1 ? 'dia completo' : 'dias completos', value: String(w.days) },
      ]}
      colors={colors}
    />
  )

  return (
    <ChartCard
      kicker="Semana a semana"
      reading={model.reading}
      legend={
        model.enough && (
          <Legend>
            <Key shape="line" color={colors.weight} label="peso médio da semana" />
            <Key shape="bar" color={colors.burn} label="défice médio por dia" />
            {model.weeks.some((w) => w.deficit != null && w.deficit < 0) && <Key shape="bar" color={colors.attn} label="acima do gasto" />}
            {model.weeks.some((w) => w.deficit == null) && <span>– semana sem dias completos</span>}
            {model.weeks.some((w) => w.water) && <Key shape="ring" color={colors.weight} label="semana de água (o peso sobe sem ser gordura)" />}
          </Legend>
        )
      }
      note="Só os dias completos contam para o défice (gasto − comido). A semana de hoje ainda vai a meio."
      table={
        model.enough && (
          <table className="mt-1 w-full tabular-nums">
            <thead>
              <tr className="text-left">
                <th className="font-normal">Semana</th>
                <th className="text-right font-normal">Défice/dia</th>
                <th className="text-right font-normal">Peso médio</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {model.weeks
                .slice()
                .reverse()
                .map((w) => (
                  <tr key={w.monday}>
                    <td>{fmtDayMonth(w.monday)}</td>
                    <td className="text-right">{w.deficit != null ? `${fmtInt(w.deficit)} kcal` : '—'}</td>
                    <td className="text-right">
                      {w.kg != null ? `${fmt1(w.kg)} kg` : '—'}
                      {w.water ? ' (água)' : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )
      }
    >
      {!model.enough ? (
        <EmptyChart text="Com 2 semanas de dias completos aparece aqui o défice de cada semana, ao lado do peso médio." height={140} />
      ) : (
        <div className="space-y-2">
          {model.hasKg && (
            <div className="border-b border-line/70 pb-2">
              <p className="pl-1 text-[12px] text-dim">peso médio (kg)</p>
            <div style={{ height: 104 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={model.weeks} margin={{ ...MARGIN, top: 10, bottom: 8 }}>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="monday" tick={false} height={2} axisLine={false} tickLine={false} />
                  <YAxis
                    domain={model.kgScale.domain}
                    ticks={model.kgScale.ticks}
                    tickFormatter={(v: number) => String(v).replace('.', ',')}
                    tick={TICK(colors)}
                    axisLine={false}
                    tickLine={false}
                    width={Y_WIDTH}
                  />
                  <Tooltip {...tooltipBase(colors)} content={({ active, payload }) => (active && payload?.[0] ? tip(payload[0].payload as WeekBalance) : null)} />
                  <Line
                    dataKey="kg"
                    stroke={colors.weight}
                    strokeWidth={2.5}
                    connectNulls
                    isAnimationActive={false}
                    dot={(props: { cx?: number; cy?: number; index?: number; payload?: WeekBalance }) =>
                      props.cx == null || props.cy == null || props.payload?.kg == null ? (
                        <g key={props.index} />
                      ) : (
                        <circle
                          key={props.index}
                          cx={props.cx}
                          cy={props.cy}
                          r={3.5}
                          fill={props.payload.water ? colors.surface : colors.weight}
                          stroke={props.payload.water ? colors.weight : colors.surface}
                          strokeWidth={2}
                        />
                      )
                    }
                    activeDot={{ r: 5, fill: colors.weight, stroke: colors.surface, strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            </div>
          )}
          <p className="pl-1 text-[12px] text-dim">défice por dia (kcal)</p>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={model.weeks} margin={MARGIN} barCategoryGap="24%">
                <CartesianGrid stroke={colors.grid} vertical={false} />
                <XAxis dataKey="monday" ticks={model.axis.ticks} interval={0} tickFormatter={model.axis.format} tick={TICK(colors)} axisLine={{ stroke: colors.grid }} tickLine={false} />
                <YAxis domain={model.defScale.domain} ticks={model.defScale.ticks} tickFormatter={axisInt} tick={TICK(colors)} axisLine={false} tickLine={false} width={Y_WIDTH} />
                <Tooltip {...tooltipBase(colors)} content={({ active, payload }) => (active && payload?.[0] ? tip(payload[0].payload as WeekBalance) : null)} />
                <ReferenceLine y={0} stroke={colors.dim} strokeWidth={1} />
                <Bar dataKey="deficit" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                  {model.weeks.map((w) => (
                    <Cell key={w.monday} fill={w.deficit != null && w.deficit < 0 ? colors.attn : colors.burn} fillOpacity={w.monday === model.current ? 0.45 : 1} />
                  ))}
                </Bar>
                {/* Semanas sem barra: «–» (sem dias completos) ou «0», para não ficarem em branco. */}
                <Marks marks={model.empty} color={colors.dim} colors={colors} x={(d) => d} dots={false} topRoom={0} />
                <Marks marks={model.marks} color={colors.ink} colors={colors} x={(d) => d} avoid={model.weeks.filter((w) => w.deficit != null).map((w) => ({ date: w.monday, value: w.deficit! }))} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </ChartCard>
  )
}
