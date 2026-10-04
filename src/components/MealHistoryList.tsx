import { useEffect, useMemo, useState } from 'react'
import Thumb from './ui/Thumb'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../lib/day'
import { fmtKcal, timeOf } from '../lib/format'
import { useSignedUrls } from '../lib/photos'
import {
  frequentMeals,
  groupByDay,
  mealName,
  mealSlot,
  repeatable,
  searchMeals,
  type RepeatSource,
} from '../lib/repetir'
import { dayLabel } from '../lib/when'
import { SLOT_LABEL } from '../../api/_lib/rules/momentos'
import type { Meal } from '../lib/types'

const DAYS = 90
const PAGE = 14 // dias mostrados de cada vez

export type HistoryMeal = RepeatSource & Pick<Meal, 'photo_path' | 'photo_paths' | 'thumb_paths'>

// As refeições analisadas dos últimos 3 meses, com foto: as que mais repetes
// em cima, depois dia a dia, com pesquisa. Serve para repetir uma refeição e
// para a guardar nas favoritas.
export default function MealHistoryList({
  today,
  onPick,
  exclude,
  emptyText = 'Ainda não há refeições para repetir.',
}: {
  today: string
  onPick: (meal: HistoryMeal) => void
  exclude?: (meal: HistoryMeal) => boolean
  emptyText?: string
}) {
  const [meals, setMeals] = useState<HistoryMeal[] | null>(null)
  const [query, setQuery] = useState('')
  const [shownDays, setShownDays] = useState(PAGE)

  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('id,date,logged_at,slot,input_type,raw_text,items,kcal,protein,status,photo_path,photo_paths,thumb_paths')
      .gte('date', shiftDate(today, -DAYS))
      .lte('date', today)
      .order('logged_at', { ascending: false })
      .limit(600)
      .then(({ data }) => {
        if (alive) setMeals(((data ?? []) as HistoryMeal[]).filter((m) => repeatable(m) && !exclude?.(m)))
      })
    return () => {
      alive = false
    }
    // O filtro só se lê ao carregar.
  }, [today])

  const found = useMemo(() => searchMeals(meals ?? [], query), [meals, query])
  const days = useMemo(() => groupByDay(found), [found])
  const frequent = useMemo(() => (query.trim() ? [] : frequentMeals(meals ?? [], 6)), [meals, query])
  const shown = useMemo(
    () => [...frequent.map((f) => f.meal), ...days.slice(0, shownDays).flatMap((d) => d.meals)],
    [frequent, days, shownDays],
  )
  const thumbOf = (m: HistoryMeal) => m.thumb_paths?.[0] ?? m.photo_path ?? null
  const urls = useSignedUrls(shown.map(thumbOf))

  const row = (meal: HistoryMeal, extra?: string) => {
    const thumb = thumbOf(meal)
    return (
      <button
        key={meal.id}
        onClick={() => onPick(meal)}
        className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-surface2"
      >
        <Thumb url={thumb ? urls[thumb] : null} size={44} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px]">{mealName(meal)}</span>
          <span className="block text-[13px] text-dim">
            {extra ?? `${SLOT_LABEL[mealSlot(meal)]} · ${timeOf(meal.logged_at)}`}
          </span>
        </span>
        <span className="shrink-0 text-right text-[14px] tabular-nums">
          {fmtKcal(Number(meal.kcal))} kcal
          <span className="block text-[12px] text-dim">{Math.round(Number(meal.protein))} g prot.</span>
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setShownDays(PAGE)
        }}
        placeholder="Procurar (ex.: frango, aveia, sopa)"
        aria-label="Procurar refeição"
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
      />

      {meals == null ? (
        <p className="py-6 text-center text-[15px] text-dim">A carregar…</p>
      ) : found.length === 0 ? (
        <p className="py-6 text-center text-[15px] text-dim">
          {query.trim() ? 'Nada com esse nome nos últimos 3 meses.' : emptyText}
        </p>
      ) : (
        <>
          {frequent.length > 0 && (
            <div className="space-y-1">
              <h3 className="label">As que mais repetes</h3>
              <div className="-mx-2 divide-y divide-line/60">
                {frequent.map(({ meal, count }) =>
                  row(meal, `${count} vezes · última ${dayLabel(meal.date, today).toLowerCase()}`),
                )}
              </div>
            </div>
          )}
          {days.slice(0, shownDays).map((day) => (
            <div key={day.date} className="space-y-1">
              <h3 className="label">{dayLabel(day.date, today)}</h3>
              <div className="-mx-2 divide-y divide-line/60">{day.meals.map((meal) => row(meal))}</div>
            </div>
          ))}
          {days.length > shownDays && (
            <button
              onClick={() => setShownDays(shownDays + PAGE)}
              className="min-h-11 w-full rounded-xl border border-line text-[15px]"
            >
              Mais dias
            </button>
          )}
        </>
      )}
    </div>
  )
}
