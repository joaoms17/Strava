import { useId, useMemo, useState } from 'react'
import { fmtDayShort, fmtInt } from '../../lib/format'
import { shiftDate } from '../../lib/day'
import { monthBounds, monthName } from '../../../api/_lib/rules/mes'
import { monthCalendar, type CalCell, type CalResult } from '../../../api/_lib/rules/balanco-graficos'
import type { BalancoLongo } from '../../lib/balanco'
import { ChartCard, Key, Legend, useChartColors } from '../charts/kit'

const LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

const RESULT_TEXT: Record<CalResult, string> = {
  no_alvo: 'no alvo',
  acima: 'acima do alvo',
  fora: 'ficou de fora (incompleto ou «faltou algo»)',
  sem_registo: 'sem registos',
  hoje: 'hoje, ainda a meio',
  futuro: 'ainda não chegou',
}

// Balanço › Mês: o calendário dos dias no alvo (decisão 289: dia completo
// com o comido até 100 kcal acima do alvo do dia). Cada dia tem a cor e um
// sinal (✓ no alvo, + acima, – de fora), para a cor não ser a única pista.
// Tocar num dia mostra os números; ‹ › mudam de mês dentro do que foi lido.
export default function CalendarioMes({ data, today, onOpenDay }: { data: BalancoLongo; today: string; onOpenDay: (date: string) => void }) {
  const colors = useChartColors()
  const hatch = `cal-${useId().replace(/:/g, '')}`
  const [month, setMonth] = useState(today.slice(0, 7))
  const [picked, setPicked] = useState<string | null>(null)
  const cal = useMemo(() => monthCalendar(month, data.days, today), [month, data.days, today])
  const prev = shiftDate(`${month}-01`, -1).slice(0, 7)
  const next = shiftDate(monthBounds(month).last, 1).slice(0, 7)
  // Só os meses lidos por inteiro (a página lê as últimas 12 semanas).
  const canPrev = `${prev}-01` >= data.from
  const canNext = next <= today.slice(0, 7)
  const cell = cal.weeks.flat().find((c) => c?.date === picked) ?? null

  const style = (c: CalCell) => {
    switch (c.result) {
      case 'no_alvo':
        return { background: colors.eat, color: colors.surface, border: `1px solid ${colors.eat}` }
      case 'acima':
        return { background: 'transparent', color: colors.ink, border: `1.5px solid ${colors.attn}` }
      case 'fora':
        return { background: 'transparent', color: colors.dim, border: `1.5px dashed ${colors.dim}` }
      case 'hoje':
        return { background: 'transparent', color: colors.ink, border: `2px solid ${colors.ink}` }
      default:
        return { background: colors.surface2, color: colors.dim, border: `1px solid ${colors.surface2}` }
    }
  }
  const sign: Partial<Record<CalResult, string>> = { no_alvo: '✓', acima: '+', fora: '–' }

  return (
    <ChartCard
      kicker={`Dias no alvo · ${monthName(month)}`}
      reading={cal.reading}
      aside={
        <div className="flex items-center justify-between">
          <button disabled={!canPrev} onClick={() => (setMonth(prev), setPicked(null))} className="h-10 w-10 text-xl text-dim disabled:opacity-30" aria-label="Mês anterior">
            ‹
          </button>
          <p className="text-[15px] font-semibold capitalize">{monthName(month)}</p>
          <button disabled={!canNext} onClick={() => (setMonth(next), setPicked(null))} className="h-10 w-10 text-xl text-dim disabled:opacity-30" aria-label="Mês seguinte">
            ›
          </button>
        </div>
      }
      legend={
        <Legend>
          <Key shape="bar" color={colors.eat} label="✓ no alvo" />
          <Key shape="hatch" color={colors.attn} label="+ acima" />
          <Key shape="outline" color={colors.dim} label="– de fora" />
          <Key shape="bar" color={colors.surface2} label="sem registos" />
        </Legend>
      }
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={colors.attn} fillOpacity={0.18} />
            <rect width="2" height="6" fill={colors.attn} fillOpacity={0.55} />
          </pattern>
        </defs>
      </svg>
      <div className="grid grid-cols-7 gap-1.5 text-center" role="grid" aria-label={`Calendário de ${monthName(month)}`}>
        {LETTERS.map((l, i) => (
          <span key={i} className="text-[12px] text-dim" role="columnheader">
            {l}
          </span>
        ))}
        {cal.weeks.flat().map((c, i) =>
          c == null ? (
            <span key={`v${i}`} />
          ) : (
            <button
              key={c.date}
              role="gridcell"
              disabled={c.result === 'futuro'}
              onClick={() => setPicked(picked === c.date ? null : c.date)}
              aria-pressed={picked === c.date}
              aria-label={`${fmtDayShort(c.date)}: ${RESULT_TEXT[c.result]}`}
              className={`relative flex aspect-square min-h-10 flex-col items-center justify-center rounded-lg text-[14px] leading-none tabular-nums disabled:opacity-40 ${
                picked === c.date ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
              }`}
              style={style(c)}
            >
              {c.result === 'acima' && (
                <svg className="absolute inset-0 h-full w-full rounded-lg" aria-hidden>
                  <rect width="100%" height="100%" fill={`url(#${hatch})`} />
                </svg>
              )}
              <span className="relative font-semibold">{c.day}</span>
              {sign[c.result] && <span className="relative text-[10px]">{sign[c.result]}</span>}
            </button>
          ),
        )}
      </div>
      <div className="mt-2 min-h-[52px] rounded-xl bg-surface2/60 px-3 py-2" aria-live="polite">
        {cell ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[14px] text-dim">
                {fmtDayShort(cell.date)} · {RESULT_TEXT[cell.result]}
              </p>
              {cell.kcalIn != null && (
                <p className="text-[15px] tabular-nums">
                  Comeste <span className="font-semibold">{fmtInt(cell.kcalIn)}</span>
                  {cell.kcalTarget != null && <> · alvo {fmtInt(cell.kcalTarget)}</>}
                </p>
              )}
            </div>
            {cell.result !== 'futuro' && (
              <button onClick={() => onOpenDay(cell.date)} className="min-h-10 shrink-0 text-[15px] font-semibold text-eat">
                Abrir ›
              </button>
            )}
          </div>
        ) : (
          <p className="pt-1 text-[14px] text-dim">Toca num dia para veres o que comeste e o alvo.</p>
        )}
      </div>
    </ChartCard>
  )
}
