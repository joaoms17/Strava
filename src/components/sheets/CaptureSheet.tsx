import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import BottomSheet from '../ui/BottomSheet'
import PhotoButton from '../ui/PhotoButton'
import Icon from '../ui/Icon'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { localCalendarDate, nutritionalDay, shiftDate } from '../../lib/day'
import { fmtDayShort, fmtKcal } from '../../lib/format'
import { logFavorite, repeatMeal } from '../../lib/meal-actions'
import { rankFavorites } from '../../../api/_lib/rules/favoritos'
import { SLOT_LABEL, lisbonClock, slotOf } from '../../../api/_lib/rules/momentos'
import type { Favorite, Meal } from '../../lib/types'

// A única porta de entrada: o que se faz 4 vezes por dia é grande, o que se
// faz uma vez por mês é pequeno. Nada muda de lugar.
export default function CaptureSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const [location, navigate] = useLocation()
  const now = new Date()
  const today = nutritionalDay(now, profile.nutrition_day_cutoff_hour)
  const viewing = /^\/hoje\/(\d{4}-\d{2}-\d{2})$/.exec(location)?.[1]
  const [target, setTarget] = useState(viewing && viewing < today ? viewing : today)
  const [changing, setChanging] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)
  const [sameAsYesterday, setSameAsYesterday] = useState<Meal | null>(null)
  const [weighedToday, setWeighedToday] = useState(true)
  const slot = slotOf(now)

  useEffect(() => {
    let alive = true
    async function load() {
      const [{ data: favRows }, { data: yesterdayMeals }, { data: weights }] = await Promise.all([
        supabase.from('favorites').select('*').eq('kind', 'meal').eq('archived', false),
        supabase
          .from('meals_counted')
          .select('*')
          .eq('date', shiftDate(target, -1))
          .order('logged_at'),
        supabase.from('weights').select('date').eq('date', localCalendarDate()),
      ])
      if (!alive) return
      setFavorites((favRows ?? []) as Favorite[])
      setSameAsYesterday(
        ((yesterdayMeals ?? []) as Meal[]).find((m) => slotOf(new Date(m.logged_at)) === slot) ?? null,
      )
      setWeighedToday((weights ?? []).length > 0)
    }
    void load()
    return () => {
      alive = false
    }
  }, [target, slot])

  const ranked = useMemo(() => rankFavorites(favorites ?? [], slot).slice(0, 6), [favorites, slot])
  const isPast = target !== today
  const dateParam = isPast ? target : null
  const weighDot = !weighedToday && lisbonClock(now).hour < 11

  function go(path: string) {
    navigate(path, { replace: true })
  }

  const big =
    'flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl font-display text-[19px] font-bold tracking-[0.06em] uppercase'

  return (
    <BottomSheet onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        {isPast || changing ? (
          <div className="space-y-2">
            <p className="text-[15px]">
              A registar em <span className="font-semibold">{fmtDayShort(target)}</span>
              {!changing && (
                <button className="ml-2 text-eat" onClick={() => setChanging(true)}>
                  mudar
                </button>
              )}
            </p>
            {changing && (
              <div className="flex gap-2">
                {[0, -1, -2].map((back) => {
                  const date = shiftDate(today, back)
                  return (
                    <button
                      key={back}
                      onClick={() => {
                        setTarget(date)
                        setChanging(false)
                      }}
                      className={`rounded-full px-3 py-1.5 text-[15px] ${
                        date === target ? 'bg-eat text-bg' : 'bg-surface2'
                      }`}
                    >
                      {back === 0 ? 'Hoje' : back === -1 ? 'Ontem' : 'Anteontem'}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <PhotoButton source="camera" date={dateParam} className={`${big} bg-eat text-bg`} onDone={sheet.close}>
            <Icon name="camera" size={30} />
            Fotografar
          </PhotoButton>
          <PhotoButton source="gallery" date={dateParam} className={`${big} border border-line bg-surface2`}>
            <Icon name="gallery" size={30} />
            Galeria
          </PhotoButton>
        </div>

        <button
          onClick={() => sheet.open('escrever', dateParam ? { data: dateParam } : {})}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface2 font-display text-[18px] font-bold tracking-[0.06em] uppercase"
        >
          <Icon name="pencil" size={20} /> Escrever ou ditar
        </button>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="label">Favoritos</h3>
            <button onClick={() => go('/favoritos')} className="text-[13px] text-eat">
              Todos ›
            </button>
          </div>
          {favorites != null && ranked.length === 0 ? (
            <p className="rounded-xl bg-surface2 px-3 py-3 text-[13px] text-dim">
              Toca na ☆ de uma refeição para a guardares aqui. Depois registas com 1 toque.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {ranked.map((favorite) => (
                <button
                  key={favorite.id}
                  onClick={() => {
                    sheet.close()
                    void logFavorite(favorite, dateParam, toast)
                  }}
                  className="flex min-h-12 flex-col justify-center rounded-xl bg-surface2 px-3 py-2 text-left"
                >
                  <span className="truncate text-[15px]">{favorite.name}</span>
                  <span className="text-[13px] text-dim tabular-nums">{fmtKcal(favorite.kcal)} kcal</span>
                </button>
              ))}
            </div>
          )}
          {sameAsYesterday && (
            <button
              onClick={() => {
                sheet.close()
                void repeatMeal(
                  sameAsYesterday.id,
                  dateParam,
                  `Registado · igual a ontem (${SLOT_LABEL[slot].toLowerCase()})`,
                  toast,
                )
              }}
              className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-3 text-[15px]"
            >
              <span>
                Igual a ontem · {SLOT_LABEL[slot].toLowerCase()}
              </span>
              <span className="text-[13px] text-dim tabular-nums">
                {fmtKcal(Number(sameAsYesterday.kcal))} kcal
              </span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => sheet.open('peso', dateParam ? { data: dateParam } : {})}
            className="relative flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface2 font-display text-[17px] font-bold tracking-[0.06em] uppercase"
          >
            <Icon name="scale" size={20} /> Peso
            {weighDot && <span className="absolute top-2 right-3 h-2 w-2 rounded-full bg-eat" aria-label="por fazer hoje" />}
          </button>
          <button
            onClick={() => sheet.open('treino', dateParam ? { data: dateParam } : {})}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface2 font-display text-[17px] font-bold tracking-[0.06em] uppercase"
          >
            <Icon name="bike" size={20} /> Treino
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
