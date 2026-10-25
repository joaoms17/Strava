import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtDayShort, fmtInt } from '../../lib/format'
import { shiftDate } from '../../lib/day'
import { monthBounds, monthName } from '../../../api/_lib/rules/mes'
import { dayVerdict, monthCalendar, type CalCell, type CalResult } from '../../../api/_lib/rules/balanco-graficos'
import type { BalancoLongo } from '../../lib/balanco'
import { missingFlag } from '../../../api/_lib/rules/dia-resposta'
import { MissingNote } from '../DiaResposta'
import { AlertBadge, ChartCard, HatchDef, Key, Legend, useChartColors } from '../charts/kit'

const LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']

const RESULT_TEXT: Record<CalResult, string> = {
  no_alvo: 'no alvo',
  acima_alvo: 'acima do alvo, ainda abaixo do gasto',
  acima_gasto: 'acima do gasto',
  fora: 'ficou de fora (incompleto ou «faltou algo»)',
  sem_registo: 'sem registos',
  hoje: 'hoje, ainda a meio',
  futuro: 'ainda não chegou',
}

// Balanço › Mês: o calendário dos dias no alvo (decisão 289: dia completo
// com o comido até 100 kcal acima do alvo do dia). Cada dia tem a cor (no
// alvo o verde de «a melhorar», acima do alvo o âmbar com riscas, acima do
// gasto o vermelho cheio, como no gráfico da Semana) e um sinal (✓ no alvo,
// + acima do alvo, ! acima do gasto, – de fora), para a cor não ser a única
// pista (decisão 301). Hoje tem um contorno fino; o dia tocado, um anel afastado.
// Tocar num dia mostra os números; ‹ › mudam de mês dentro do que foi lido.
// As semanas só com dias futuros não aparecem.
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
  // Marcado «faltou algo»: o quadro do dia diz porquê e deixa voltar atrás.
  const cellMissing = cell != null && cell.date < today && missingFlag(data.days.find((d) => d.date === cell.date)?.flags)
  const weeks = cal.weeks.filter((w) => w.some((c) => c != null && c.result !== 'futuro'))
  const detail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (picked) detail.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [picked])

  const style = (c: CalCell) => {
    switch (c.result) {
      case 'no_alvo':
        return { background: colors.ok, color: colors.onOk, border: `1px solid ${colors.ok}` }
      case 'acima_alvo':
        return { background: 'transparent', color: colors.ink, border: `1px solid ${colors.attn}` }
      case 'acima_gasto':
        return { background: colors.danger, color: colors.onDanger, border: `1px solid ${colors.danger}` }
      case 'fora':
        return { background: 'transparent', color: colors.dim, border: `1.5px dashed ${colors.dim}` }
      case 'hoje':
        return { background: 'transparent', color: colors.ink, border: `1px solid ${colors.ink}` }
      default:
        return { background: colors.surface2, color: colors.dim, border: `1px solid ${colors.grid}` }
    }
  }
  const sign: Partial<Record<CalResult, string>> = { no_alvo: '✓', acima_alvo: '+', acima_gasto: '!', fora: '–', hoje: 'hoje' }

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
          <Key shape="bar" color={colors.ok} label="✓ no alvo" />
          <Key shape="hatch" color={colors.attn} label="+ acima do alvo" />
          <Key shape="alert" color={colors.danger} glyph={colors.onDanger} label="acima do gasto" />
          <Key shape="outline" color={colors.dim} label="– de fora" />
          <Key shape="bar" color={colors.surface2} border={colors.dim} label="sem registos" />
        </Legend>
      }
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <HatchDef id={hatch} colors={colors} size={7} />
        </defs>
      </svg>
      {/* Uma lista de botões com o dia e o resultado no nome (sem papéis de
          grelha: sem linhas, o VoiceOver perdia-se). */}
      <div className="grid grid-cols-7 gap-1.5 text-center" aria-label={`Calendário de ${monthName(month)}`}>
        {LETTERS.map((l, i) => (
          <span key={i} className="text-[12px] text-dim" aria-hidden>
            {l}
          </span>
        ))}
        {weeks.flat().map((c, i) =>
          c == null ? (
            <span key={`v${i}`} />
          ) : (
            <button
              key={c.date}
              disabled={c.result === 'futuro'}
              onClick={() => setPicked(picked === c.date ? null : c.date)}
              aria-pressed={picked === c.date}
              aria-label={`${fmtDayShort(c.date)}: ${RESULT_TEXT[c.result]}`}
              className={`relative flex aspect-square min-h-10 flex-col items-center justify-center rounded-lg text-[14px] leading-none tabular-nums disabled:opacity-40 ${
                picked === c.date ? 'ring-[2.5px] ring-ink ring-offset-2 ring-offset-surface' : ''
              }`}
              style={style(c)}
            >
              {c.result === 'acima_alvo' && (
                <svg className="absolute inset-0 h-full w-full rounded-lg" aria-hidden>
                  <rect width="100%" height="100%" fill={`url(#${hatch})`} />
                </svg>
              )}
              {/* Nas riscas, o número numa pílula da cor do cartão (lê-se sempre). */}
              <span className={`relative font-semibold ${c.result === 'acima_alvo' ? 'rounded-md bg-surface px-1 py-px' : ''}`}>{c.day}</span>
              {sign[c.result] && (
                <span
                  className={`relative leading-none font-bold ${c.result === 'hoje' ? 'text-[10px] font-semibold' : 'text-[13px]'} ${c.result === 'acima_alvo' ? 'mt-0.5 rounded-md bg-surface px-1' : ''} ${c.result === 'acima_gasto' ? 'text-[15px] font-extrabold' : ''}`}
                  aria-hidden
                >
                  {sign[c.result]}
                </span>
              )}
            </button>
          ),
        )}
      </div>
      <div ref={detail} className="mt-2 min-h-[52px] scroll-mb-24 rounded-xl bg-surface2/60 px-3 py-2" aria-live="polite">
        {cell ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[14px] text-dim">
                  {fmtDayShort(cell.date)} ·{' '}
                  {cell.result === 'acima_gasto' && <AlertBadge colors={colors} />}
                  <span className={cell.result === 'acima_gasto' ? 'font-semibold text-ink' : undefined}>
                    {cell.result === 'acima_alvo' || cell.result === 'acima_gasto'
                      ? dayVerdict(cell.result, cell.kcalIn, cell.kcalTarget, cell.kcalOut)
                      : RESULT_TEXT[cell.result]}
                  </span>
                </p>
                {cell.kcalIn != null && (
                  <p className="text-[15px] tabular-nums">
                    Comeste <span className="font-semibold">{fmtInt(cell.kcalIn)} kcal</span>
                    {cell.kcalTarget != null && <> · alvo {fmtInt(cell.kcalTarget)}</>}
                    {cell.kcalOut != null && <> · gasto {fmtInt(cell.kcalOut)}</>}
                  </p>
                )}
              </div>
              {cell.result !== 'futuro' && (
                <button onClick={() => onOpenDay(cell.date)} className="min-h-10 shrink-0 text-[15px] font-semibold text-eat">
                  Abrir ›
                </button>
              )}
            </div>
            {cellMissing && (
              <div className="mt-2 border-t border-line pt-2">
                <MissingNote date={cell.date} today={today} compact />
              </div>
            )}
          </>
        ) : (
          <p className="pt-1 text-[14px] text-dim">Toca num dia para veres o que comeste, o alvo e o gasto.</p>
        )}
      </div>
    </ChartCard>
  )
}
