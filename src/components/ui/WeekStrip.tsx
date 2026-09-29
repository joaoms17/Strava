import { useEffect, useState } from 'react'
import { shiftDate } from '../../lib/day'
import { mondayOf } from '../../../api/_lib/rules/manutencao'
import { weekdayLetter } from '../../lib/format'

// Faixa da semana: só datas, hoje em destaque, ‹ › para mudar de semana.
export default function WeekStrip({
  selected,
  today,
  onPick,
}: {
  selected: string
  today: string
  onPick: (date: string) => void
}) {
  const [monday, setMonday] = useState(() => mondayOf(selected))
  useEffect(() => setMonday(mondayOf(selected)), [selected])
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(monday, i))
  const canGoForward = shiftDate(monday, 7) <= today

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setMonday(shiftDate(monday, -7))}
        className="h-11 w-7 shrink-0 text-xl text-dim"
        aria-label="Semana anterior"
      >
        ‹
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1.5">
        {days.map((date) => {
          const future = date > today
          const isSelected = date === selected
          return (
            <button
              key={date}
              disabled={future}
              onClick={() => onPick(date)}
              className={`flex h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl border font-display disabled:opacity-30 ${
                isSelected
                  ? 'border-cta bg-cta text-on-cta'
                  : date === today
                    ? 'border-line bg-surface text-ink'
                    : 'border-line bg-surface text-dim'
              }`}
              aria-current={isSelected ? 'date' : undefined}
            >
              <span className="text-[12px] font-semibold tracking-[0.1em] opacity-80">{weekdayLetter(date)}</span>
              <span className="text-[20px] leading-none font-bold tabular-nums">{Number(date.slice(8))}</span>
            </button>
          )
        })}
      </div>
      <button
        disabled={!canGoForward}
        onClick={() => setMonday(shiftDate(monday, 7))}
        className="h-11 w-7 shrink-0 text-xl text-dim disabled:opacity-30"
        aria-label="Semana seguinte"
      >
        ›
      </button>
    </div>
  )
}
