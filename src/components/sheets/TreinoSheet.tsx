import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { fmtDayShort } from '../../lib/format'
import type { Favorite } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import WorkoutLogOptions from '../WorkoutLogOptions'

// Folha Treino (do ＋): print do relógio, print da app ou dizer/escrever o
// que fizeste; por baixo, os teus treinos para repetir com um toque.
export default function TreinoSheet() {
  const sheet = useSheet()
  const date = sheet.params.get('data')
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [, navigate] = useLocation()

  useEffect(() => {
    void supabase
      .from('favorites')
      .select('*')
      .eq('kind', 'workout')
      .eq('archived', false)
      .order('use_count', { ascending: false })
      .then(({ data }) => setFavorites((data ?? []) as Favorite[]))
  }, [])

  return (
    <BottomSheet title="Treino" onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        {date && <p className="text-[15px] text-dim">A registar em {fmtDayShort(date)}</p>}
        <WorkoutLogOptions date={date} />
        {favorites.length > 0 && (
          <div className="space-y-2">
            <p className="label">Os meus treinos</p>
            <div className="flex flex-wrap gap-2">
              {favorites.map((f) => (
                <button
                  key={f.id}
                  onClick={() =>
                    f.workout?.type === 'strength'
                      ? (sheet.close(), navigate(`/treino/ginasio?fav=${f.id}`))
                      : sheet.open('registar-treino', { fav: f.id, ...(date ? { data: date } : {}) })
                  }
                  className="min-h-10 rounded-full border border-line px-3 text-[15px]"
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[14px] text-dim">
          Print: abre o treino na app do relógio ou noutra app (Strava, a app do ginásio…) e tira 1 a 4 capturas. Os
          treinos do relógio também chegam sozinhos pelo intervals.icu.
        </p>
      </div>
    </BottomSheet>
  )
}
