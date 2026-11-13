import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import type { Favorite } from '../lib/types'
import Icon, { type IconName } from './ui/Icon'
import ShotButton from './ui/ShotButton'

// As formas de registar um treino (T12), no Treino e na folha do ＋: um print
// (do relógio, do Strava, da app do ginásio, da consola… a IA lê qualquer
// um), dizer/escrever o que fizeste (a IA passa para os campos) ou à mão, sem
// IA. Por baixo, os teus treinos (um toque) e o ginásio livre. Dentro de uma
// folha (`inSheet`), abrir o Ginásio substitui a entrada da folha: fechar e
// navegar a seguir desfazia a navegação (T5).
export default function WorkoutLogOptions({ date, inSheet = false }: { date?: string | null; inSheet?: boolean }) {
  const sheet = useSheet()
  const [, navigate] = useLocation()
  const version = useDataVersion()
  const [favorites, setFavorites] = useState<Favorite[]>([])

  useEffect(() => {
    void supabase
      .from('favorites')
      .select('*')
      .eq('kind', 'workout')
      .eq('archived', false)
      .order('use_count', { ascending: false })
      .then(({ data }) => setFavorites(((data ?? []) as Favorite[]).filter((f) => f.workout)))
  }, [version])

  const dateParams: Record<string, string> = date ? { data: date } : {}
  const gym = (query: string) => {
    const url = `/treino/ginasio${query || date ? '?' : ''}${[query, date ? `data=${date}` : ''].filter(Boolean).join('&')}`
    navigate(url, inSheet ? { replace: true } : undefined)
  }
  const openFavorite = (f: Favorite) =>
    f.workout?.type === 'strength' ? gym(`fav=${f.id}`) : sheet.open('registar-treino', { fav: f.id, ...dateParams })

  const box =
    'flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-1.5 py-2 text-center font-display text-[0.9375rem] leading-tight font-bold tracking-[0.04em] uppercase'
  const icon = (name: IconName) => (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface2 text-burn">
      <Icon name={name} size={22} />
    </span>
  )
  const hint = 'block font-sans text-[0.8125rem] font-normal tracking-normal text-dim normal-case'
  const pill = 'min-h-11 rounded-full border border-line px-3 text-[0.9375rem]'
  return (
    <section className="space-y-2" aria-label="Registar treino">
      <p className="label">Registar treino</p>
      <div className="grid grid-cols-3 gap-2">
        <ShotButton className={box}>
          {icon('watch')}
          <span>
            Print
            <span className={hint}>relógio, Strava, consola</span>
          </span>
        </ShotButton>
        <button onClick={() => sheet.open('dizer-treino', dateParams)} className={box}>
          {icon('mic')}
          <span>
            Dizer
            <span className={hint}>ou escrever</span>
          </span>
        </button>
        <button onClick={() => sheet.open('ja-fiz', dateParams)} className={box}>
          {icon('plus')}
          <span>
            À mão
            <span className={hint}>sem IA</span>
          </span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2 pt-1" aria-label="Os teus treinos">
        {favorites.map((f) => (
          <button key={f.id} onClick={() => openFavorite(f)} className={pill}>
            {f.name}
          </button>
        ))}
        <button onClick={() => gym('')} className={`${pill} flex items-center gap-1.5 text-dim`}>
          <Icon name="dumbbell" size={16} /> Ginásio livre
        </button>
      </div>
    </section>
  )
}
