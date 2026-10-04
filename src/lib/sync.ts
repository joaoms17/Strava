import { useCallback, useEffect, useState } from 'react'
import { postApi } from './api'
import { listQueuedMeals, removeQueuedMeal, type QueuedMeal } from './queue'
import { listCaptures, ownCapture } from './capture-queue'
import { supabase } from './supabase'
import { emitDataChanged } from './events'
import type { Meal, ParsedMealResponse } from './types'

// Fila offline das refeições de texto: envia ao abrir, ao voltar a rede e
// quando a app regressa ao primeiro plano.
let running = false

export async function syncQueuedMeals(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  try {
    const queued = await listQueuedMeals().catch(() => [] as QueuedMeal[])
    for (const entry of queued) {
      try {
        const parsed = await postApi<ParsedMealResponse>('/api/meal/parse-text', {
          text: entry.text,
          jantar_fora: entry.jantar_fora,
        })
        await postApi<{ meal: Meal }>('/api/meal/save', {
          input_type: 'text',
          raw_text: entry.text,
          photo_path: null,
          items: parsed.items,
          is_estimate: parsed.is_estimate,
          confidence: parsed.confidence,
          prompt_version: parsed.prompt_version,
          model: parsed.model,
          cost_usd: parsed.cost_usd,
          logged_at: entry.logged_at,
        })
        await removeQueuedMeal(entry.id)
        emitDataChanged()
      } catch {
        break // sem rede outra vez (ou erro) — fica para a próxima
      }
    }
  } finally {
    running = false
  }
}

export function useQueueCount(): number {
  const [count, setCount] = useState(0)
  const refresh = useCallback(async () => {
    try {
      const [legacy, captures, { data }] = await Promise.all([
        listQueuedMeals(),
        listCaptures(),
        supabase.auth.getSession(),
      ])
      const userId = data.session?.user.id ?? null
      setCount(legacy.length + captures.filter((c) => c.state === 'pendente' && ownCapture(c, userId)).length)
    } catch {
      setCount(0)
    }
  }, [])

  useEffect(() => {
    const run = () => void syncQueuedMeals().finally(() => void refresh())
    run()
    const onVisible = () => {
      if (!document.hidden) run()
    }
    window.addEventListener('online', run)
    window.addEventListener('regresso:data', refresh)
    window.addEventListener('regresso:captures', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', run)
      window.removeEventListener('regresso:data', refresh)
      window.removeEventListener('regresso:captures', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  return count
}
