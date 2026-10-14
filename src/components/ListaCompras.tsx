import { useEffect, useMemo, useState } from 'react'
import { loadActiveDiet } from '../lib/diets'
import { useToast } from '../lib/toast'
import type { Favorite } from '../lib/types'
import { shoppingList, shoppingText } from '../../api/_lib/rules/extras'

const CHECKED_KEY = 'lista-compras-feito'

function readChecked(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHECKED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

// Favoritas › Compras: escolhe quantas vezes vais comer cada favorita (por
// omissão, a dieta ativa × 7 dias) e a app junta os alimentos numa lista,
// com as gramas somadas, para riscar no supermercado ou partilhar.
export default function ListaCompras({ favorites }: { favorites: Favorite[] }) {
  const toast = useToast()
  const [times, setTimes] = useState<Record<string, number>>({})
  const [checked, setChecked] = useState<string[]>(readChecked)

  useEffect(() => {
    let alive = true
    void loadActiveDiet()
      .then((diet) => {
        if (!alive || !diet) return
        const counts: Record<string, number> = {}
        for (const ids of Object.values(diet.meals)) for (const id of ids ?? []) counts[id] = (counts[id] ?? 0) + 7
        setTimes((prev) => (Object.keys(prev).length ? prev : counts))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const lines = useMemo(
    () => shoppingList(favorites.map((f) => ({ items: f.items, times: times[f.id] ?? 0 }))),
    [favorites, times],
  )

  function toggle(name: string) {
    const next = checked.includes(name) ? checked.filter((n) => n !== name) : [...checked, name]
    setChecked(next)
    try {
      localStorage.setItem(CHECKED_KEY, JSON.stringify(next))
    } catch {
      // sem armazenamento: risca só até fechar
    }
  }

  async function share() {
    const text = `Lista de compras\n${shoppingText(lines)}`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        toast('Lista copiada.')
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('Não consegui partilhar.')
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-dim">
        Quantas vezes vais comer cada favorita? Começa com a dieta ativa para 7 dias.
      </p>
      <ul className="divide-y divide-line rounded-2xl bg-surface">
        {favorites.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[15px]">{f.name}</span>
            <button
              onClick={() => setTimes({ ...times, [f.id]: Math.max(0, (times[f.id] ?? 0) - 1) })}
              className="h-10 w-10 rounded-lg bg-surface2 text-[17px]"
              aria-label={`menos ${f.name}`}
            >
              −
            </button>
            <span className="w-7 text-center tabular-nums">{times[f.id] ?? 0}</span>
            <button
              onClick={() => setTimes({ ...times, [f.id]: (times[f.id] ?? 0) + 1 })}
              className="h-10 w-10 rounded-lg bg-surface2 text-[17px]"
              aria-label={`mais ${f.name}`}
            >
              +
            </button>
          </li>
        ))}
      </ul>

      {lines.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between">
            <p className="label">Lista</p>
            {checked.length > 0 && (
              <button
                onClick={() => {
                  setChecked([])
                  try {
                    localStorage.removeItem(CHECKED_KEY)
                  } catch {
                    // nada
                  }
                }}
                className="text-[13px] text-dim"
              >
                Limpar riscados
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {lines.map((l) => {
              const done = checked.includes(l.name)
              return (
                <li key={l.name}>
                  <label className="flex min-h-10 items-center gap-3 text-[15px]">
                    <input type="checkbox" checked={done} onChange={() => toggle(l.name)} className="h-5 w-5 accent-current" />
                    <span className={`flex-1 ${done ? 'text-dim line-through' : ''}`}>{l.name}</span>
                    <span className="text-dim tabular-nums">
                      {l.grams > 0 ? (l.grams >= 1000 ? `${(l.grams / 1000).toFixed(1).replace('.', ',')} kg` : `${l.grams} g`) : `× ${l.times}`}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <button onClick={() => void share()} className="min-h-12 w-full rounded-xl bg-surface2 text-[15px] font-semibold">
            Partilhar a lista
          </button>
        </section>
      ) : (
        <p className="text-center text-[14px] text-dim">Escolhe pelo menos uma favorita.</p>
      )}
    </div>
  )
}
