// «Pergunta à app»: as ações que a IA pode propor, numa lista fechada. O
// servidor valida-as aqui com Zod (só ids que foram no contexto, dias dos
// últimos 28, nunca no futuro, porções e copos dentro dos limites) e o
// telemóvel volta a validá-las antes de as mostrar. O servidor nunca as
// executa: cada uma aparece num cartão «Fazer» / «Não» e corre pelos
// caminhos de sempre da app (RLS, Anular). Também a conversa guardada no
// telemóvel e o que dela vai para o servidor. Sem supabase nem node: o
// telemóvel usa este ficheiro diretamente.
import { z } from 'zod'
import { shiftDate } from './nutritional-day.js'
import { SLOTS, SLOT_LABEL, type Slot } from './momentos.js'
import { PORTION_FACTORS } from './favoritos.js'
import { GLASS_ML, MAX_ITEM_GRAMS, mergeShopping, shoppingList, type ShoppingItem } from './extras.js'
import type { MealItem } from './meal-totals.js'

export const ASK_ACTION_TYPES = [
  'log_favorite',
  'repeat_meal',
  'add_shopping_items',
  'mark_day',
  'add_water',
  'share_meal',
] as const
export type AskActionType = (typeof ASK_ACTION_TYPES)[number]

export const DAY_FLAGS = ['dia_fechado', 'faltou_algo'] as const
export type DayFlag = (typeof DAY_FLAGS)[number]

export const ASK_MAX_ACTIONS = 3
// As ações só mexem nos últimos 28 dias (os que vão no contexto).
export const ASK_WINDOW_DAYS = 28
export const MAX_GLASSES = 12
export const MAX_SHOPPING_ITEMS = 30
export const MAX_SHOPPING_TIMES = 14
export const MAX_QUESTION_CHARS = 500
export const MAX_REPLY_CHARS = 1200

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const NAME = z.string().trim().min(1).max(80)
const SLOT = z.enum(SLOTS as [Slot, ...Slot[]])
const KCAL = z.number().min(0).max(10_000)
const PORTION = z.number().refine((f) => (PORTION_FACTORS as readonly number[]).includes(f))
const SHOPPING_ITEM = z.object({
  name: z.string().trim().min(1).max(60),
  grams: z.number().int().min(1).max(MAX_ITEM_GRAMS).nullable(),
})

// O que o telemóvel recebe (com os nomes para o cartão) e volta a validar.
export const AskActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('log_favorite'),
    favorite_id: z.string().uuid(),
    name: NAME,
    kcal: KCAL,
    date: DATE,
    slot: SLOT.nullable(),
    portion: PORTION,
  }),
  z.object({
    type: z.literal('repeat_meal'),
    meal_id: z.string().uuid(),
    name: NAME,
    kcal: KCAL,
    date: DATE,
    slot: SLOT.nullable(),
  }),
  z.object({
    type: z.literal('add_shopping_items'),
    items: z.array(SHOPPING_ITEM).min(1).max(MAX_SHOPPING_ITEMS),
  }),
  z.object({ type: z.literal('mark_day'), date: DATE, flag: z.enum(DAY_FLAGS) }),
  z.object({ type: z.literal('add_water'), date: DATE, glasses: z.number().int().min(1).max(MAX_GLASSES) }),
  z.object({
    type: z.literal('share_meal'),
    meal_id: z.string().uuid(),
    name: NAME,
    person_id: z.string().uuid(),
    person_name: NAME,
  }),
])
export type AskAction = z.infer<typeof AskActionSchema>

// O que a IA devolve: plano (o Gemini lida mal com uniões de objetos), com
// as referências curtas do contexto (f1, r1, p1) em vez dos ids.
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable()
export const AskAiSchema = z.object({
  reply: z.string(),
  actions: z.array(
    z.object({
      type: z.enum(ASK_ACTION_TYPES),
      favorite_id: nullable(z.string()),
      meal_id: nullable(z.string()),
      person_id: nullable(z.string()),
      date: nullable(z.string()),
      slot: nullable(SLOT),
      portion: nullable(z.number()),
      glasses: nullable(z.number()),
      flag: nullable(z.enum(DAY_FLAGS)),
      items: z.array(z.object({ name: z.string(), grams: nullable(z.number()) })),
      favorites: z.array(z.object({ favorite_id: z.string(), times: z.number() })),
    }),
  ),
})

// As referências que foram no contexto: só estas podem voltar nas ações.
export interface AskRefs {
  today: string
  favorites: Record<string, { id: string; name: string; kcal: number; default_slot: Slot | null; items: MealItem[] }>
  meals: Record<string, { id: string; name: string; kcal: number; date: string }>
  people: Record<string, { id: string; name: string }>
}

// Referências curtas por ordem (f1…f30), como os alimentos nas análises.
export function shortRefs<T extends { id: string }>(prefix: string, rows: T[]): { refs: Record<string, T>; byId: Map<string, string> } {
  const refs: Record<string, T> = {}
  const byId = new Map<string, string>()
  rows.forEach((row, i) => {
    const ref = `${prefix}${i + 1}`
    refs[ref] = row
    byId.set(row.id, ref)
  })
  return { refs, byId }
}

// Um dia dentro da janela das ações: entre há 28 dias e hoje.
export function inActionWindow(date: string, today: string): boolean {
  return DATE.safeParse(date).success && date <= today && date >= shiftDate(today, -ASK_WINDOW_DAYS)
}

const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const slotOrNull = (v: unknown): Slot | null => ((SLOTS as unknown[]).includes(v) ? (v as Slot) : null)
const round10 = (n: number) => Math.round(n / 10) * 10
// Só as chaves do próprio objeto («constructor» ou «__proto__» não são referências).
const refOf = <T>(map: Record<string, T>, key: unknown): T | undefined =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key.trim()) ? map[key.trim()] : undefined

// O dia de uma ação: o que a IA disse (tem de estar na janela) ou, quando o
// tipo o permite, hoje. undefined = inválido.
function actionDate(raw: unknown, today: string, fallbackToday: boolean): string | undefined {
  const date = str(raw)
  if (!date) return fallbackToday ? today : undefined
  return inActionWindow(date, today) ? date : undefined
}

// As compras: o que a IA escreveu e, para as favoritas, os alimentos delas ×
// as vezes (com as gramas somadas, como em Favoritas › Compras).
function shoppingItems(raw: Record<string, unknown>, refs: AskRefs): ShoppingItem[] {
  const selection: { items: MealItem[]; times: number }[] = []
  for (const entry of Array.isArray(raw.favorites) ? raw.favorites : []) {
    const e = record(entry)
    const favorite = refOf(refs.favorites, e.favorite_id)
    const times = num(e.times)
    if (!favorite || times == null || !Number.isInteger(times) || times < 1 || times > MAX_SHOPPING_TIMES) continue
    selection.push({ items: favorite.items, times })
  }
  const fromFavorites = shoppingList(selection).map((l) => ({ name: l.name, grams: l.grams > 0 ? Math.min(MAX_ITEM_GRAMS, l.grams) : null }))
  const written = (Array.isArray(raw.items) ? raw.items : []).map((entry) => {
    const e = record(entry)
    const grams = num(e.grams)
    return { name: str(e.name).slice(0, 60), grams: grams != null && grams >= 1 ? Math.round(grams) : null }
  })
  return mergeShopping([], [...fromFavorites, ...written]).slice(0, MAX_SHOPPING_ITEMS)
}

function candidate(raw: Record<string, unknown>, refs: AskRefs): unknown {
  const today = refs.today
  switch (raw.type) {
    case 'log_favorite': {
      const favorite = refOf(refs.favorites, raw.favorite_id)
      const portion = num(raw.portion) ?? 1
      if (!favorite) return null
      return {
        type: 'log_favorite',
        favorite_id: favorite.id,
        name: favorite.name,
        kcal: round10(favorite.kcal * portion),
        date: actionDate(raw.date, today, true),
        slot: slotOrNull(raw.slot) ?? favorite.default_slot,
        portion,
      }
    }
    case 'repeat_meal': {
      const meal = refOf(refs.meals, raw.meal_id)
      if (!meal) return null
      return {
        type: 'repeat_meal',
        meal_id: meal.id,
        name: meal.name,
        kcal: round10(meal.kcal),
        date: actionDate(raw.date, today, true),
        slot: slotOrNull(raw.slot),
      }
    }
    case 'add_shopping_items':
      return { type: 'add_shopping_items', items: shoppingItems(raw, refs) }
    case 'mark_day':
      // O dia tem de vir dito (marcar o dia errado mexe no gasto).
      return { type: 'mark_day', date: actionDate(raw.date, today, false), flag: raw.flag }
    case 'add_water':
      return { type: 'add_water', date: actionDate(raw.date, today, true), glasses: raw.glasses }
    case 'share_meal': {
      const meal = refOf(refs.meals, raw.meal_id)
      const person = refOf(refs.people, raw.person_id)
      if (!meal || !person) return null
      return { type: 'share_meal', meal_id: meal.id, name: meal.name, person_id: person.id, person_name: person.name }
    }
    default:
      return null
  }
}

// O que a IA propôs, validado: só tipos da lista, só referências que foram
// no contexto, cada ação uma vez e no máximo 3. O que não passa sai.
export function cleanActions(raw: unknown, refs: AskRefs): AskAction[] {
  return sortActions(raw, refs).actions
}

// O mesmo, a contar as que não passaram (referência ou dia que não existe).
export function sortActions(raw: unknown, refs: AskRefs): { actions: AskAction[]; dropped: number } {
  const out: AskAction[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const entry of Array.isArray(raw) ? raw : []) {
    const parsed = AskActionSchema.safeParse(candidate(record(entry), refs))
    if (!parsed.success) {
      dropped++
      continue
    }
    const key = JSON.stringify(parsed.data)
    if (seen.has(key)) continue
    seen.add(key)
    if (out.length < ASK_MAX_ACTIONS) out.push(parsed.data)
  }
  return { actions: out, dropped }
}

// A resposta promete muitas vezes o cartão («toca em Fazer»): se a ação que
// a IA propôs não passou, diz-se em vez de deixar a pessoa à procura dele.
export function replyWithActions(reply: string, actions: AskAction[], dropped: number): string {
  const note =
    dropped === 0
      ? ''
      : actions.length === 0
        ? 'Não consegui preparar isto para fazer aqui. Diz-me qual é a refeição, a favorita ou o dia.'
        : 'Uma das coisas não ficou pronta para fazer aqui. Diz-me qual é a refeição, a favorita ou o dia.'
  const text = reply || (actions.length ? 'Posso fazer isto:' : '')
  return [text, note].filter(Boolean).join('\n\n')
}

// No telemóvel, outra vez: a forma certa e um dia dentro da janela de hoje.
export function checkAction(raw: unknown, today: string): AskAction | null {
  const parsed = AskActionSchema.safeParse(raw)
  if (!parsed.success) return null
  const action = parsed.data
  if ('date' in action && !inActionWindow(action.date, today)) return null
  return action
}

// A resposta: texto simples e curto (sem markdown a mais).
export function cleanReply(raw: unknown): string {
  return str(raw)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_REPLY_CHARS)
    .trim()
}

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// «hoje», «ontem», «anteontem» ou «sex 16 out».
export function dayWord(date: string, today: string): string {
  if (date === today) return 'hoje'
  if (date === shiftDate(today, -1)) return 'ontem'
  if (date === shiftDate(today, -2)) return 'anteontem'
  const d = new Date(`${date}T12:00:00Z`)
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`
}

const PORTION_LABEL: Record<number, string> = { 0.5: '½ dose', 1.5: '1½ doses', 2: '2 doses' }
// Espaço que não parte (no cartão, «490» e «kcal» ficam na mesma linha).
const NBSP = '\u00a0'
const kcalText = (n: number) => `${String(round10(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}kcal`
const gramsText = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1).replace('.', ',')}${NBSP}kg` : `${g}${NBSP}g`)

// O texto do cartão, sempre a partir dos dados validados (nunca da IA).
export function actionLabel(action: AskAction, today: string): string {
  switch (action.type) {
    case 'log_favorite': {
      const parts = [
        dayWord(action.date, today),
        action.slot ? SLOT_LABEL[action.slot].toLowerCase() : null,
        PORTION_LABEL[action.portion] ?? null,
        kcalText(action.kcal),
      ].filter(Boolean)
      return `Registar «${action.name}» · ${parts.join(' · ')}`
    }
    case 'repeat_meal': {
      const parts = [dayWord(action.date, today), action.slot ? SLOT_LABEL[action.slot].toLowerCase() : null, kcalText(action.kcal)]
      return `Repetir «${action.name}» · ${parts.filter(Boolean).join(' · ')}`
    }
    case 'add_shopping_items': {
      const shown = action.items.slice(0, 3).map((i) => (i.grams != null ? `${i.name} ${gramsText(i.grams)}` : i.name))
      const rest = action.items.length - shown.length
      return `Juntar à lista de compras: ${shown.join(', ')}${rest > 0 ? ` e mais ${rest}` : ''}`
    }
    case 'mark_day': {
      const day = dayWord(action.date, today)
      return `Marcar ${day} como ${action.flag === 'dia_fechado' ? '«Sim, foi tudo»' : '«Não, faltou algo»'}`
    }
    case 'add_water':
      return `Juntar ${action.glasses} ${action.glasses === 1 ? 'copo' : 'copos'} de água · ${dayWord(action.date, today)} (${action.glasses * GLASS_ML}${NBSP}ml)`
    case 'share_meal':
      return `Partilhar «${action.name}» com ${action.person_name}`
  }
}

// --- A conversa (guardada no telemóvel) ---------------------------------
// Cada pessoa tem a sua, das últimas 10 mensagens; ao servidor vão só as 6
// últimas, com o que aconteceu às ações propostas.
export const ASK_TURNS_KEPT = 10
export const ASK_TURNS_SENT = 6
export const MAX_TURN_CHARS = 1500

// Uma ação que falhou continua por fazer (o aviso diz porquê; pode tentar-se outra vez).
export type ActionState = 'por_fazer' | 'feito' | 'nao'
export interface AskTurn {
  from: 'me' | 'app'
  text: string
  actions?: { action: AskAction; state: ActionState }[]
}

const STATE_TEXT: Record<ActionState, string> = {
  por_fazer: 'por responder',
  feito: 'feito',
  nao: 'a pessoa disse que não',
}

export function keepTurns(turns: AskTurn[], max = ASK_TURNS_KEPT): AskTurn[] {
  return turns.slice(-max)
}

// A conversa guardada (sessionStorage) pode vir estragada ou de outra versão:
// só o que tem a forma certa, com as ações validadas outra vez.
export function parseTurns(raw: string | null, today: string): AskTurn[] {
  let data: unknown
  try {
    data = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  const out: AskTurn[] = []
  for (const entry of Array.isArray(data) ? data : []) {
    const e = record(entry)
    if ((e.from !== 'me' && e.from !== 'app') || typeof e.text !== 'string') continue
    const actions = (Array.isArray(e.actions) ? e.actions : [])
      .map((a) => {
        const r = record(a)
        const action = checkAction(r.action, today)
        const state = (['por_fazer', 'feito', 'nao'] as unknown[]).includes(r.state) ? (r.state as ActionState) : 'nao'
        return action ? { action, state } : null
      })
      .filter((a): a is { action: AskAction; state: ActionState } => a != null)
    out.push({ from: e.from, text: e.text.slice(0, MAX_TURN_CHARS), ...(actions.length ? { actions } : {}) })
  }
  return keepTurns(out)
}

export function turnsForServer(turns: AskTurn[], today: string): { from: 'me' | 'app'; text: string }[] {
  return turns.slice(-ASK_TURNS_SENT).map((turn) => {
    const done = (turn.actions ?? []).map((a) => `${actionLabel(a.action, today).replace(/\u00a0/g, ' ')} (${STATE_TEXT[a.state]})`)
    const text = done.length ? `${turn.text}\n[Propus: ${done.join('; ')}]` : turn.text
    return { from: turn.from, text: text.slice(0, MAX_TURN_CHARS) }
  })
}
