// A porção de uma refeição já analisada (na folha da refeição, também em
// «Todo o jantar» e nas cópias partilhadas) e a divisão ao partilhar («A
// meias», «João 60 · Joana 40»). Sem imports de servidor: o telemóvel usa
// este ficheiro diretamente.
import { PORTION_FACTORS, portionLabel } from './favoritos.js'
import { SLOT_LABEL, slotOf, type Slot } from './momentos.js'

// A porção gravada: de 0,1 a 3, com duas casas no máximo (a coluna é
// numeric(4,2)). As de uma divisão (0,6 · 0,4) também cabem.
export const MIN_FACTOR = 0.1
export const MAX_FACTOR = 3

// Numa refeição (dia e momento) não há mais do que isto de uma vez.
export const MAX_SLOT_MEALS = 12

// O Anular de uma porção ou de uma partilha: as refeições de quem pede e as
// cópias delas (no máximo 3 pessoas a receber).
export const MAX_UNDO_ROWS = MAX_SLOT_MEALS * 4

const EPS = 1e-6

function twoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < EPS
}

export function roundFactor(f: number): number {
  return Math.round(f * 100) / 100
}

export function isFactor(f: unknown): f is number {
  return typeof f === 'number' && Number.isFinite(f) && f >= MIN_FACTOR - EPS && f <= MAX_FACTOR + EPS && twoDecimals(f)
}

function clampFactor(f: number): number {
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, roundFactor(f)))
}

// A porção de uma linha lida da base (pode vir como texto ou vazia).
export function factorOf(value: unknown): number {
  const f = Number(value ?? 1)
  return Number.isFinite(f) && f > 0 ? f : 1
}

// Os botões da porção: ½ · 1 · 1½ · 2 e, se a atual for outra (a 0,6 de uma
// divisão), também ela, por ordem, para se ver qual é.
export function portionRow(current: number): number[] {
  const row: number[] = [...PORTION_FACTORS]
  if (isFactor(current) && !row.some((f) => Math.abs(f - current) < EPS)) row.push(current)
  return row.sort((a, b) => a - b)
}

export function sameFactor(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS
}

// ---------------------------------------------------------------- «Todo o jantar»

export interface ScopeMeal {
  id: string
  date: string
  slot: Slot | null
  logged_at: string
  status: string
  items: readonly unknown[] | null
  deleted_at: string | null
}

// A porção só muda numa refeição analisada (ok ou por rever), com itens e
// não apagada.
export function canChangePortion(meal: Pick<ScopeMeal, 'status' | 'items' | 'deleted_at'>): boolean {
  return (meal.status === 'ok' || meal.status === 'por_rever') && (meal.items?.length ?? 0) > 0 && meal.deleted_at == null
}

export function mealSlot(meal: Pick<ScopeMeal, 'slot' | 'logged_at'>): Slot {
  return meal.slot ?? slotOf(new Date(meal.logged_at))
}

// As refeições da pessoa no mesmo dia e momento que a aberta (ela primeiro,
// as outras pela hora): o jantar de entrega em 5 fotos. Só as analisadas.
export function slotScope<T extends ScopeMeal>(open: T, dayMeals: readonly T[]): T[] {
  if (!canChangePortion(open)) return [open]
  const slot = mealSlot(open)
  const others = dayMeals
    .filter((m) => m.id !== open.id && m.date === open.date && mealSlot(m) === slot && canChangePortion(m))
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  return [open, ...others].slice(0, MAX_SLOT_MEALS)
}

// «Todo o jantar (5)», «Toda a ceia (2)».
export function slotScopeLabel(slot: Slot, count: number): string {
  return `${slot === 'ceia' ? 'Toda a' : 'Todo o'} ${SLOT_LABEL[slot].toLowerCase()} (${count})`
}

// ---------------------------------------------------------------- dividir ao partilhar

// A divisão é a parte de quem partilha: 0,5 a meias, 0,6 = «João 60 ·
// Joana 40». Sem divisão (null), cada um comeu isto tudo (como antes).
export const HALF_SPLIT = 0.5
export const OTHER_SPLITS = [0.7, 0.6, 0.4, 0.3] as const

export function isSplit(split: unknown): split is number {
  return typeof split === 'number' && Number.isFinite(split) && split >= 0.1 - EPS && split <= 0.9 + EPS && twoDecimals(split)
}

// A divisão só vale entre duas pessoas: com mais de uma a receber, cada um
// comeu isto tudo.
export function splitFor(targets: number, split: unknown): number | null {
  return targets === 1 && isSplit(split) ? split : null
}

// As porções depois de dividir. A refeição como está registada (com a porção
// que já tem) é o que havia na mesa: cada um fica com a sua parte dela.
export function splitFactors(current: number, split: number | null): { own: number; copy: number } {
  const base = factorOf(current)
  if (split == null || !isSplit(split)) return { own: base, copy: base }
  return { own: clampFactor(base * split), copy: clampFactor(base * (1 - split)) }
}

function percent(n: number): number {
  return Math.round(n * 100)
}

// O que diz a escolha: «A meias», «João 60 · Joana 40», «Cada um comeu isto».
export function splitLabel(split: number | null, me: string, other: string): string {
  if (split == null) return 'Cada um comeu isto'
  if (sameFactor(split, HALF_SPLIT)) return 'A meias'
  return `${me} ${percent(split)} · ${other} ${percent(1 - split)}`
}

// O mesmo nas frases (o aviso, «Depois vai também para …»): «a meias» (sem
// partir a linha), «João 60 · Joana 40»; sem divisão, nada.
export function splitText(split: number | null | undefined, me: string, other: string): string | null {
  if (split == null || !isSplit(split)) return null
  return sameFactor(split, HALF_SPLIT) ? 'a\u00a0meias' : splitLabel(split, me, other)
}

// ---------------------------------------------------------------- Anular

// A porção de antes de cada linha mudada (das refeições de quem pede e das
// cópias delas), para o Anular voltar exatamente a essas linhas.
export interface FactorChange {
  meal_id: string
  factor: number
}

// O Anular revalidado no servidor: só as refeições de quem pede (lidas com o
// RLS) e as que ainda são cópias delas noutras contas. O resto (um id de
// outra pessoa, repetido, uma porção impossível) fica de fora.
export function undoPlan(
  changes: readonly FactorChange[],
  ownIds: Iterable<string>,
  copyIds: Iterable<string>,
): { own: FactorChange[]; copies: FactorChange[] } {
  const own = new Set(ownIds)
  const copies = new Set(copyIds)
  const seen = new Set<string>()
  const plan = { own: [] as FactorChange[], copies: [] as FactorChange[] }
  for (const change of changes.slice(0, MAX_UNDO_ROWS)) {
    if (seen.has(change.meal_id) || !isFactor(change.factor)) continue
    seen.add(change.meal_id)
    if (own.has(change.meal_id)) plan.own.push(change)
    else if (copies.has(change.meal_id)) plan.copies.push(change)
  }
  return plan
}

export interface CopyRow {
  id: string
  user_id: string
  source_meal_id: string | null
  deleted_at: string | null
}

// As cópias vivas das refeições de quem pede, nas contas das outras pessoas.
// O cliente de serviço lê-as; esta é a guarda de que não passa mais nada.
export function liveCopies<T extends CopyRow>(rows: readonly T[], ownIds: Iterable<string>, selfId: string): T[] {
  const own = new Set(ownIds)
  return rows.filter((r) => r.user_id !== selfId && r.deleted_at == null && r.source_meal_id != null && own.has(r.source_meal_id))
}

// As fotos de uma cópia que o Anular pode apagar: só as da pasta dela
// (`<pessoa>/partilhada-<cópia>/…`), nunca as de quem partilhou.
export function copyPhotos(copy: { id: string; user_id: string }, paths: readonly (string | null | undefined)[]): string[] {
  const prefix = `${copy.user_id}/partilhada-${copy.id}/`
  const out: string[] = []
  for (const path of paths) {
    if (path && path.startsWith(prefix) && !path.includes('..') && !out.includes(path)) out.push(path)
  }
  return out
}

// ---------------------------------------------------------------- avisos

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

type Kcal = (n: number) => string

function kcalDelta(delta: number, kcal: Kcal): string {
  if (Math.abs(delta) < 5) return 'as mesmas kcal'
  return delta < 0 ? `−${kcal(-delta)} kcal` : `+${kcal(delta)} kcal`
}

// «Porção ½ · 5 refeições · também nas de Joana · −1 010 kcal». `count`:
// as refeições de quem pede que mudaram; `copies`: as cópias que mudaram.
export function portionToast(
  o: { factor: number; count: number; copies: number; sharedWith: readonly string[]; kcalDelta: number },
  kcal: Kcal,
): string {
  const label = `Porção ${portionLabel(o.factor)}`
  const where = `${o.copies > 1 ? 'nas' : 'na'} de ${joinNames(o.sharedWith)}`
  if (o.count === 0) return o.copies > 0 && o.sharedWith.length ? `${label} ${where}` : `A porção já era ${portionLabel(o.factor)}.`
  const parts = [label]
  if (o.count > 1) parts.push(`${o.count} refeições`)
  if (o.copies > 0 && o.sharedWith.length) parts.push(`também ${where}`)
  parts.push(kcalDelta(o.kcalDelta, kcal))
  return parts.join(' · ')
}

// «Partilhadas com Joana · 5 refeições · a meias · −1 010 kcal». Uma só,
// sem divisão, diz o que já dizia.
export function shareToast(
  o: { to: string; shared: number; already: number; split: number | null; me: string; kcalDelta: number },
  kcal: Kcal,
): string {
  if (o.shared === 0) return o.already > 1 ? `Já estavam partilhadas com ${o.to}.` : `Já estava partilhada com ${o.to}.`
  if (o.split == null && o.shared === 1 && o.already === 0) {
    return `Partilhada com ${o.to}. Aparece-lhe no Hoje para confirmar a porção.`
  }
  const parts = [`${o.shared > 1 ? 'Partilhadas' : 'Partilhada'} com ${o.to}`]
  if (o.shared > 1) parts.push(`${o.shared} refeições`)
  const split = splitText(o.split, o.me, o.to)
  if (split) parts.push(split)
  if (o.already > 0) parts.push(`${o.already} já ${o.already > 1 ? 'estavam' : 'estava'}`)
  if (split) parts.push(kcalDelta(o.kcalDelta, kcal))
  return parts.join(' · ')
}
