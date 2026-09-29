// O sono da noite (Garmin via intervals.icu): horas, pontuação 0–100 e
// qualidade 1–4 (a escala do intervals.icu: 1 ótima … 4 fraca). Sem imports:
// o telemóvel usa as mesmas funções.

export interface NightSleep {
  sleep_minutes: number | null
  sleep_score: number | null
  sleep_quality: number | null
  hrv: number | null
  avg_sleep_hr: number | null
}

export const SHORT_NIGHT_MIN = 360
export const POOR_SCORE = 60

// «7 h 12»
export function fmtSleep(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

// Como a Garmin: 90+ excelente, 80+ bom, 60+ razoável, abaixo disso fraco.
export function sleepLabel(night: Pick<NightSleep, 'sleep_score' | 'sleep_quality'>): string | null {
  const s = night.sleep_score
  if (s != null) return s >= 90 ? 'excelente' : s >= 80 ? 'bom' : s >= POOR_SCORE ? 'razoável' : 'fraco'
  const q = night.sleep_quality
  if (q != null) return ['excelente', 'bom', 'razoável', 'fraco'][q - 1] ?? null
  return null
}

// Noite má: pontuação abaixo de 60, qualidade «fraca» ou menos de 6 h.
export function poorNight(night: Pick<NightSleep, 'sleep_minutes' | 'sleep_score' | 'sleep_quality'>): boolean {
  if (night.sleep_score != null) return night.sleep_score < POOR_SCORE
  if (night.sleep_quality != null) return night.sleep_quality >= 4
  return night.sleep_minutes != null && night.sleep_minutes < SHORT_NIGHT_MIN
}

export function hasSleep(night: Partial<NightSleep> | null | undefined): night is NightSleep {
  return night != null && (night.sleep_minutes != null || night.sleep_score != null || night.sleep_quality != null)
}

// Linha de apoio: «bom · 78 · FC 52 · HRV 48»
export function sleepDetail(night: NightSleep): string {
  const parts: string[] = []
  const label = sleepLabel(night)
  if (label) parts.push(label)
  if (night.sleep_score != null) parts.push(String(night.sleep_score))
  if (night.avg_sleep_hr != null) parts.push(`FC ${night.avg_sleep_hr}`)
  if (night.hrv != null) parts.push(`HRV ${Math.round(night.hrv)}`)
  return parts.join(' · ')
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
