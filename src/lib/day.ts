// Fonte única da regra 1 — implementada e testada em api/_lib/rules.
export { nutritionalDay } from '../../api/_lib/rules/nutritional-day'

// Data de calendário local (para o peso), YYYY-MM-DD em Europe/Lisbon.
export function localCalendarDate(instant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}
