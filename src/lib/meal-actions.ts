import { postApi } from './api'
import { emitDataChanged } from './events'
import { fmtKcal } from './format'
import type { ToastAction } from './toast'
import type { Favorite, Meal } from './types'

type ShowToast = (text: string, actions?: ToastAction[]) => void

const PORTIONS: [string, number][] = [
  ['½', 0.5],
  ['1½', 1.5],
  ['2', 2],
]

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

// Favorito com 1 toque: regista e mostra «Registado · ½ · 1½ · 2 · Anular».
export async function logFavorite(favorite: Favorite, date: string | null, toast: ShowToast) {
  try {
    const { meal } = await postApi<{ meal: Meal }>('/api/meal/log-favorite', {
      favorite_id: favorite.id,
      ...(date ? { date } : {}),
    })
    emitDataChanged()
    showRegistered(meal, `Registado · ${favorite.name}`, toast)
  } catch (err) {
    toast(errorText(err))
  }
}

function showRegistered(meal: Meal, text: string, toast: ShowToast) {
  toast(text, [
    ...PORTIONS.filter(([, f]) => f !== Number(meal.portion_factor)).map(([label, factor]) => ({
      label,
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

// «Igual a ontem», «Repetir hoje» e «Copiar para outro dia».
export async function repeatMeal(mealId: string, date: string | null, text: string, toast: ShowToast) {
  try {
    const { meal } = await postApi<{ meal: Meal }>('/api/meal/repeat', {
      meal_id: mealId,
      ...(date ? { date } : {}),
    })
    emitDataChanged()
    toast(text, [{ label: 'Anular', run: () => undoInsert(meal, toast) }])
  } catch (err) {
    toast(errorText(err))
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
