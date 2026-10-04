import { SLOTS, SLOT_LABEL, slotOf, type Slot } from '../../api/_lib/rules/momentos'
import { shiftDate } from './day'
import { fmtDayShort } from './format'

// «Quando» de um registo: o dia (nutricional) e a refeição. «Agora» só
// existe hoje; num dia passado a refeição escolhe-se sempre (null = falta).
export type WhenSlot = Slot | 'agora'

export interface When {
  date: string
  slot: WhenSlot | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function isWhenSlot(value: string | null): value is WhenSlot {
  return value === 'agora' || (SLOTS as string[]).includes(value ?? '')
}

// Dos parâmetros da folha (?data=…&momento=…). Sem dia, hoje (ou o dia que
// se está a ver); nunca no futuro.
export function whenFromParams(params: URLSearchParams, today: string, fallbackDate?: string | null): When {
  const raw = params.get('data')
  const candidate = raw && DATE.test(raw) ? raw : fallbackDate
  const date = candidate && candidate <= today ? candidate : today
  const momento = params.get('momento')
  const slot = isWhenSlot(momento) ? momento : null
  return normalizeWhen({ date, slot }, today)
}

// «Agora» só hoje; hoje sem refeição escolhida é «agora».
export function normalizeWhen(when: When, today: string): When {
  if (when.date === today) return { date: when.date, slot: when.slot ?? 'agora' }
  return { date: when.date, slot: when.slot === 'agora' ? null : when.slot }
}

// Mudar de dia mantém a refeição escolhida (ontem ao jantar → anteontem ao jantar).
export function withDate(when: When, date: string, today: string): When {
  return normalizeWhen({ date, slot: when.slot }, today)
}

export function needsSlot(when: When): boolean {
  return when.slot == null
}

// Para passar a outra folha (barras, só números, repetir).
export function whenParams(when: When, today: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (when.date !== today) out.data = when.date
  if (when.slot && when.slot !== 'agora') out.momento = when.slot
  return out
}

// Para a API: nada = agora; senão o dia e a refeição.
export function whenApi(when: When, today: string): { date?: string; slot?: Slot } {
  if (when.slot == null || when.slot === 'agora') return when.date === today ? {} : { date: when.date }
  return { date: when.date, slot: when.slot }
}

// A refeição de referência (favoritos, «igual a ontem»): a escolhida ou a da hora.
export function slotForRanking(when: When, now: Date): Slot {
  return when.slot && when.slot !== 'agora' ? when.slot : slotOf(now)
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoje'
  if (date === shiftDate(today, -1)) return 'Ontem'
  if (date === shiftDate(today, -2)) return 'Anteontem'
  return fmtDayShort(date)
}

// «Hoje · agora», «Ontem · jantar», «sex 26 set · almoço».
export function whenLabel(when: When, today: string): string {
  const day = dayLabel(when.date, today)
  if (when.slot == null) return day
  return `${day} · ${when.slot === 'agora' ? 'agora' : SLOT_LABEL[when.slot].toLowerCase()}`
}
