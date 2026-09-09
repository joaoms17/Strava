import { shiftDate } from './nutritional-day'

// Datas de um bloco: start_date é uma segunda-feira; day_index 0 = segunda.
export function sessionDate(startDate: string, week: number, dayIndex: number): string {
  return shiftDate(startDate, (week - 1) * 7 + dayIndex)
}

export function blockWeekOf(startDate: string, date: string): number {
  const diff = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000
  return Math.floor(diff / 7) + 1
}

// Próxima segunda-feira estritamente depois de `date` (YYYY-MM-DD)…
// a não ser que `date` já seja segunda — nesse caso é a própria.
export function mondayOnOrAfter(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = domingo, 1 = segunda
  const daysAhead = (8 - dow) % 7
  return shiftDate(date, daysAhead)
}
