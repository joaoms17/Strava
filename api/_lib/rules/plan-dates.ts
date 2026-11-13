import { shiftDate } from './nutritional-day.js'

// Datas de um bloco: start_date é uma segunda-feira; day_index 0 = segunda.
export function sessionDate(startDate: string, week: number, dayIndex: number): string {
  return shiftDate(startDate, (week - 1) * 7 + dayIndex)
}
