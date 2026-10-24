import { useId } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { fmtDayShort, fmtInt, weekdayLetter } from '../../lib/format'
import { dayResult, weekDaysReading, type DayResult, type WeekDay } from '../../../api/_lib/rules/balanco-graficos'
import { niceScale } from '../../../api/_lib/rules/graficos'
import { ChartCard, Key, Legend, TICK, axisInt, useChartColors, useSelection, type ChartColors } from '../charts/kit'

export type ChartDay = WeekDay & { out: number }

const HEIGHT = 200
const Y_WIDTH = 44
const MARGIN = { top: 16, right: 8, bottom: 0, left: 0 }

const RESULT_TEXT: Record<DayResult, string> = {
  no_alvo: 'no alvo',
  acima: 'acima do alvo',
  abaixo: 'abaixo do alvo',
  fora: 'ficou de fora (incompleto)',
  hoje: 'hoje, até agora',
  vazio: 'sem registos',
  futuro: '',
}

function barStyle(result: DayResult, colors: ChartColors, hatch: string) {
  switch (result) {
    case 'acima':
      return { fill: `url(#${hatch})`, stroke: colors.attn, strokeWidth: 1.5, strokeDasharray: undefined, fillOpacity: 1 }
    case 'abaixo':
      return { fill: colors.eat, stroke: 'none', strokeWidth: 0, strokeDasharray: undefined, fillOpacity: 0.45 }
    case 'fora':
      return { fill: colors.surface2, stroke: colors.dim, strokeWidth: 1.2, strokeDasharray: '3 2', fillOpacity: 1 }
    case 'hoje':
      return { fill: colors.eat, stroke: colors.eat, strokeWidth: 1.2, strokeDasharray: '3 2', fillOpacity: 0.3 }
    default:
      return { fill: colors.eat, stroke: 'none', strokeWidth: 0, strokeDasharray: undefined, fillOpacity: 1 }
  }
}

// Balanço › Semana: o que se comeu em cada dia (a cor diz o resultado contra
// o alvo desse dia: ±100 kcal no alvo, acima âmbar tracejado, abaixo mais
// claro), o alvo de cada dia (um traço), o gasto (linha fina) e a média dos
// últimos 7 dias completos (tracejada). Tocar num dia mostra os números dele.
export default function SemanaChart({
  days,
  today,
  avg7,
  learning,
  onOpenDay,
}: {
  days: ChartDay[]
  today: string
  avg7: number | null
  learning: boolean
  onOpenDay: (date: string) => void
}) {
  const colors = useChartColors()
  const hatch = `acima-${useId().replace(/:/g, '')}`
  const sel = useSelection<string>()
  const rows = days.map((d) => {
    const result = dayResult(d, today)
    return {
      date: d.date,
      eaten: d.meals > 0 ? Math.round(d.eaten) : null,
      plan: d.plan > 0 ? Math.round(d.plan) : null,
      out: d.date <= today ? Math.round(d.out) : null,
      result,
    }
  })
  const values = rows.flatMap((r) => [r.eaten ?? 0, r.plan ?? 0, r.out ?? 0])
  const scale = niceScale(0, Math.max(1000, ...values, avg7 ?? 0), 4)
  const results = new Set(rows.map((r) => r.result))
  const selected = rows.find((r) => r.date === sel.selected) ?? null
  const reading = weekDaysReading(days, today)

  return (
    <ChartCard
      id="semana-grafico"
      kicker="Comer contra o alvo, dia a dia"
      reading={reading}
      legend={
        <Legend>
          <Key shape="bar" color={colors.eat} label="no alvo (±100)" />
          {results.has('acima') && <Key shape="hatch" color={colors.attn} label="acima" />}
          {results.has('abaixo') && <Key shape="bar" color={colors.eat} label="abaixo" faint />}
          {results.has('fora') && <Key shape="outline" color={colors.dim} label="fora (incompleto)" />}
          <Key shape="line" color={colors.ink} label="alvo do dia" />
          <Key shape="line" color={colors.burn} label={`gasto${learning ? ' (a aprender)' : ''}`} />
          {avg7 != null && <Key shape="dash" color={colors.dim} label={`média 7 dias (${fmtInt(avg7)})`} />}
        </Legend>
      }
    >
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={MARGIN} barCategoryGap="22%">
            <defs>
              <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" fill={colors.attn} fillOpacity={0.35} />
                <rect width="2.5" height="5" fill={colors.attn} />
              </pattern>
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            {selected && <ReferenceArea x1={selected.date} x2={selected.date} fill={colors.surface2} fillOpacity={1} stroke="none" />}
            <XAxis dataKey="date" tick={false} height={4} axisLine={{ stroke: colors.grid }} tickLine={false} />
            <YAxis domain={scale.domain} ticks={scale.ticks} tickFormatter={axisInt} tick={TICK(colors)} axisLine={false} tickLine={false} width={Y_WIDTH} />
            <Bar
              dataKey="eaten"
              radius={[4, 4, 0, 0]}
              maxBarSize={30}
              isAnimationActive={false}
              cursor="pointer"
              onClick={(entry: unknown) => {
                const date = (entry as { payload?: { date?: string } }).payload?.date
                if (date && date <= today) sel.toggle(date)
              }}
            >
              {rows.map((r) => {
                const st = barStyle(r.result, colors, hatch)
                return <Cell key={r.date} fill={st.fill} fillOpacity={st.fillOpacity} stroke={st.stroke} strokeWidth={st.strokeWidth} strokeDasharray={st.strokeDasharray} />
              })}
            </Bar>
            {/* O alvo de cada dia: um traço curto por cima da barra, sem ligar os dias. */}
            <Line
              dataKey="plan"
              stroke="none"
              isAnimationActive={false}
              activeDot={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.cx == null || props.cy == null ? (
                  <g key={props.index} />
                ) : (
                  <line key={props.index} x1={props.cx - 13} x2={props.cx + 13} y1={props.cy} y2={props.cy} stroke={colors.ink} strokeWidth={2.5} strokeLinecap="round" />
                )
              }
            />
            {avg7 != null && <ReferenceLine y={avg7} stroke={colors.dim} strokeWidth={1.5} strokeDasharray="3 4" />}
            <Line dataKey="out" stroke={colors.burn} strokeWidth={1.5} dot={{ r: 2.5, fill: colors.burn, stroke: 'none' }} activeDot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Os dias como botões, alinhados com as barras (também pelo teclado). */}
      <div className="flex" style={{ paddingLeft: Y_WIDTH + MARGIN.left, paddingRight: MARGIN.right }}>
        {rows.map((r) => {
          const future = r.date > today
          const active = sel.selected === r.date
          return (
            <button
              key={r.date}
              disabled={future}
              onClick={() => sel.toggle(r.date)}
              aria-pressed={active}
              aria-label={`${fmtDayShort(r.date)}${r.eaten != null ? `: ${fmtInt(r.eaten)} kcal` : ''}${RESULT_TEXT[r.result] ? `, ${RESULT_TEXT[r.result]}` : ''}`}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center rounded-lg text-[13px] leading-tight tabular-nums disabled:opacity-40 ${
                active ? 'bg-surface2 font-semibold text-ink' : r.date === today ? 'font-semibold text-ink' : 'text-dim'
              }`}
            >
              <span>{weekdayLetter(r.date)}</span>
              <span className="text-[12px]">{Number(r.date.slice(8, 10))}</span>
            </button>
          )
        })}
      </div>
      <div className="min-h-[76px] rounded-xl bg-surface2/60 px-3 py-2.5" aria-live="polite">
        {selected ? (
          <div className="space-y-1">
            <p className="text-[14px] text-dim">
              {fmtDayShort(selected.date)} · {RESULT_TEXT[selected.result]}
            </p>
            <p className="text-[15px] tabular-nums">
              {selected.eaten != null ? (
                <>
                  Comeste <span className="font-semibold">{fmtInt(selected.eaten)}</span>
                </>
              ) : (
                'Sem refeições registadas'
              )}
              {selected.plan != null && <> · alvo {fmtInt(selected.plan)}</>}
              {selected.out != null && <> · gasto {fmtInt(selected.out)}</>}
            </p>
            <button onClick={() => onOpenDay(selected.date)} className="min-h-9 text-[15px] font-semibold text-eat">
              Abrir o dia ›
            </button>
          </div>
        ) : (
          <p className="pt-1 text-[14px] text-dim">Toca num dia para veres o que comeste, o alvo e o gasto desse dia.</p>
        )}
      </div>
    </ChartCard>
  )
}
