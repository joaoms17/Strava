// Regra 10: progressão por tempo (30, 45, 60 min) com cadência >= bike_min_cadence.
// Subir watts só quando 2 sessões consecutivas ao W atual têm avg_hr <= cap e
// max_hr <= cap — e já com os 60 min feitos (primeiro o tempo, depois a
// potência); depois, sessão de validação de 30 min no W seguinte.
// Revista na Fase 3: os watts supostos (prefill, «≈ da última sessão») não
// contam para subir a potência, e uma sessão sem batimentos é neutra — não
// trava o tempo, mas pede os batimentos antes de subir a potência.
// Revista com duas pessoas: já não se pergunta pelo joelho. Uma sessão sem
// resposta conta como normal; as antigas marcadas com incómodo (amarelo ou
// vermelho) continuam a pedir uma sessão leve a seguir, tal como uma em que
// o esforço dado no relógio foi 9 ou 10 (muito duro).
import type { Semaforo } from './semaforo.js'

export interface BikeSessionSummary {
  watts: number | null
  minutes: number | null
  avg_hr: number | null
  max_hr: number | null
  status: Semaforo | null
  watts_source?: string | null
  rpe?: number | null // esforço dado no relógio (1–10)
  date?: string | null // AAAA-MM-DD, para o nível das últimas semanas
}

export interface BikeCaps {
  avgHr: number
  maxHr: number
}

export interface BikeTarget {
  watts: number
  minutes: number
  kind: 'start' | 'progress-time' | 'validate-next-watts' | 'hold' | 'ease' | 'need-hr' | 'step-down'
  // Em 'need-hr': o que falta nas últimas 2 sessões.
  missing?: 'avg' | 'max' | 'both'
}

export const HARD_RPE = 9

const MINUTES_LADDER = [30, 45, 60]

function nearestOption(watts: number, options: number[]): number {
  return options.reduce((best, option) =>
    Math.abs(option - watts) < Math.abs(best - watts) ? option : best,
  )
}

// O nível (T8): o W mais alto validado nas últimas semanas — uma sessão a
// esse W de 30 min ou mais, com watts a sério (não supostos), sem incómodo
// nem esforço 9–10 e sem passar os limites de FC (quando os há). Depois de
// uma sessão leve (ou de uma volta de estrada a 95 W) a sugestão volta a ele
// em vez de recomeçar de baixo.
export const BIKE_LEVEL_WEEKS = 6

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function bikeLevel(
  history: BikeSessionSummary[],
  wattsOptions: number[],
  caps: BikeCaps,
  today?: string | null,
): number | null {
  const options = [...wattsOptions].sort((a, b) => a - b)
  if (!options.length) return null
  const from = today ? shiftIso(today, -7 * BIKE_LEVEL_WEEKS) : null
  let level: number | null = null
  for (const s of history) {
    if (s.watts == null || s.minutes == null || s.minutes < 30 || s.watts_source === 'prefill') continue
    if (from && s.date && s.date < from) continue
    if (rough(s) || overCaps(s, caps)) continue
    const w = nearestOption(s.watts, options)
    if (level == null || w > level) level = w
  }
  return level
}

const rough = (s: BikeSessionSummary) => s.status === 'yellow' || s.status === 'red' || (s.rpe ?? 0) >= HARD_RPE
const overCaps = (s: BikeSessionSummary, caps: BikeCaps) =>
  (s.avg_hr != null && s.avg_hr > caps.avgHr) || (s.max_hr != null && s.max_hr > caps.maxHr)

export function nextBikeTarget(
  history: BikeSessionSummary[],
  wattsOptions: number[],
  caps: BikeCaps,
  today?: string | null,
): BikeTarget {
  const options = [...wattsOptions].sort((a, b) => a - b)
  const lowest = options[0] ?? 130
  let sessions = history.filter((s) => s.watts != null && s.minutes != null)
  const lastOfAll = sessions[sessions.length - 1]
  if (!lastOfAll) return { watts: lowest, minutes: 30, kind: 'start' }

  // Sessão com incómodo ou muito dura: a seguinte é leve.
  if (rough(lastOfAll)) return { watts: lowest, minutes: 30, kind: 'ease' }

  const level = bikeLevel(sessions, options, caps, today)
  // A sessão mais recente a um W acima do nível passou os limites de FC (a
  // validação falhou): volta ao nível (T8).
  const lastW = nearestOption(lastOfAll.watts!, options)
  if (level != null && lastW > level && lastOfAll.watts_source !== 'prefill' && overCaps(lastOfAll, caps)) {
    return { watts: level, minutes: 60, kind: 'step-down' }
  }
  // Abaixo do nível (sessão leve, volta de estrada): as sessões leves do fim
  // não contam e a sugestão continua de onde estava ao nível.
  if (level != null && lastW < level) {
    let end = sessions.length
    while (end > 0 && nearestOption(sessions[end - 1]!.watts!, options) < level) end--
    if (end > 0) sessions = sessions.slice(0, end)
  }
  const last = sessions[sessions.length - 1]!

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
    const noAvg = lastTwo.some((s) => s.avg_hr == null)
    const noMax = lastTwo.some((s) => s.max_hr == null)
    return { watts: currentW, minutes: 60, kind: 'need-hr', missing: noAvg && noMax ? 'both' : noAvg ? 'avg' : 'max' }
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
    case 'step-down':
      return `Os batimentos passaram os limites: volta a ${target.watts} W durante ${target.minutes} min.`
    case 'ease':
      return `Bicicleta leve: ${target.minutes} min a ${target.watts} W, para recuperar.`
    case 'need-hr': {
      const what =
        target.missing === 'avg' ? 'médios' : target.missing === 'max' ? 'máximos' : 'médios e máximos'
      return `Para subir a potência preciso dos batimentos ${what} das 2 últimas sessões: junta o print do relógio ou escreve-os no treino.`
    }
    default:
      return `Próxima bicicleta: ${target.minutes} min a ${target.watts} W.`
  }
}
