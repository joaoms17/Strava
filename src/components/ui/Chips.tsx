import { shiftDate } from '../../lib/day'
import { fmtDayShort } from '../../lib/format'
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
// Escolhido: o laranja de Comer nas folhas da comida (`eat`, por omissão) e o
// do botão principal (`cta`) nos treinos, no corpo e nas pessoas (decisão 93).
export type ChipTone = 'eat' | 'cta'
export const chip = (active: boolean, tone: ChipTone = 'eat') =>
  `min-h-11 rounded-full border px-3 py-1.5 text-[15px] ${
    !active ? 'border-line bg-transparent' : tone === 'cta' ? 'border-cta bg-cta text-on-cta' : 'border-eat bg-eat text-bg'
  }`

// Separadores (a pessoa, Semana/Mês, 1M/3M/Tudo, as Favoritas, Sexo,
// Aparência…): um fundo rebaixado e o escolhido numa pílula levantada,
// neutra e visível nos dois temas. Sem cor: não é comer nem o botão principal.
export const SEGMENT_TRACK = 'rounded-xl bg-surface2 p-1'
export const segment = (active: boolean) => (active ? 'bg-raised font-semibold text-ink shadow-sm' : 'text-dim')

// Dia em chips: Hoje · Ontem · Anteontem. Um dia mais antigo (o «sábado»
// dito na quinta, o print de há 5 dias) aparece num quarto chip, escolhido,
// com a data («sáb 7 nov»): nunca se grava num dia que não se vê (T10).
export function DayChips({
  today,
  value,
  onChange,
  tone,
}: {
  today: string
  value: string | null
  onChange: (date: string) => void
  tone?: ChipTone
}) {
  const near = [0, -1, -2].map((back) => shiftDate(today, back))
  const other = value && !near.includes(value) ? value : null
  return (
    <div className="flex flex-wrap gap-2">
      {near.map((date, i) => (
        <button key={date} onClick={() => onChange(date)} aria-pressed={date === value} className={chip(date === value, tone)}>
          {i === 0 ? 'Hoje' : i === 1 ? 'Ontem' : 'Anteontem'}
        </button>
      ))}
      {other && (
        <button onClick={() => onChange(other)} aria-pressed className={chip(true, tone)}>
          {fmtDayShort(other)}
        </button>
      )}
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
