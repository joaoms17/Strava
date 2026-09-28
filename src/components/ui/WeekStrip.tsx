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
        className="h-11 w-8 shrink-0 text-xl text-dim"
        aria-label="Semana anterior"
      >
        ‹
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((date) => {
          const future = date > today
          const isSelected = date === selected
          return (
            <button
              key={date}
              disabled={future}
              onClick={() => onPick(date)}
              className={`flex flex-col items-center rounded-xl py-1.5 text-[13px] disabled:opacity-30 ${
                isSelected ? 'bg-eat text-bg' : date === today ? 'text-ink' : 'text-dim'
              }`}
              aria-current={isSelected ? 'date' : undefined}
            >
              <span>{weekdayLetter(date)}</span>
              <span className={`text-[15px] tabular-nums ${date === today && !isSelected ? 'font-semibold' : ''}`}>
                {Number(date.slice(8))}
              </span>
            </button>
          )
        })}
      </div>
      <button
        disabled={!canGoForward}
        onClick={() => setMonday(shiftDate(monday, 7))}
        className="h-11 w-8 shrink-0 text-xl text-dim disabled:opacity-30"
        aria-label="Semana seguinte"
      >
        ›
      </button>
    </div>
  )
}
