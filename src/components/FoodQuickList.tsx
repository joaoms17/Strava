import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../lib/day'
import { fmtInt } from '../lib/format'
import { normalizeFoodName, rankFoodsForSlot } from '../../api/_lib/rules/mais-usados'
import { lisbonDay, type Slot } from '../../api/_lib/rules/momentos'
import type { Food, MealItem } from '../lib/types'

type FoodRow = Food & { use_count: number }

const DAYS = 90
const SHOWN = 30

// Os alimentos mais usados, para juntar com um toque: primeiro os do momento
// (ceia, almoço…) com as gramas habituais nele; o campo filtra os alimentos
// da pessoa pelo nome (sem acentos nem maiúsculas).
export default function FoodQuickList({ slot, onPick }: { slot: Slot; onPick: (food: Food, grams: number) => void }) {
  const [foods, setFoods] = useState<FoodRow[] | null>(null)
  const [meals, setMeals] = useState<{ slot: Slot | null; logged_at: string; items: MealItem[] | null }[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    const since = shiftDate(lisbonDay(), -DAYS)
    void Promise.all([
      supabase.from('foods').select('*').order('use_count', { ascending: false }).limit(300),
      supabase.from('meals').select('slot,logged_at,items').is('deleted_at', null).gte('date', since),
    ]).then(([f, m]) => {
      if (!alive) return
      setFoods((f.data ?? []) as FoodRow[])
      setMeals((m.data ?? []) as typeof meals)
    })
    return () => {
      alive = false
    }
  }, [])

  const ranked = useMemo(() => (foods ? rankFoodsForSlot(foods, meals, slot, foods.length) : []), [foods, meals, slot])
  const q = normalizeFoodName(query)
  const shown = (q ? ranked.filter((u) => normalizeFoodName(u.food.name).includes(q)) : ranked).slice(0, SHOWN)

  if (foods == null) return <p className="text-[0.9375rem] text-dim">A carregar os teus alimentos…</p>
  if (foods.length === 0) {
    return (
      <p className="rounded-xl bg-surface2 px-3 py-3 text-[0.8125rem] text-dim">
        Ainda não tens alimentos guardados. Lê um código ou escreve um rótulo: ficam aqui para a próxima vez.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxLength={80}
        enterKeyHint="search"
        aria-label="Procurar nos meus alimentos"
        placeholder="Procurar nos meus alimentos"
        className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[1.0625rem] placeholder:text-dim focus:border-eat focus:outline-none"
      />
      <p className="label">{q ? 'Os teus alimentos' : 'Mais usados'}</p>
      {shown.length === 0 ? (
        <p className="text-[0.9375rem] text-dim">Nenhum alimento teu com esse nome.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl bg-surface2" aria-label="Os teus alimentos">
          {shown.map(({ food, grams }) => (
            <li key={food.id}>
              <button
                onClick={() => onPick(food, grams)}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem]">{food.name}</span>
                  <span className="block text-[0.8125rem] text-dim tabular-nums">
                    {fmtInt(grams)} g · {fmtInt((food.kcal_100g * grams) / 100)} kcal · proteína{' '}
                    {fmtInt((food.protein_100g * grams) / 100)} g
                  </span>
                </span>
                <span className="shrink-0 text-[1.25rem] text-eat" aria-hidden>
                  ＋
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
