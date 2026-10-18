import { useEffect, useState } from 'react'
import { getApi } from './api'
import { activeUserId } from './scoped'

// As outras pessoas da casa, para «Também para …» no ＋ e «Partilhar com …»
// na folha da refeição. `shared`: esta refeição já está partilhada com ela;
// `shared_in`: das refeições do mesmo momento («Todo o jantar»), as que já
// têm cópia dela; `from`: foi ela que partilhou esta refeição.
export interface Person {
  user_id: string
  name: string
  shared?: boolean
  shared_in?: string[]
  from?: boolean
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
// `refresh` volta a perguntar (ex.: quando a análise acaba). Com `scope` (as
// outras refeições do mesmo momento), diz também quais já estão partilhadas.
export function usePeople(mealId?: string | null, refresh?: unknown, scope: readonly string[] = []): Person[] {
  const [people, setPeople] = useState<Person[]>([])
  const others = scope.filter((id) => id !== mealId).join(',')
  useEffect(() => {
    let alive = true
    const query = mealId ? `meal_id=${encodeURIComponent(mealId)}${others ? `&meal_ids=${others}` : ''}` : ''
    const request = mealId
      ? getApi<{ people: Person[] }>(`/api/meal/people?${query}`).then((r) => r.people)
      : loadPeople()
    request
      .then((list) => {
        if (alive) setPeople(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mealId, refresh, others])
  return people
}
