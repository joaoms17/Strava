// Feed iCalendar das sessões planeadas — eventos de dia inteiro.
export interface IcsEvent {
  uid: string
  date: string // YYYY-MM-DD
  summary: string
  description?: string
}

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildIcs(events: IcsEvent[], calendarName: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//A Epoca do Regresso//PT',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]
  for (const event of events) {
    const day = event.date.replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
    )
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
