// Regra 10: progressão por tempo (30, 45, 60 min) com cadência >= bike_min_cadence.
// Subir watts só quando 2 sessões consecutivas ao W atual têm avg_hr <= cap e
// max_hr <= cap — e já com os 60 min feitos (primeiro o tempo, depois a
// potência); depois, sessão de validação de 30 min no W seguinte.
// Revista na Fase 3: os watts supostos (prefill, «≈ da última sessão») não
// contam para subir a potência, e uma sessão sem batimentos é neutra — não
// trava o tempo, mas pede os batimentos antes de subir a potência.
// Revista com duas pessoas: já não se pergunta pelo joelho. Uma sessão sem
// resposta conta como normal; as antigas marcadas com incómodo (amarelo ou
// vermelho) continuam a pedir uma sessão leve a seguir.
import type { Semaforo } from './semaforo.js'

export interface BikeSessionSummary {
  watts: number | null
  minutes: number | null
  avg_hr: number | null
  max_hr: number | null
  status: Semaforo | null
  watts_source?: string | null
}

export interface BikeCaps {
  avgHr: number
  maxHr: number
}

export interface BikeTarget {
  watts: number
  minutes: number
  kind: 'start' | 'progress-time' | 'validate-next-watts' | 'hold' | 'ease' | 'need-hr'
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

  // Sessão antiga com incómodo: a seguinte é leve.
  const rough = (s: BikeSessionSummary) => s.status === 'yellow' || s.status === 'red'
  if (rough(last)) return { watts: lowest, minutes: 30, kind: 'ease' }

  const currentW = nearestOption(last.watts!, options)
  const currentIdx = options.indexOf(currentW)

  const meetsCaps = (s: BikeSessionSummary) =>
    !rough(s) &&
    s.avg_hr != null &&
    s.max_hr != null &&
    s.avg_hr <= caps.avgHr &&
    s.max_hr <= caps.maxHr

  const atCurrentW = sessions.filter(
    (s) => nearestOption(s.watts!, options) === currentW && s.watts_source !== 'prefill',
  )
  const lastTwo = atCurrentW.slice(-2)
  const canStepUp = last.minutes! >= 60 && currentIdx >= 0 && currentIdx < options.length - 1
  if (canStepUp && lastTwo.length === 2 && lastTwo.every(meetsCaps)) {
    return { watts: options[currentIdx + 1]!, minutes: 30, kind: 'validate-next-watts' }
  }
  // Tudo verde a 60 min, mas faltam os batimentos para decidir a potência.
  if (
    canStepUp &&
    lastTwo.length === 2 &&
    lastTwo.every((s) => !rough(s)) &&
    lastTwo.some((s) => s.avg_hr == null || s.max_hr == null)
  ) {
    return { watts: currentW, minutes: 60, kind: 'need-hr' }
  }

  const next = MINUTES_LADDER.find((m) => m > last.minutes!)
  if (next) return { watts: currentW, minutes: next, kind: 'progress-time' }
  return { watts: currentW, minutes: 60, kind: 'hold' }
}

// Frase da sugestão seguinte, no separador Treino.
export function bikeSuggestion(target: BikeTarget): string {
  if (target.kind === 'start') return `Começa com ${target.minutes} min a ${target.watts} W.`
  switch (target.kind) {
    case 'validate-next-watts':
      return `Próxima vez: ${target.watts} W durante ${target.minutes} min, para testar.`
    case 'ease':
      return `Bicicleta leve: ${target.minutes} min a ${target.watts} W, para recuperar.`
    case 'need-hr':
      return 'Para subir a potência preciso dos batimentos: junta o print do relógio ou escreve os batimentos médios.'
    default:
      return `Próxima bicicleta: ${target.minutes} min a ${target.watts} W.`
  }
}
