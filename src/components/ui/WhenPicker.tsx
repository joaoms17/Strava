import { shiftDate } from '../../lib/day'
import { fmtDayShort } from '../../lib/format'
import { dayLabel, normalizeWhen, withDate, type When } from '../../lib/when'
import { SLOTS, SLOT_LABEL, SLOT_TIME, clockTime, type Slot } from '../../../api/_lib/rules/momentos'
import { chip } from './Chips'
import Icon from './Icon'

const SHORT: Record<Slot, string> = {
  pequeno_almoco: 'Peq.-almoço',
  almoco: 'Almoço',
  lanche: 'Lanche',
  jantar: 'Jantar',
  ceia: 'Ceia',
}

// Quando: o dia (hoje, ontem, anteontem ou outro, numa linha que desliza) e
// a refeição (grelha). «Agora» só aparece hoje; num dia passado a refeição é
// obrigatória e fica assinalada enquanto falta.
export default function WhenPicker({
  today,
  value,
  onChange,
  daysBack = 365,
  highlight = false,
}: {
  today: string
  value: When
  onChange: (when: When) => void
  daysBack?: number
  highlight?: boolean
}) {
  const quick = [0, -1, -2].map((back) => shiftDate(today, back))
  const other = !quick.includes(value.date)
  const row = '-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]'
  const pill = (active: boolean) => `${chip(active)} shrink-0 whitespace-nowrap`
  const missing = value.slot == null
  const cell = (active: boolean) =>
    `min-h-12 rounded-xl border px-1 py-1 text-[15px] leading-tight ${
      active ? 'border-eat bg-eat text-bg' : 'border-line bg-transparent'
    }`

  return (
    <div className="space-y-2" data-when>
      <div className={row} role="group" aria-label="Dia">
        {quick.map((date) => (
          <button
            key={date}
            aria-pressed={value.date === date}
            onClick={() => onChange(withDate(value, date, today))}
            className={pill(value.date === date)}
          >
            {dayLabel(date, today)}
          </button>
        ))}
        {/* O campo de data por cima do chip: no iPhone abre o calendário nativo. */}
        <label className={`relative flex items-center gap-1.5 ${pill(other)}`}>
          <Icon name="calendar" size={16} />
          {other ? fmtDayShort(value.date) : 'Outro dia'}
          <input
            type="date"
            aria-label="Outro dia"
            min={shiftDate(today, -daysBack)}
            max={today}
            value={value.date}
            onChange={(e) => {
              const date = e.target.value
              if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today) onChange(withDate(value, date, today))
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      {/* As refeições em grelha: todas à vista, sem deslizar. */}
      <div
        className={`grid grid-cols-3 gap-2 ${missing && highlight ? 'animate-pulse' : ''}`}
        role="group"
        aria-label="Refeição"
      >
        {value.date === today && (
          <button
            aria-pressed={value.slot === 'agora'}
            onClick={() => onChange(normalizeWhen({ date: value.date, slot: 'agora' }, today))}
            className={cell(value.slot === 'agora')}
          >
            Agora <span className="block text-[12px] opacity-70 tabular-nums">{clockTime(new Date())}</span>
          </button>
        )}
        {SLOTS.map((slot) => (
          <button
            key={slot}
            aria-label={`${SLOT_LABEL[slot]} ${SLOT_TIME[slot]}`}
            aria-pressed={value.slot === slot}
            onClick={() => onChange({ date: value.date, slot })}
            className={`${cell(value.slot === slot)} ${missing ? 'border-eat/60' : ''}`}
          >
            {SHORT[slot]} <span className="block text-[12px] opacity-70 tabular-nums">{SLOT_TIME[slot]}</span>
          </button>
        ))}
      </div>
      {missing && <p className="text-[13px] text-eat">Que refeição foi? Escolhe acima.</p>}
    </div>
  )
}
