// Momentos do dia (pequeno-almoço, almoço…) e horas locais de Lisboa.
// A hora habitual de cada momento é a que se usa quando se regista num dia
// que ficou para trás; o momento de uma refeição deduz-se da hora local.
import { shiftDate } from './nutritional-day.js'

export type Slot = 'pequeno_almoco' | 'almoco' | 'lanche' | 'jantar' | 'ceia'

export const SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'lanche', 'jantar', 'ceia']

export const SLOT_LABEL: Record<Slot, string> = {
  pequeno_almoco: 'Pequeno-almoço',
  almoco: 'Almoço',
  lanche: 'Lanche',
  jantar: 'Jantar',
  ceia: 'Ceia',
}

// Hora habitual de cada momento (HH:MM, hora de Lisboa).
export const SLOT_TIME: Record<Slot, string> = {
  pequeno_almoco: '08:00',
  almoco: '13:00',
  lanche: '16:30',
  jantar: '20:00',
  ceia: '22:30',
}

const TIME_ZONE = 'Europe/Lisbon'

export interface LocalClock {
  date: string // YYYY-MM-DD no calendário de Lisboa
  hour: number
  minute: number
}

export function lisbonClock(instant: Date, timeZone = TIME_ZONE): LocalClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  }
}

// Momento a que pertence uma hora local (minutos desde a meia-noite).
// 06:00–11:59 pequeno-almoço · 12:00–14:59 almoço · 15:00–19:29 lanche ·
// 19:30–21:59 jantar · 22:00–05:59 ceia.
export function slotOfMinutes(minutes: number): Slot {
  if (minutes >= 6 * 60 && minutes < 12 * 60) return 'pequeno_almoco'
  if (minutes >= 12 * 60 && minutes < 15 * 60) return 'almoco'
  if (minutes >= 15 * 60 && minutes < 19 * 60 + 30) return 'lanche'
  if (minutes >= 19 * 60 + 30 && minutes < 22 * 60) return 'jantar'
  return 'ceia'
}

export function slotOf(instant: Date, timeZone = TIME_ZONE): Slot {
  const clock = lisbonClock(instant, timeZone)
  return slotOfMinutes(clock.hour * 60 + clock.minute)
}

// Diferença (minutos) entre a hora local e UTC num instante.
function offsetMinutes(instant: Date, timeZone: string): number {
  const clock = lisbonClock(instant, timeZone)
  const [y, m, d] = clock.date.split('-').map(Number) as [number, number, number]
  const asUtc = Date.UTC(y, m - 1, d, clock.hour, clock.minute)
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000)
}

// Instante de uma hora local de Lisboa (com ou sem hora de verão).
export function lisbonInstant(date: string, time: string, timeZone = TIME_ZONE): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const first = offsetMinutes(new Date(guess), timeZone)
  const candidate = guess - first * 60_000
  const second = offsetMinutes(new Date(candidate), timeZone)
  return new Date(second === first ? candidate : guess - second * 60_000)
}

// Instante de uma hora dentro de um dia nutricional: as horas antes do corte
// (ex.: 01:30 com corte às 04:00) pertencem ao dia seguinte no calendário.
export function instantInNutritionalDay(
  day: string,
  time: string,
  cutoffHour: number,
  timeZone = TIME_ZONE,
): Date {
  const hour = Number(time.split(':')[0])
  const calendarDay = hour < cutoffHour ? shiftDate(day, 1) : day
  return lisbonInstant(calendarDay, time, timeZone)
}

// Para registar num dia passado: a hora pedida nesse dia, nunca no futuro.
export function loggedAtFor(
  day: string,
  time: string,
  cutoffHour: number,
  now: Date,
  timeZone = TIME_ZONE,
): Date {
  const instant = instantInNutritionalDay(day, time, cutoffHour, timeZone)
  return instant.getTime() > now.getTime() ? now : instant
}

export function clockTime(instant: Date, timeZone = TIME_ZONE): string {
  const clock = lisbonClock(instant, timeZone)
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
}
