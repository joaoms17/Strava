import { useId } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { fmtDayShort, fmtInt, weekdayLetter } from '../../lib/format'
import { dayResult, dayVerdict, showMeanLine, weekDaysReading, type DayResult, type WeekDay } from '../../../api/_lib/rules/balanco-graficos'
import { MissingNote } from '../DiaResposta'
import { niceScale } from '../../../api/_lib/rules/graficos'
import { AlertBadge, BELOW_FILL_OPACITY, ChartCard, HatchDef, Key, Legend, Marks, TICK, axisInt, useChartColors, useSelection, type ChartColors } from '../charts/kit'

export type ChartDay = WeekDay & { out: number; missing?: boolean }

const HEIGHT = 200
const Y_WIDTH = 44
const MARGIN = { top: 16, right: 8, bottom: 0, left: 0 }

// O nome de cada resultado para o VoiceOver (o toque diz a diferença em kcal).
const RESULT_TEXT: Record<DayResult, string> = {
  no_alvo: 'no alvo',
  acima_alvo: 'acima do alvo, ainda abaixo do gasto',
  acima_gasto: 'acima do gasto',
  abaixo: 'no alvo (bem abaixo)',
  fora: 'ficou de fora (incompleto)',
  hoje: 'hoje, ainda a meio',
  vazio: 'sem registos',
  futuro: '',
}

function barStyle(result: DayResult, colors: ChartColors, hatch: string) {
  switch (result) {
    case 'acima_alvo':
      return { fill: `url(#${hatch})`, stroke: 'none', strokeWidth: 0, strokeDasharray: undefined, fillOpacity: 1 }
    case 'acima_gasto':
      return { fill: colors.danger, stroke: 'none', strokeWidth: 0, strokeDasharray: undefined, fillOpacity: 1 }
    case 'abaixo':
      return { fill: colors.ok, stroke: colors.ok, strokeWidth: 1.5, strokeDasharray: undefined, fillOpacity: BELOW_FILL_OPACITY }
    case 'fora':
      return { fill: colors.surface2, stroke: colors.dim, strokeWidth: 1.2, strokeDasharray: '3 2', fillOpacity: 1 }
    case 'hoje':
      return { fill: colors.dim, stroke: colors.dim, strokeWidth: 1.2, strokeDasharray: '3 2', fillOpacity: 0.25 }
    default:
      return { fill: colors.ok, stroke: 'none', strokeWidth: 0, strokeDasharray: undefined, fillOpacity: 1 }
  }
}

// Balanço › Semana: o que se comeu em cada dia (a cor diz o resultado contra
// o alvo desse dia, decisão 289: no alvo verde, bem abaixo verde claro — que
// também conta como no alvo —, acima do alvo âmbar com riscas, acima do
// gasto vermelho cheio com «!» por cima, decisão 301), o alvo de cada dia
// (um traço), o gasto (linha fina) e a média dos últimos 7 dias completos
// (tracejada, com nome; sem linha quando fica colada ao alvo). Tocar num dia
// mostra os números dele.
export default function SemanaChart({
  days,
  today,
  avg7,
  learning,
  note,
  onOpenDay,
}: {
  days: ChartDay[]
  today: string
  avg7: number | null
  learning: boolean
  // Uma linha quando o gasto medido está limitado ou a acompanhar (decisão 304).
  note?: string | null
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
      alert: result === 'acima_gasto' ? '!' : null,
      missing: d.missing === true && d.date < today,
    }
  })
  const values = rows.flatMap((r) => [r.eaten ?? 0, r.plan ?? 0, r.out ?? 0])
  const scale = niceScale(0, Math.max(1000, ...values, avg7 ?? 0), 4)
  const results = new Set(rows.map((r) => r.result))
  const selected = rows.find((r) => r.date === sel.selected) ?? null
  const reading = weekDaysReading(days, today)
  const meanLine = showMeanLine(avg7, rows.map((r) => r.plan ?? 0))

  return (
    <ChartCard
      id="semana-grafico"
      kicker="Comer contra o alvo, dia a dia"
      reading={reading}
      note={note ?? undefined}
      legend={
        <Legend>
          <Key shape="bar" color={colors.ok} label="no alvo (até +100)" />
          {results.has('abaixo') && <Key shape="below" color={colors.ok} label="bem abaixo (conta como no alvo)" />}
          {results.has('acima_alvo') && <Key shape="hatch" color={colors.attn} label="acima do alvo (ainda abaixo do gasto)" />}
          {results.has('acima_gasto') && <Key shape="alert" color={colors.danger} glyph={colors.onDanger} label="acima do gasto" />}
          {results.has('fora') && <Key shape="outline" color={colors.dim} label="fora (incompleto)" />}
          {results.has('hoje') && <Key shape="outline" color={colors.dim} label="hoje (a meio)" />}
          <Key shape="line" color={colors.ink} label="alvo do dia" />
          <Key shape="line" color={colors.burn} label={`gasto${learning ? ' (a aprender)' : ''}`} />
          {avg7 != null &&
            (meanLine ? (
              <Key shape="dash" color={colors.dim} label={`comeste em média (7 dias): ${fmtInt(avg7)} kcal`} />
            ) : (
              <span>comeste em média (7 dias): {fmtInt(avg7)} kcal</span>
            ))}
        </Legend>
      }
    >
      <div style={{ height: HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={MARGIN} barCategoryGap="22%">
            <defs>
              <HatchDef id={hatch} colors={colors} />
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
              {/* Acima do gasto: um «!» por cima da barra (a 2.ª pista, além da cor). */}
              <LabelList dataKey="alert" position="top" offset={4} fill={colors.danger} fontSize={15} fontWeight={800} />
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
            {meanLine && <ReferenceLine y={avg7!} stroke={colors.dim} strokeWidth={1.5} strokeDasharray="3 4" />}
            {meanLine && <Marks marks={[]} color={colors.dim} colors={colors} x={(d) => d} refs={[{ y: avg7!, text: `média ${fmtInt(avg7!)}`, side: 'left' }]} />}
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
              {fmtDayShort(selected.date)} ·{' '}
              {selected.result === 'acima_gasto' && <AlertBadge colors={colors} />}
              <span className={selected.result === 'acima_gasto' ? 'font-semibold text-ink' : undefined}>
                {dayVerdict(selected.result, selected.eaten, selected.plan, selected.out)}
              </span>
            </p>
            <p className="text-[15px] tabular-nums">
              {selected.eaten != null ? (
                <>
                  Comeste <span className="font-semibold">{fmtInt(selected.eaten)} kcal</span>
                </>
              ) : (
                'Sem refeições registadas'
              )}
              {selected.plan != null && <> · alvo {fmtInt(selected.plan)}</>}
              {selected.out != null && <> · gasto {fmtInt(selected.out)}</>}
            </p>
            {selected.missing && (
              <div className="border-t border-line pt-2">
                <MissingNote date={selected.date} today={today} compact />
              </div>
            )}
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
