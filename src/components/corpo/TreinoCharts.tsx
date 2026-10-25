import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDayMonth, fmtInt } from '../../lib/format'
import { shiftDate } from '../../lib/day'
import type { CorpoData } from '../../lib/corpo'
import { fitnessSeries, preferIcuForm, weeklyStats } from '../../../api/_lib/rules/plano'
import { mondayOf } from '../../../api/_lib/rules/manutencao'
import { dayNum, fromDayNum, niceScale, type Period } from '../../../api/_lib/rules/graficos'
import { bestFormMonth, bestWeek, formMarks, formReading, trainingReading, type Mark } from '../../../api/_lib/rules/leituras'
import { BAND_OPACITY, ChartCard, EmptyChart, Key, Legend, Marks, TICK, TipBox, categoryTicks, timeAxis, tooltipBase, useChartColors } from '../charts/kit'

const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// As segundas-feiras de `from` a hoje.
function mondaysFrom(from: string, today: string): string[] {
  const list: string[] = []
  for (let m = mondayOf(from); m <= today; m = shiftDate(m, 7)) list.push(m)
  return list
}

// Corpo › Treino: minutos por semana (bicicleta e ginásio, a melhor semana
// marcada) e a forma (carga de 42 dias) com a fadiga, o pico e o melhor mês.
export default function TreinoCharts({ data, period, from, today }: { data: CorpoData; period: Period; from: string; today: string }) {
  const colors = useChartColors()
  const model = useMemo(() => {
    // Para a frase, todas as semanas lidas (no 1M compara com as 4 antes).
    const loadedFrom = data.workouts[0]?.date ?? from
    const allMondays = mondaysFrom(loadedFrom < from ? loadedFrom : from, today)
    const stats = weeklyStats(data.workouts, allMondays).map((w) => ({ monday: w.start, bike: w.bike.minutes, gym: w.gym.minutes, sessions: w.bike.sessions + w.gym.sessions }))
    const current = mondayOf(today)
    const weeks = stats.filter((w) => w.monday >= mondayOf(from))
    const best = bestWeek(weeks.filter((w) => w.monday < current))
    const bestMarks: Mark[] = best ? [{ id: 'melhor', date: best.monday, value: best.bike + best.gym, label: `${best.bike + best.gym} min · melhor semana`, priority: 3, prefer: 'above' }] : []
    const reading = trainingReading(stats, current, period, from, today)
    const yMax = Math.max(60, ...weeks.map((w) => w.bike + w.gym))
    const yScale = niceScale(0, yMax, 4)
    // Espaço por cima das barras para o rótulo da melhor semana.
    const yTop = Math.max(yScale.domain[1], Math.ceil(yMax * 1.14))

    // A forma começa 6 semanas antes, para não arrancar do zero; a do
    // intervals.icu (com o histórico todo) quando cobre o período.
    const local = fitnessSeries(data.workouts, shiftDate(from, -41), today).filter((p) => p.date >= from)
    const icu = data.health.map((h) => ({ date: h.date, ctl: h.ctl, atl: h.atl }))
    const { points: form, source } = preferIcuForm(local, icu)
    const formPts = form.map((p) => ({ date: p.date, ctl: p.ctl, atl: p.atl }))
    const month = period === '1M' ? null : bestFormMonth(formPts)
    const vo2 = [...data.health].reverse().find((h) => h.vo2max != null)?.vo2max ?? null
    const formMax = Math.max(10, ...formPts.map((p) => Math.max(p.ctl, p.atl)))
    const formMin = Math.min(...formPts.map((p) => Math.min(p.ctl, p.atl)))
    return {
      weeks,
      current,
      axis: categoryTicks(weeks.map((w) => w.monday), 4),
      bestMarks,
      reading,
      yScale: { ...yScale, domain: [0, yTop] as [number, number] },
      form: formPts.map((p) => ({ ...p, x: dayNum(p.date) })),
      formReading: formReading(formPts, period, today),
      formMarks: formMarks(formPts),
      formAxis: timeAxis(from, today, 5),
      formScale: niceScale(Math.max(0, formMin - 3), formMax + 2, 4, 10),
      month,
      source,
      vo2,
      hasWeeks: weeks.some((w) => w.bike + w.gym > 0),
      hasForm: formPts.some((p) => p.ctl > 0),
    }
  }, [data, period, from, today])

  return (
    <div className="space-y-3">
      <ChartCard
        kicker="Minutos de treino por semana"
        reading={model.reading}
        legend={
          model.hasWeeks && (
            <Legend>
              <Key shape="bar" color={colors.bike} label="Bicicleta" />
              <Key shape="bar" color={colors.gym} label="Ginásio" />
            </Legend>
          )
        }
        note={model.hasWeeks && 'A semana de hoje (mais clara) ainda vai a meio.'}
        table={
          model.hasWeeks && (
            <table className="mt-1 w-full tabular-nums">
              <thead>
                <tr className="text-left">
                  <th className="font-normal">Semana</th>
                  <th className="text-right font-normal">Bicicleta</th>
                  <th className="text-right font-normal">Ginásio</th>
                  <th className="text-right font-normal">Sessões</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {model.weeks
                  .slice()
                  .reverse()
                  .map((w) => (
                    <tr key={w.monday}>
                      <td>{fmtDayMonth(w.monday)}</td>
                      <td className="text-right">{w.bike} min</td>
                      <td className="text-right">{w.gym} min</td>
                      <td className="text-right">{w.sessions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )
        }
      >
        {!model.hasWeeks ? (
          <EmptyChart text="Ainda sem treinos neste período" height={200} />
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.weeks} margin={{ top: 20, right: 6, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke={colors.grid} vertical={false} />
                <XAxis dataKey="monday" ticks={model.axis.ticks} interval={0} tickFormatter={model.axis.format} tick={TICK(colors)} axisLine={{ stroke: colors.grid }} tickLine={false} />
                <YAxis domain={model.yScale.domain} ticks={model.yScale.ticks} tick={TICK(colors)} axisLine={false} tickLine={false} width={34} />
                <Tooltip
                  {...tooltipBase(colors)}
                  content={({ active, payload }) => {
                    const w = payload?.[0]?.payload as (typeof model.weeks)[number] | undefined
                    if (!active || !w) return null
                    return (
                      <TipBox
                        title={`Semana de ${fmtDayMonth(w.monday)}${w.monday === model.current ? ' (a meio)' : ''}`}
                        rows={[
                          { label: 'bicicleta', value: `${w.bike} min`, color: colors.bike },
                          { label: 'ginásio', value: `${w.gym} min`, color: colors.gym },
                          { label: w.sessions === 1 ? 'sessão' : 'sessões', value: String(w.sessions) },
                        ]}
                        colors={colors}
                      />
                    )
                  }}
                />
                <Bar dataKey="bike" stackId="t" fill={colors.bike} maxBarSize={24} stroke={colors.surface} strokeWidth={model.weeks.length > 20 ? 0 : 2} isAnimationActive={false}>
                  {model.weeks.map((w) => (
                    <Cell key={w.monday} fillOpacity={w.monday === model.current ? 0.45 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="gym" stackId="t" fill={colors.gym} maxBarSize={24} stroke={colors.surface} strokeWidth={model.weeks.length > 20 ? 0 : 2} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {model.weeks.map((w) => (
                    <Cell key={w.monday} fillOpacity={w.monday === model.current ? 0.45 : 1} />
                  ))}
                </Bar>
                <Marks marks={model.bestMarks} color={colors.ink} colors={colors} x={(d) => d} avoid={model.weeks.map((w) => ({ date: w.monday, value: w.bike + w.gym }))} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {model.hasForm && (
        <ChartCard
          kicker="Forma (carga dos últimos 42 dias)"
          reading={model.formReading}
          legend={
            <Legend>
              <Key shape="line" color={colors.bike} label="forma (42 dias)" />
              <Key shape="line" color={colors.dim} label="fadiga (7 dias)" />
              {model.month && <Key shape="band" color={colors.dim} label="melhor mês" />}
            </Legend>
          }
          note={
            <>
              Sobe com o treino feito com regularidade{model.source === 'intervals' ? ' (do intervals.icu)' : ''}.
              {model.vo2 != null && ` VO2máx do relógio: ${Math.round(Number(model.vo2))}.`}
            </>
          }
        >
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={model.form} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.grid} vertical={false} />
                {model.month && (
                  <ReferenceArea
                    x1={dayNum(model.month.from)}
                    x2={dayNum(model.month.to)}
                    fill={colors.dim}
                    fillOpacity={BAND_OPACITY}
                    stroke="none"
                    label={{
                      value: `${MONTHS_LONG[Number(model.month.month.slice(5, 7)) - 1]} +${Math.round(model.month.gain)}`,
                      position: 'insideBottom',
                      fill: colors.dim,
                      fontSize: 12,
                    }}
                  />
                )}
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[model.formAxis.domain[0], model.formAxis.domain[1] + 1]}
                  ticks={model.formAxis.ticks}
                  tickFormatter={model.formAxis.format}
                  tick={TICK(colors)}
                  axisLine={{ stroke: colors.grid }}
                  tickLine={false}
                />
                <YAxis domain={model.formScale.domain} ticks={model.formScale.ticks} tick={TICK(colors)} axisLine={false} tickLine={false} width={34} />
                <Tooltip
                  {...tooltipBase(colors)}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as { x: number; ctl: number; atl: number } | undefined
                    if (!active || !p) return null
                    return (
                      <TipBox
                        title={fmtDayMonth(fromDayNum(p.x))}
                        rows={[
                          { label: 'forma', value: fmtInt(p.ctl), color: colors.bike },
                          { label: 'fadiga', value: fmtInt(p.atl), color: colors.dim },
                        ]}
                        colors={colors}
                      />
                    )
                  }}
                />
                <Line dataKey="atl" stroke={colors.dim} strokeOpacity={0.55} strokeWidth={1.25} dot={false} isAnimationActive={false} activeDot={false} />
                <Line dataKey="ctl" stroke={colors.bike} strokeWidth={2.5} dot={false} isAnimationActive={false} activeDot={{ r: 5, fill: colors.bike, stroke: colors.surface, strokeWidth: 2 }} />
                <Marks marks={model.formMarks} color={colors.bike} colors={colors} x={(d) => dayNum(d)} avoid={model.form.filter((_, i) => i % 2 === 0).map((p) => ({ date: p.date, value: p.ctl }))} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
