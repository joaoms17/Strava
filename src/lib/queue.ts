// Fila antiga (Fase 1) de refeições de texto. As capturas novas vão para
// capture-queue; esta só esvazia o que já lá estava.
import { STORES, inStore as inAnyStore } from './idb'

export interface QueuedMeal {
  id: string
  text: string
  jantar_fora: boolean
  logged_at: string
}

function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return inAnyStore(STORES.meals, mode, run)
}

export async function enqueueMeal(
  text: string,
  jantarFora: boolean,
  loggedAt: string = new Date().toISOString(),
): Promise<void> {
  await inStore('readwrite', (store) =>
    store.add({
      id: crypto.randomUUID(),
      text,
      jantar_fora: jantarFora,
      logged_at: loggedAt,
    }),
  )
}

export async function listQueuedMeals(): Promise<QueuedMeal[]> {
  return inStore('readonly', (store) => store.getAll() as IDBRequest<QueuedMeal[]>)
}

export async function removeQueuedMeal(id: string): Promise<void> {
  await inStore('readwrite', (store) => store.delete(id))
}
