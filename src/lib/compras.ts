import { readScoped, writeScoped } from './scoped'
import { mergeShopping, type ShoppingItem } from '../../api/_lib/rules/extras'

// O que se juntou à lista de compras fora das favoritas (pela «Pergunta à
// app»): fica no telemóvel, de cada pessoa, até se tirar. A lista das
// favoritas (× vezes) continua a fazer-se em Favoritas › Compras.
const KEY = 'lista-compras-extra'
const EVENT = 'regresso:compras'

export function readShoppingExtra(): ShoppingItem[] {
  try {
    const data = JSON.parse(readScoped(localStorage, KEY) ?? '[]') as unknown
    if (!Array.isArray(data)) return []
    return data
      .filter((i): i is ShoppingItem => !!i && typeof i.name === 'string' && (i.grams == null || typeof i.grams === 'number'))
      .map((i) => ({ name: i.name, grams: i.grams ?? null }))
  } catch {
    return []
  }
}

function write(items: ShoppingItem[]): void {
  writeScoped(localStorage, KEY, items.length ? JSON.stringify(items) : null)
  window.dispatchEvent(new Event(EVENT))
}

// Junta (as gramas do mesmo alimento somam-se) e devolve a lista de antes, para Anular.
export function addShoppingItems(items: ShoppingItem[]): ShoppingItem[] {
  const before = readShoppingExtra()
  write(mergeShopping(before, items))
  return before
}

export function setShoppingExtra(items: ShoppingItem[]): void {
  write(items)
}

export function onShoppingChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
