// Fila offline de refeições de texto (IndexedDB). Fotos ficam de fora:
// o upload precisa de rede de qualquer maneira e o texto não se perde.
const DB_NAME = 'regresso'
const STORE = 'meal_queue'

export interface QueuedMeal {
  id: string
  text: string
  jantar_fora: boolean
  logged_at: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'))
  })
}

async function inStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Falha na fila offline'))
    })
  } finally {
    db.close()
  }
}

export async function enqueueMeal(text: string, jantarFora: boolean): Promise<void> {
  await inStore('readwrite', (store) =>
    store.add({
      id: crypto.randomUUID(),
      text,
      jantar_fora: jantarFora,
      logged_at: new Date().toISOString(),
    }),
  )
}

export async function listQueuedMeals(): Promise<QueuedMeal[]> {
  return inStore('readonly', (store) => store.getAll() as IDBRequest<QueuedMeal[]>)
}

export async function removeQueuedMeal(id: string): Promise<void> {
  await inStore('readwrite', (store) => store.delete(id))
}
