import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { fmtDayShort } from '../../lib/format'
import type { Favorite } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import ShotButton from '../ui/ShotButton'

// Folha Treino: os treinos favoritos em botões grandes, «Já fiz» e o print
// do relógio. Um favorito de bicicleta abre a folha Joelho e só depois guarda.
export default function TreinoSheet() {
  const sheet = useSheet()
  const date = sheet.params.get('data')
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)

  useEffect(() => {
    void supabase
      .from('favorites')
      .select('*')
      .eq('kind', 'workout')
      .eq('archived', false)
      .order('use_count', { ascending: false })
      .then(({ data }) => setFavorites((data ?? []) as Favorite[]))
  }, [])

  const extra: Record<string, string> = date ? { data: date } : {}
  const secondary =
    'flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface2 font-display text-[18px] font-bold tracking-[0.06em] uppercase'

  return (
    <BottomSheet title="Treino" onClose={sheet.close}>
      <div className="space-y-3 pb-2">
        {date && <p className="text-[15px] text-dim">A registar em {fmtDayShort(date)}</p>}
        {(favorites ?? []).map((favorite) => (
          <button
            key={favorite.id}
            onClick={() => sheet.open('joelho', { fav: favorite.id, ...extra })}
            className="flex min-h-[88px] w-full items-center gap-4 rounded-[20px] bg-burn px-4 text-left text-bg"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-bg text-burn">
              <Icon name={favorite.workout?.type === 'bike' ? 'bike' : favorite.workout?.type === 'strength' ? 'dumbbell' : 'walk'} size={30} stroke={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[24px] leading-none font-extrabold uppercase">
                {favorite.name}
              </span>
              <span className="mt-1 block font-display text-[17px] font-semibold uppercase">
                {favorite.workout?.minutes} min
                {favorite.workout?.watts ? ` · ${favorite.workout.watts} W` : ''}
              </span>
            </span>
            <Icon name="chevron" size={22} stroke={2.4} />
          </button>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => sheet.open('ja-fiz', extra)} className={secondary}>
            <Icon name="check" size={20} /> Já fiz
          </button>
          <ShotButton className={secondary}>
            <Icon name="watch" size={20} /> Print
          </ShotButton>
        </div>
        <p className="text-[14px] text-dim">
          Print: no Garmin Connect abre o treino e tira 2 capturas (Resumo e Estatísticas). Também serve o Strava ou
          uma foto da consola da bicicleta.
        </p>
      </div>
    </BottomSheet>
  )
}
