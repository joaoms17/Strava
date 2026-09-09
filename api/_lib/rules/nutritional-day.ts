// Regra 1: o dia nutricional vai das 04:00 às 04:00 locais (Europe/Lisbon).
// Devolve o dia (YYYY-MM-DD) a que um instante pertence.
export function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function nutritionalDay(
  instant: Date,
  cutoffHour: number,
  timeZone = 'Europe/Lisbon',
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  // Alguns motores formatam a meia-noite como "24"
  const hour = get('hour') % 24
  let dayUtc = Date.UTC(get('year'), get('month') - 1, get('day'))
  if (hour < cutoffHour) dayUtc -= 86_400_000
  return new Date(dayUtc).toISOString().slice(0, 10)
}
