import { describe, expect, it } from 'vitest'
import { fmtSleep, hasSleep, poorNight, sleepDetail, sleepLabel } from '../api/_lib/rules/sono'

// O sono da noite, vindo do relógio pelo intervals.icu.
describe('sono', () => {
  const night = { sleep_minutes: 432, sleep_score: 78, sleep_quality: null, hrv: 47.6, avg_sleep_hr: 54 }

  it('horas e etiqueta como a Garmin', () => {
    expect(fmtSleep(432)).toBe('7 h 12')
    expect(fmtSleep(480)).toBe('8 h')
    expect(sleepLabel({ sleep_score: 92, sleep_quality: null })).toBe('excelente')
    expect(sleepLabel({ sleep_score: 78, sleep_quality: null })).toBe('razoável')
    expect(sleepLabel({ sleep_score: null, sleep_quality: 4 })).toBe('fraco')
    expect(sleepDetail(night)).toBe('razoável · 78 · FC 54 · HRV 48')
  })

  it('noite má: pontuação abaixo de 60, qualidade fraca ou menos de 6 h', () => {
    expect(poorNight({ sleep_minutes: 480, sleep_score: 55, sleep_quality: null })).toBe(true)
    expect(poorNight({ sleep_minutes: 330, sleep_score: null, sleep_quality: null })).toBe(true)
    expect(poorNight({ sleep_minutes: 330, sleep_score: 72, sleep_quality: null })).toBe(false)
    expect(poorNight({ sleep_minutes: null, sleep_score: null, sleep_quality: 4 })).toBe(true)
    expect(hasSleep({ steps: 4000 } as never)).toBe(false)
    expect(hasSleep(night)).toBe(true)
  })
})
