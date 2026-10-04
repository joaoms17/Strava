import { useMemo } from 'react'
import { useLocation } from 'wouter'
import Thumb from './ui/Thumb'
import Icon from './ui/Icon'
import { useToast } from '../lib/toast'
import { useSignedUrls } from '../lib/photos'
import { fmtInt, fmtKcal } from '../lib/format'
import { logFavorite } from '../lib/meal-actions'
import { mealSlot } from '../lib/repetir'
import { dayLabel } from '../lib/when'
import { dietDay } from '../../api/_lib/rules/dieta'
import { SLOT_LABEL, slotOf, type Slot } from '../../api/_lib/rules/momentos'
import type { Diet, Favorite, Meal } from '../lib/types'

// Hoje › Dieta: cada refeição da dieta que segues, com a foto. As que já
// registaste ficam numa linha; as que faltam têm «Registar» (e as
// alternativas ao lado).
export default function DietToday({
  diet,
  favorites,
  meals,
  date,
  today,
}: {
  diet: Diet
  favorites: Favorite[]
  meals: Pick<Meal, 'slot' | 'logged_at' | 'favorite_id'>[]
  date: string
  today: string
}) {
  const toast = useToast()
  const [, navigate] = useLocation()
  const byId = useMemo(() => new Map(favorites.map((f) => [f.id, f])), [favorites])
  const day = dietDay(
    diet.meals,
    meals.map((m) => ({ slot: mealSlot(m), favorite_id: m.favorite_id })),
  )
  const rows = day.filter((d) => d.options.some((id) => byId.has(id)))
  const urls = useSignedUrls(rows.flatMap((d) => d.options.map((id) => byId.get(id)?.photo_path)))
  if (rows.length === 0) return null

  const missing = rows.filter((d) => !d.done)
  const left = missing.reduce(
    (acc, d) => {
      const fav = byId.get(d.options.find((id) => byId.has(id))!)!
      return { kcal: acc.kcal + Number(fav.kcal), protein: acc.protein + Number(fav.protein) }
    },
    { kcal: 0, protein: 0 },
  )

  function register(fav: Favorite, slot: Slot) {
    const isToday = date === today
    // Na refeição desta hora fica agora; nas outras, à hora habitual dela.
    const now = isToday && slotOf(new Date()) === slot
    void logFavorite(
      fav,
      now ? null : date,
      toast,
      slot,
      `${dayLabel(date, today)} · ${SLOT_LABEL[slot].toLowerCase()}`,
    )
  }

  return (
    <div className="space-y-2 rounded-2xl border border-line p-3" aria-label="Dieta">
      <div className="flex items-baseline justify-between gap-2">
        <p className="label truncate">Dieta · {diet.name}</p>
        <button onClick={() => navigate('/favoritos?separador=dieta')} className="shrink-0 text-[13px] text-eat">
          Ver ›
        </button>
      </div>
      {rows.map((d) => {
        const options = d.options.map((id) => byId.get(id)).filter((f): f is Favorite => !!f)
        const main = options[0]!
        if (d.done) {
          const eaten = d.followed ? byId.get(d.followed) : null
          return (
            <p key={d.slot} className="flex items-center gap-2 text-[14px] text-dim">
              <Icon name="check" size={16} className="shrink-0 text-eat" />
              <span className="truncate">
                {SLOT_LABEL[d.slot]} · {eaten ? eaten.name : 'outra refeição'}
              </span>
            </p>
          )
        }
        return (
          <div key={d.slot} className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Thumb url={main.photo_path ? urls[main.photo_path] : null} size={52} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-dim uppercase tracking-[0.06em]">{SLOT_LABEL[d.slot]}</span>
                <span className="block truncate text-[15px]">{main.name}</span>
                <span className="block text-[13px] text-dim tabular-nums">
                  {fmtKcal(main.kcal)} kcal · {fmtInt(Number(main.protein))} g
                </span>
              </span>
              <button
                onClick={() => register(main, d.slot)}
                aria-label={`Registar ${main.name}`}
                className="min-h-10 shrink-0 rounded-xl bg-eat px-3 text-[15px] font-semibold text-bg"
              >
                Registar
              </button>
            </div>
            {options.length > 1 && (
              <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pl-[76px] [scrollbar-width:none]">
                {options.slice(1).map((fav) => (
                  <button
                    key={fav.id}
                    onClick={() => register(fav, d.slot)}
                    aria-label={`Registar ${fav.name}`}
                    className="flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-line py-1 pr-3 pl-1 text-[14px]"
                  >
                    <Thumb url={fav.photo_path ? urls[fav.photo_path] : null} size={26} className="rounded-full" />
                    ou {fav.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {missing.length > 0 && missing.length < rows.length && (
        <p className="text-[13px] text-dim tabular-nums">
          Falta da dieta: {fmtKcal(left.kcal)} kcal · {fmtInt(left.protein)} g proteína
        </p>
      )}
      {missing.length === 0 && (
        <p className="text-[13px] text-eat">Dieta cumprida{date === today ? ' hoje' : ''}. ✓</p>
      )}
    </div>
  )
}
