import { useEffect, useState } from 'react'
import { getApi } from './api'
import { activeUserId } from './scoped'

// As outras pessoas da casa, para «Também para …» no ＋ e «Partilhar com …»
// na folha da refeição. `shared`: esta refeição já está partilhada com ela.
export interface Person {
  user_id: string
  name: string
  shared?: boolean
}

// A lista lê-se uma vez por pessoa da app enquanto a app está aberta (o ＋
// abre-se muitas vezes e a lista quase nunca muda).
const cache = new Map<string, Promise<Person[]>>()

function loadPeople(): Promise<Person[]> {
  const key = activeUserId() ?? ''
  let list = cache.get(key)
  if (!list) {
    list = getApi<{ people: Person[] }>('/api/meal/people').then((r) => r.people)
    // Uma falha não fica guardada: a próxima vez tenta outra vez.
    list.catch(() => cache.delete(key))
    cache.set(key, list)
  }
  return list
}

// Com `mealId`, pergunta sempre ao servidor (com quem já está partilhada);
// `refresh` volta a perguntar (ex.: quando a análise acaba).
export function usePeople(mealId?: string | null, refresh?: unknown): Person[] {
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => {
    let alive = true
    const request = mealId
      ? getApi<{ people: Person[] }>(`/api/meal/people?meal_id=${encodeURIComponent(mealId)}`).then((r) => r.people)
      : loadPeople()
    request
      .then((list) => {
        if (alive) setPeople(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mealId, refresh])
  return people
}
