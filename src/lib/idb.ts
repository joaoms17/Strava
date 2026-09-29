// Base local (IndexedDB) da app: a fila antiga de refeições de texto e a fila
// das capturas (fotos e textos) que ainda não chegaram ao servidor.
const DB_NAME = 'regresso'
const VERSION = 2
export const STORES = { meals: 'meal_queue', captures: 'captures' } as const

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORES.meals)) db.createObjectStore(STORES.meals, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.captures)) {
        db.createObjectStore(STORES.captures, { keyPath: 'client_id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'))
  })
}

export async function inStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode)
      const request = run(tx.objectStore(store))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Falha na base local'))
      tx.onabort = () => reject(tx.error ?? new Error('Falha na base local'))
    })
  } finally {
    db.close()
  }
}
