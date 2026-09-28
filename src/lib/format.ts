// Números em PT-PT: vírgula decimal e espaço fino nos milhares («1 880»).
const THIN = ' '

export function fmtInt(n: number): string {
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '−' : ''
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, THIN)
}

// kcal nas frases e nas linhas: arredondadas a 10.
export function fmtKcal(n: number): string {
  return fmtInt(Math.round(n / 10) * 10)
}

export function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
}

// Aceita «84,6» e «84.6».
export function parseDecimal(value: string): number {
  return Number(value.trim().replace(',', '.'))
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAY_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTH_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function parts(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return { dow: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() }
}

// «seg 29 set»
export function fmtDayShort(date: string): string {
  const { dow, day, month } = parts(date)
  return `${WEEKDAY_SHORT[dow]} ${day} ${MONTH_SHORT[month]}`
}

// «29 set»
export function fmtDayMonth(date: string): string {
  const { day, month } = parts(date)
  return `${day} ${MONTH_SHORT[month]}`
}

export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT[parts(date).dow]!
}

export function weekdayLetter(date: string): string {
  return WEEKDAY_LETTER[parts(date).dow]!
}

export function monthLong(month: number): string {
  return MONTH_LONG[month]!
}

// «22–28 set» ou «29 set – 5 out»
export function fmtRange(from: string, to: string): string {
  const a = parts(from)
  const b = parts(to)
  if (a.month === b.month) return `${a.day}–${b.day} ${MONTH_SHORT[b.month]}`
  return `${a.day} ${MONTH_SHORT[a.month]} – ${b.day} ${MONTH_SHORT[b.month]}`
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
  })
}
