import { shiftDate } from '../../lib/day'
import { SLOTS, SLOT_LABEL, SLOT_TIME } from '../../../api/_lib/rules/momentos'
import type { Slot } from '../../lib/types'

export const TAG_LABEL: Record<string, string> = {
  comi_metade: 'Comi metade',
  azeite: 'Com azeite',
  sem_molho: 'Sem molho',
  porcao_grande: 'Porção grande',
  jantar_fora: 'Jantar fora',
}

// Por escolher, os chips têm contorno: ficam visíveis em cima de qualquer fundo.
const chip = (active: boolean) =>
  `min-h-9 rounded-full border px-3 py-1.5 text-[15px] ${
    active ? 'border-eat bg-eat text-bg' : 'border-line bg-transparent'
  }`

// Dia em chips: Hoje · Ontem · Anteontem.
export function DayChips({
  today,
  value,
  onChange,
}: {
  today: string
  value: string | null
  onChange: (date: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {[0, -1, -2].map((back) => {
        const date = shiftDate(today, back)
        return (
          <button key={back} onClick={() => onChange(date)} className={chip(date === value)}>
            {back === 0 ? 'Hoje' : back === -1 ? 'Ontem' : 'Anteontem'}
          </button>
        )
      })}
    </div>
  )
}

// Momento em chips, com a hora habitual; «Agora» só quando faz sentido.
export function SlotChips({
  value,
  onChange,
  allowNow = false,
}: {
  value: Slot | 'agora' | null
  onChange: (slot: Slot | 'agora') => void
  allowNow?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {allowNow && (
        <button onClick={() => onChange('agora')} className={chip(value === 'agora')}>
          Agora
        </button>
      )}
      {SLOTS.map((slot) => (
        <button key={slot} onClick={() => onChange(slot)} className={chip(value === slot)}>
          {SLOT_LABEL[slot]} <span className="opacity-70 tabular-nums">{SLOT_TIME[slot]}</span>
        </button>
      ))}
    </div>
  )
}

export function TagChips({ value, onToggle }: { value: string[]; onToggle: (tag: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(TAG_LABEL).map(([tag, label]) => (
        <button key={tag} onClick={() => onToggle(tag)} className={chip(value.includes(tag))}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
