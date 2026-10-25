import { postApi } from './api'
import { readScoped, writeScoped } from './scoped'
import { addShoppingItems, readShoppingExtra, setShoppingExtra } from './compras'
import { answerDay } from './day-flag'
import { logFavorite, repeatMeal } from './meal-actions'
import { emitDataChanged } from './events'
import type { ToastAction } from './toast'
import {
  checkAction,
  dayWord,
  keepTurns,
  parseTurns,
  turnsForServer,
  type AskAction,
  type AskTurn,
} from '../../api/_lib/rules/pergunta-acoes'
import { SLOT_LABEL } from '../../api/_lib/rules/momentos'

type ShowToast = (text: string, actions?: ToastAction[]) => void

// «Pergunta à app» no telemóvel: a conversa de cada pessoa fica na sessão
// (sessionStorage, as últimas 10 mensagens; fechar a app recomeça), ao
// servidor vão só as últimas, e as ações propostas correm aqui pelos
// caminhos de sempre (RLS, Anular), só depois de «Fazer».
const KEY = 'pergunta.conversa'

export function loadTurns(today: string): AskTurn[] {
  try {
    return parseTurns(readScoped(sessionStorage, KEY), today)
  } catch {
    return []
  }
}

export function saveTurns(turns: AskTurn[]): void {
  try {
    writeScoped(sessionStorage, KEY, turns.length ? JSON.stringify(keepTurns(turns)) : null)
  } catch {
    // sem armazenamento: a conversa fica só até fechar a folha
  }
}

// Pergunta ao servidor; as ações voltam a ser validadas antes de aparecerem.
export async function askApp(question: string, turns: AskTurn[], today: string): Promise<AskTurn> {
  const result = await postApi<{ reply: string; actions?: unknown[] }>('/api/day/ask', {
    question,
    history: turnsForServer(turns, today),
    shopping: readShoppingExtra().slice(0, 60),
  })
  const actions = (result.actions ?? [])
    .map((raw) => checkAction(raw, today))
    .filter((a): a is AskAction => a != null)
    .map((action) => ({ action, state: 'por_fazer' as const }))
  return { from: 'app', text: result.reply, ...(actions.length ? { actions } : {}) }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')

// «Fazer»: cada tipo pelo caminho que a app já usa, com o mesmo aviso (e o
// mesmo Anular). Devolve se ficou feito.
export async function runAskAction(
  action: AskAction,
  today: string,
  toast: ShowToast,
  navigate: (to: string) => void,
): Promise<boolean> {
  switch (action.type) {
    case 'log_favorite': {
      const when = [dayWord(action.date, today), action.slot ? SLOT_LABEL[action.slot].toLowerCase() : null].filter(Boolean).join(' · ')
      return logFavorite({ id: action.favorite_id, name: action.name }, action.date, toast, action.slot, when, action.portion)
    }
    case 'repeat_meal': {
      const when = [dayWord(action.date, today), action.slot ? SLOT_LABEL[action.slot].toLowerCase() : null].filter(Boolean).join(' · ')
      return repeatMeal(action.meal_id, action.date, `Registado · ${action.name} · ${when}`, toast, action.slot)
    }
    case 'add_shopping_items': {
      const before = addShoppingItems(action.items)
      const count = action.items.length
      toast(`Na lista de compras · ${count} ${count === 1 ? 'coisa' : 'coisas'}`, [
        { label: 'Ver', run: () => navigate('/favoritos?separador=compras') },
        { label: 'Anular', run: () => setShoppingExtra(before) },
      ])
      return true
    }
    case 'mark_day':
      return answerDay(action.date, action.flag, today, toast)
    case 'share_meal': {
      try {
        const result = await postApi<{ ok: boolean; to: string; already?: boolean }>('/api/meal/share', {
          meal_id: action.meal_id,
          to_user_id: action.person_id,
        })
        emitDataChanged()
        toast(
          result.already
            ? `Já estava partilhada com ${result.to}.`
            : `Partilhada com ${result.to}. Fica em «Rever» na conta de ${result.to}, para ajustar a porção.`,
        )
        return true
      } catch (err) {
        toast(errorText(err))
        return false
      }
    }
  }
}
