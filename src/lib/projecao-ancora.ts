import { project, type EtaAnchor, type ProjInput, type Projection } from '../../api/_lib/rules/projecao'
import { readScoped, writeScoped } from './scoped'

// A data da projeção que já se mostrou fica no telemóvel: a projeção só a
// troca quando a nova fica a mais de uma semana dela (rules/projecao.ts), em
// vez de a data andar um bocadinho todos os dias. Mudar o alvo esquece-a.
const KEY = 'regresso.projecao-ancora'

export function anchorToStore(targetKg: number, p: Projection): string | null {
  if (p.status !== 'ok' || p.weight.kind !== 'date') return null
  const { date, early, late } = p.weight
  return JSON.stringify({ targetKg, date, early, late })
}

export function anchorFromStore(raw: string | null, targetKg: number): EtaAnchor | null {
  if (!raw) return null
  try {
    const a = JSON.parse(raw) as Partial<EtaAnchor & { targetKg: number }>
    if (a.targetKg !== targetKg || typeof a.date !== 'string' || typeof a.early !== 'string') return null
    return { date: a.date, early: a.early, late: typeof a.late === 'string' ? a.late : null }
  } catch {
    return null
  }
}

// A projeção de hoje com a âncora guardada, e a nova âncora guardada (a mesma
// se não mudou mais de uma semana). Só para a projeção de hoje: os meses
// passados e a semana anterior não mexem nela.
export function withAnchor(input: ProjInput): ProjInput {
  if (input.targetKg == null || typeof localStorage === 'undefined') return input
  const anchor = anchorFromStore(readScoped(localStorage, KEY), input.targetKg)
  const next = { ...input, anchor }
  const stored = anchorToStore(input.targetKg, project(next))
  if (stored) writeScoped(localStorage, KEY, stored)
  return next
}
