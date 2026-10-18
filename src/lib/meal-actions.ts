import { postApi } from './api'
import { emitDataChanged } from './events'
import { fmtKcal } from './format'
import { recomputeFrom } from './recompute'
import type { Person } from './people'
import type { ToastAction } from './toast'
import type { Favorite, Meal, Slot } from './types'
import { PORTION_FACTORS, portionLabel } from '../../api/_lib/rules/favoritos'
import { portionToast, shareToast, type FactorChange } from '../../api/_lib/rules/porcoes'

type ShowToast = (text: string, actions?: ToastAction[]) => void

// As porções do aviso «Registado» (a 1 é a que fica).
const PORTIONS: [string, number][] = PORTION_FACTORS.filter((f) => f !== 1).map((f) => [portionLabel(f), f])

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.'
}

async function undoInsert(meal: Meal, toast: ShowToast) {
  try {
    await postApi('/api/meal/delete', { meal_id: meal.id })
    emitDataChanged()
    toast('Anulado.')
  } catch (err) {
    toast(errorText(err))
  }
}

// Favorita com 1 toque: regista e mostra «Registado · ×½ · ×1½ · ×2 · Anular».
// Com uma refeição escolhida (slot), fica nela e à hora habitual dela; com
// uma porção (a «Pergunta à app»), já nessa porção. Devolve se gravou.
export async function logFavorite(
  favorite: Pick<Favorite, 'id' | 'name'>,
  date: string | null,
  toast: ShowToast,
  slot: Slot | null = null,
  whenText: string | null = null,
  factor = 1,
): Promise<boolean> {
  try {
    const { meal } = await postApi<{ meal: Meal }>('/api/meal/log-favorite', {
      favorite_id: favorite.id,
      ...(date ? { date } : {}),
      ...(slot ? { slot } : {}),
      ...(factor !== 1 ? { factor } : {}),
    })
    emitDataChanged()
    showRegistered(meal, `Registado · ${favorite.name}${whenText ? ` · ${whenText}` : ''}`, toast)
    return true
  } catch (err) {
    toast(errorText(err))
    return false
  }
}

// Fora da dose normal (a porção pedida à «Pergunta à app» ou já mudada),
// também se pode voltar a 1.
function portionChoices(current: number): [string, number][] {
  const choices: [string, number][] = current === 1 ? PORTIONS : [['1', 1], ...PORTIONS]
  return choices.filter(([, f]) => f !== current)
}

function showRegistered(meal: Meal, text: string, toast: ShowToast) {
  toast(text, [
    // «×½ · ×1½ · ×2»: o × diz que é a porção (as ações vão para uma 2.ª linha).
    ...portionChoices(Number(meal.portion_factor ?? 1)).map(([label, factor]) => ({
      label: `×${label}`,
      busy: 'A mudar a porção…',
      run: async () => {
        try {
          const { meal: updated } = await postApi<{ meal: Meal }>('/api/meal/portion', {
            meal_id: meal.id,
            factor,
          })
          emitDataChanged()
          showRegistered(updated, `Porção ${label} · ${fmtKcal(Number(updated.kcal))} kcal`, toast)
        } catch (err) {
          toast(errorText(err))
        }
      },
    })),
    { label: 'Anular', run: () => undoInsert(meal, toast) },
  ])
}

// «Igual a ontem», «Repetir uma refeição», «Repetir hoje» e «Copiar para
// outro dia». Sem refeição escolhida, a mesma hora do original.
export async function repeatMeal(
  mealId: string,
  date: string | null,
  text: string,
  toast: ShowToast,
  slot: Slot | null = null,
): Promise<boolean> {
  try {
    const { meal } = await postApi<{ meal: Meal }>('/api/meal/repeat', {
      meal_id: mealId,
      ...(date ? { date } : {}),
      ...(slot ? { slot } : {}),
    })
    emitDataChanged()
    toast(text, [{ label: 'Anular', run: () => undoInsert(meal, toast) }])
    return true
  } catch (err) {
    toast(errorText(err))
    return false
  }
}

export async function deleteMeal(mealId: string, toast: ShowToast) {
  try {
    await postApi('/api/meal/delete', { meal_id: mealId })
    emitDataChanged()
    toast('Apagado', [
      {
        label: 'Anular',
        run: async () => {
          try {
            await postApi('/api/meal/restore', { meal_id: mealId })
            emitDataChanged()
          } catch (err) {
            toast(errorText(err))
          }
        },
      },
    ])
  } catch (err) {
    toast(errorText(err))
  }
}

// «Tentar outra vez» numa refeição que falhou ou parou: a análise recomeça
// do zero (3 tentativas novas). Devolve false se o servidor recusou.
export async function retryAnalysis(mealId: string, toast: ShowToast): Promise<boolean> {
  try {
    const result = await postApi<{ meal: Meal; limit?: boolean }>('/api/meal/analyse', { meal_id: mealId, reset: true })
    emitDataChanged()
    if (result.limit) toast('Chegaste ao limite da IA. Abre a refeição para analisar mesmo assim.')
    else if (result.meal.status === 'erro') toast(result.meal.analysis_error?.split('\n')[0] ?? 'Voltou a falhar.')
    return true
  } catch (err) {
    emitDataChanged()
    toast(errorText(err))
    return false
  }
}

// A porção de antes de cada linha que mudou (as cópias vêm marcadas).
export type PortionChange = FactorChange & { copy?: boolean }

export interface PortionAnswer {
  meal: Meal
  meals: Meal[]
  previous: PortionChange[]
  copies: number
  shared_with: string[]
  kcal_delta: number
}

// A porção na folha da refeição: nesta, nas outras do mesmo momento
// («Todo o jantar», `mealIds`) e, com `withShared`, nas cópias que outras
// pessoas receberam. O aviso diz o que mudou, com Anular (volta cada linha à
// porção de antes). Não ensina a biblioteca: é a porção, não os alimentos.
export async function changePortion(o: {
  meal: Pick<Meal, 'id' | 'date'>
  factor: number
  mealIds?: string[]
  withShared?: boolean
  today: string
  toast: ShowToast
  onUndone?: () => void
}): Promise<PortionAnswer | null> {
  const { meal, factor, mealIds = [], withShared = false, today, toast } = o
  try {
    const result = await postApi<PortionAnswer>('/api/meal/portion', {
      meal_id: meal.id,
      factor,
      ...(mealIds.length ? { meal_ids: mealIds } : {}),
      ...(withShared ? { with_shared: true } : {}),
    })
    emitDataChanged()
    recomputeFrom(meal.date, today)
    const copies = result.previous.filter((p) => p.copy).length
    const text = portionToast(
      {
        factor,
        count: result.previous.length - copies,
        copies,
        sharedWith: result.shared_with,
        kcalDelta: result.kcal_delta,
      },
      fmtKcal,
    )
    toast(
      text,
      result.previous.length
        ? [
            {
              label: 'Anular',
              run: async () => {
                try {
                  await postApi('/api/meal/portion-undo', { changes: result.previous })
                  emitDataChanged()
                  recomputeFrom(meal.date, today)
                  o.onUndone?.()
                } catch (err) {
                  toast(errorText(err))
                }
              },
            },
          ]
        : [],
    )
    return result
  } catch (err) {
    toast(errorText(err))
    return null
  }
}

export interface ShareAnswer {
  ok: boolean
  to: string
  shared: number
  already?: boolean
  already_count: number
  split: number | null
  meals: Meal[]
  kcal_delta: number
  undo: { copies: string[]; changes: FactorChange[] }
}

// «Partilhar com …» com a divisão escolhida (`split`: a parte de quem
// partilha; null, cada um comeu isto tudo), também para as outras do mesmo
// momento (`mealIds`). Anular apaga as cópias e volta a porção de antes.
export async function shareMeals(o: {
  meal: Pick<Meal, 'id' | 'date'>
  person: Person
  mealIds?: string[]
  split: number | null
  me: string
  today: string
  toast: ShowToast
  onUndone?: () => void
}): Promise<ShareAnswer | null> {
  const { meal, person, mealIds = [], split, me, today, toast } = o
  try {
    const result = await postApi<ShareAnswer>('/api/meal/share', {
      meal_id: meal.id,
      to_user_id: person.user_id,
      ...(mealIds.length ? { meal_ids: mealIds } : {}),
      ...(split != null ? { split } : {}),
    })
    emitDataChanged()
    if (result.meals.length) recomputeFrom(meal.date, today)
    const text = shareToast(
      {
        to: result.to,
        shared: result.shared,
        already: result.already_count ?? (result.already ? 1 : 0),
        split,
        me,
        kcalDelta: result.kcal_delta ?? 0,
      },
      fmtKcal,
    )
    const undo = result.undo
    toast(
      text,
      undo?.copies.length
        ? [
            {
              label: 'Anular',
              run: async () => {
                try {
                  await postApi('/api/meal/share-undo', undo)
                  emitDataChanged()
                  if (undo.changes.length) recomputeFrom(meal.date, today)
                  o.onUndone?.()
                } catch (err) {
                  toast(errorText(err))
                }
              },
            },
          ]
        : [],
    )
    return result
  } catch (err) {
    toast(errorText(err))
    return null
  }
}
