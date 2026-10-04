import { useEffect, useMemo, useState } from 'react'
import Thumb from './ui/Thumb'
import Icon from './ui/Icon'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { useReadyProfile } from '../lib/profile'
import { emitDataChanged, useDataVersion } from '../lib/events'
import { fmtInt, fmtKcal } from '../lib/format'
import { followDiet, loadDiets } from '../lib/diets'
import { dietSlots, dietTotals } from '../../api/_lib/rules/dieta'
import { SLOT_LABEL } from '../../api/_lib/rules/momentos'
import type { Diet, Favorite } from '../lib/types'

// Favoritas › Dieta: as tuas dietas feitas com as favoritas (com fotos), a
// que estás a seguir em cima.
export default function DietTab({ favorites, photos }: { favorites: Favorite[]; photos: Record<string, string> }) {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const version = useDataVersion()
  const [diets, setDiets] = useState<Diet[] | null>(null)
  const [missing, setMissing] = useState(false)
  const byId = useMemo(() => new Map(favorites.map((f) => [f.id, f])), [favorites])

  useEffect(() => {
    let alive = true
    void loadDiets().then((result) => {
      if (!alive) return
      setDiets(result.diets)
      setMissing(result.missing)
    })
    return () => {
      alive = false
    }
  }, [version])

  async function follow(id: string | null, name: string) {
    try {
      await followDiet(id)
      emitDataChanged()
      toast(id ? `A seguir «${name}».` : 'Deixaste de seguir uma dieta.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui mudar.')
    }
  }

  if (missing) {
    return (
      <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
        Para fazer dietas falta correr a migração 10 (dietas) no Supabase.
      </p>
    )
  }
  if (diets == null) return <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>

  const create = (
    <button
      onClick={() => sheet.open('dieta')}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[15px]"
    >
      <Icon name="plus" size={18} /> {diets.length ? 'Nova dieta' : 'Criar a minha dieta'}
    </button>
  )

  return (
    <div className="space-y-3">
      {diets.length === 0 && (
        <div className="space-y-2 rounded-2xl border border-line p-5 text-[15px]">
          <p>Monta o teu dia com as tuas favoritas: o que comes ao pequeno-almoço, almoço, lanche e jantar.</p>
          <p className="text-dim">
            Depois registas cada refeição com um toque (com a foto dela) e o Hoje mostra o que falta.
            {favorites.length === 0 && ' Começa por guardar algumas favoritas em «Refeições».'}
          </p>
        </div>
      )}
      {diets.map((diet) => {
        const totals = dietTotals(diet.meals, byId)
        return (
          <div key={diet.id} className={`space-y-3 rounded-2xl border bg-surface p-3 ${diet.active ? 'border-eat' : 'border-line'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-[17px] font-semibold">{diet.name}</h3>
                <p className="text-[13px] text-dim tabular-nums">
                  {fmtKcal(totals.kcal)} kcal · {fmtInt(totals.protein)} g proteína · plano {fmtKcal(profile.base_kcal)} kcal
                </p>
              </div>
              {diet.active && (
                <span className="shrink-0 rounded-full bg-eat px-2.5 py-1 text-[12px] font-semibold text-bg">A seguir</span>
              )}
            </div>
            <ul className="space-y-2">
              {dietSlots(diet.meals).map((slot) => {
                const options = diet.meals[slot]!
                const fav = byId.get(options[0]!)
                if (!fav) return null
                return (
                  <li key={slot} className="flex items-center gap-3">
                    <Thumb url={fav.photo_path ? photos[fav.photo_path] : null} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-dim uppercase tracking-[0.06em]">{SLOT_LABEL[slot]}</span>
                      <span className="block truncate text-[15px]">
                        {fav.name}
                        {options.length > 1 && <span className="text-dim"> · ou mais {options.length - 1}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] text-dim tabular-nums">{fmtKcal(fav.kcal)}</span>
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => sheet.open('dieta', { id: diet.id })}
                className="min-h-11 flex-1 rounded-xl border border-line text-[15px]"
              >
                Editar
              </button>
              <button
                onClick={() => void follow(diet.active ? null : diet.id, diet.name)}
                className={`min-h-11 flex-1 rounded-xl text-[15px] ${diet.active ? 'bg-surface2 text-dim' : 'bg-eat font-semibold text-bg'}`}
              >
                {diet.active ? 'Deixar de seguir' : 'Seguir esta'}
              </button>
            </div>
          </div>
        )
      })}
      {create}
    </div>
  )
}
