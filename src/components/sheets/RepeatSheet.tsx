import { useEffect, useMemo, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { WhenLine } from '../ui/WhenPicker'
import Thumb from '../ui/Thumb'
import MealHistoryList from '../MealHistoryList'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { fmtKcal } from '../../lib/format'
import { logFavorite, repeatMeal } from '../../lib/meal-actions'
import { runBusy } from '../../lib/busy'
import { useSignedUrls } from '../../lib/photos'
import { searchByName } from '../../lib/repetir'
import { needsSlot, slotForRanking, whenApi, whenFromParams, whenLabel, type When } from '../../lib/when'
import { rankFavorites } from '../../../api/_lib/rules/favoritos'
import { slotOf } from '../../../api/_lib/rules/momentos'
import type { Favorite } from '../../lib/types'

const FAVORITES_SHOWN = 6

// H10: um «Repetir» só, com as favoritas e o histórico (até 3 meses), e uma
// pesquisa para os dois. Fica no dia e refeição escolhidos.
export default function RepeatSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const [now] = useState(() => new Date())
  const today = nutritionalDay(now, profile.nutrition_day_cutoff_hour)
  const [when, setWhen] = useState<When>(() => whenFromParams(sheet.params, today))
  const [askSlot, setAskSlot] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)
  const [allFavorites, setAllFavorites] = useState(false)
  const label = whenLabel(when, today)
  const ranked = useMemo(() => rankFavorites(favorites ?? [], slotForRanking(when, now)), [favorites, when, now])
  const favUrls = useSignedUrls(ranked.map((f) => f.photo_path))

  useEffect(() => {
    let alive = true
    void supabase
      .from('favorites')
      .select('*')
      .eq('kind', 'meal')
      .eq('archived', false)
      .then(({ data }) => {
        if (alive) setFavorites((data ?? []) as Favorite[])
      })
    return () => {
      alive = false
    }
  }, [])

  function slotOk(): boolean {
    if (!needsSlot(when)) return true
    setAskSlot(true)
    toast('Escolhe primeiro a refeição (pequeno-almoço, almoço…).')
    return false
  }

  function pick(mealId: string) {
    if (!slotOk()) return
    const api = whenApi(when, today)
    sheet.close()
    // «Agora»: fica na refeição desta hora, à hora real (M18; antes ia para a
    // hora habitual da refeição: às 21:30 ficava às 20:00).
    const isNow = when.slot === 'agora'
    void runBusy('A registar…', () =>
      repeatMeal(mealId, api.date ?? null, `Repetido · ${label}`, toast, api.slot ?? slotOf(new Date()), isNow),
    )
  }

  function pickFavorite(favorite: Favorite) {
    if (!slotOk()) return
    const api = whenApi(when, today)
    const isNow = Object.keys(api).length === 0
    sheet.close()
    void runBusy('A registar…', () => logFavorite(favorite, api.date ?? null, toast, api.slot ?? null, isNow ? null : label))
  }

  function favoritesBlock(query: string) {
    if (!favorites || favorites.length === 0) return null
    const searching = query.trim().length > 0
    const found = searchByName(ranked, query)
    if (searching && found.length === 0) return null
    const shown = searching || allFavorites ? found : found.slice(0, FAVORITES_SHOWN)
    return (
      <div className="space-y-1">
        <h3 className="label">Favoritas</h3>
        <div className="grid grid-cols-2 gap-2">
          {shown.map((favorite) => (
            <button
              key={favorite.id}
              onClick={() => pickFavorite(favorite)}
              className="flex min-h-14 items-center gap-2 rounded-xl bg-surface2 p-1.5 pr-3 text-left"
            >
              <Thumb url={favorite.photo_path ? favUrls[favorite.photo_path] : null} size={42} />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[15px] leading-tight">{favorite.name}</span>
                <span className="block text-[13px] text-dim tabular-nums">{fmtKcal(favorite.kcal)} kcal</span>
              </span>
            </button>
          ))}
        </div>
        {!searching && !allFavorites && found.length > FAVORITES_SHOWN && (
          <button onClick={() => setAllFavorites(true)} className="min-h-11 w-full text-[15px] text-eat">
            Ver as {found.length} favoritas
          </button>
        )}
      </div>
    )
  }

  return (
    <BottomSheet title="Repetir" onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        <WhenLine
          today={today}
          value={when}
          onChange={(next) => {
            setWhen(next)
            setAskSlot(false)
          }}
          highlight={askSlot}
        />
        <MealHistoryList today={today} onPick={(meal) => pick(meal.id)} header={favoritesBlock} />
      </div>
    </BottomSheet>
  )
}
