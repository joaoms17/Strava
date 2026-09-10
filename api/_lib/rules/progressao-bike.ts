// Regra 10: progressão por tempo (30, 45, 60 min) com cadência >= bike_min_cadence.
// Subir watts só quando 2 sessões consecutivas ao W atual têm avg_hr <= cap e
// max_hr <= cap, ambas verdes — e já com os 60 min feitos (primeiro o tempo,
// depois a potência); depois, sessão de validação de 30 min no W seguinte.
import type { Semaforo } from './semaforo.js'

export interface BikeSessionSummary {
  watts: number | null
  minutes: number | null
  avg_hr: number | null
  max_hr: number | null
  status: Semaforo | null
}

export interface BikeCaps {
  avgHr: number
  maxHr: number
}

export interface BikeTarget {
  watts: number
  minutes: number
  kind: 'start' | 'progress-time' | 'validate-next-watts' | 'hold' | 'ease'
}

const MINUTES_LADDER = [30, 45, 60]

function nearestOption(watts: number, options: number[]): number {
  return options.reduce((best, option) =>
    Math.abs(option - watts) < Math.abs(best - watts) ? option : best,
  )
}

export function nextBikeTarget(
  history: BikeSessionSummary[],
  wattsOptions: number[],
  caps: BikeCaps,
): BikeTarget {
  const options = [...wattsOptions].sort((a, b) => a - b)
  const lowest = options[0] ?? 130
  const sessions = history.filter((s) => s.watts != null && s.minutes != null)
  const last = sessions[sessions.length - 1]
  if (!last) return { watts: lowest, minutes: 30, kind: 'start' }

  // Regra 9: amarelo -> bike leve; vermelho -> depois das 48 h, recomeça leve.
  if (last.status === 'yellow' || last.status === 'red') {
    return { watts: lowest, minutes: 30, kind: 'ease' }
  }

  const currentW = nearestOption(last.watts!, options)
  const currentIdx = options.indexOf(currentW)

  const meetsCaps = (s: BikeSessionSummary) =>
    s.status === 'green' &&
    s.avg_hr != null &&
    s.max_hr != null &&
    s.avg_hr <= caps.avgHr &&
    s.max_hr <= caps.maxHr

  const atCurrentW = sessions.filter((s) => nearestOption(s.watts!, options) === currentW)
  const lastTwo = atCurrentW.slice(-2)
  if (
    last.minutes! >= 60 &&
    lastTwo.length === 2 &&
    lastTwo.every(meetsCaps) &&
    currentIdx >= 0 &&
    currentIdx < options.length - 1
  ) {
    return { watts: options[currentIdx + 1]!, minutes: 30, kind: 'validate-next-watts' }
  }

  if (last.status === 'green') {
    const next = MINUTES_LADDER.find((m) => m > last.minutes!)
    if (next) return { watts: currentW, minutes: next, kind: 'progress-time' }
    return { watts: currentW, minutes: 60, kind: 'hold' }
  }

  // ainda sem check-in — repete o alvo
  return { watts: currentW, minutes: Math.min(last.minutes!, 60), kind: 'hold' }
}
