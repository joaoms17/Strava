import { useEffect, useMemo, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import WhenPicker from '../ui/WhenPicker'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtKcal, timeOf } from '../../lib/format'
import { repeatMeal } from '../../lib/meal-actions'
import {
  frequentMeals,
  groupByDay,
  mealName,
  mealSlot,
  repeatable,
  searchMeals,
  type RepeatSource,
} from '../../lib/repetir'
import { dayLabel, needsSlot, whenApi, whenFromParams, whenLabel, type When } from '../../lib/when'
import { SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'

const DAYS = 90
const PAGE = 14 // dias mostrados de cada vez

// Repetir uma refeição de qualquer dia (até 3 meses): as que mais repetes em
// cima, depois dia a dia, com pesquisa. Fica no dia e refeição escolhidos.
export default function RepeatSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [when, setWhen] = useState<When>(() => whenFromParams(sheet.params, today))
  const [meals, setMeals] = useState<RepeatSource[] | null>(null)
  const [query, setQuery] = useState('')
  const [shownDays, setShownDays] = useState(PAGE)
  const [askSlot, setAskSlot] = useState(false)

  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('id,date,logged_at,slot,input_type,raw_text,items,kcal,protein,status')
      .gte('date', shiftDate(today, -DAYS))
      .lte('date', today)
      .order('logged_at', { ascending: false })
      .limit(600)
      .then(({ data }) => {
        if (alive) setMeals(((data ?? []) as RepeatSource[]).filter(repeatable))
      })
    return () => {
      alive = false
    }
  }, [today])

  const found = useMemo(() => searchMeals(meals ?? [], query), [meals, query])
  const days = useMemo(() => groupByDay(found), [found])
  const frequent = useMemo(() => (query.trim() ? [] : frequentMeals(meals ?? [], 6)), [meals, query])
  const label = whenLabel(when, today)

  function pick(meal: RepeatSource) {
    if (needsSlot(when)) {
      setAskSlot(true)
      toast('Escolhe primeiro a refeição (pequeno-almoço, almoço…).')
      return
    }
    const api = whenApi(when, today)
    sheet.close()
    // «Agora»: fica na refeição desta hora.
    void repeatMeal(meal.id, api.date ?? null, `Repetido · ${label}`, toast, api.slot ?? slotOf(new Date()))
  }

  const row = (meal: RepeatSource, extra?: string) => (
    <button
      key={meal.id}
      onClick={() => pick(meal)}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left active:bg-surface2"
    >
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

  return (
    <BottomSheet title="Repetir refeição" onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        <div className="space-y-2">
          <p className="text-[13px] text-dim">
            Vai ficar em <span className="font-semibold text-ink">{label}</span>
          </p>
          <WhenPicker
            today={today}
            value={when}
            onChange={(next) => {
              setWhen(next)
              setAskSlot(false)
            }}
            highlight={askSlot}
          />
        </div>

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
            {query.trim() ? 'Nada com esse nome nos últimos 3 meses.' : 'Ainda não há refeições para repetir.'}
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
    </BottomSheet>
  )
}
