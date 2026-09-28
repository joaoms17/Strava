import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtDayShort, fmtInt, fmtKcal, timeOf } from '../../lib/format'
import { deleteMeal, repeatMeal } from '../../lib/meal-actions'
import { favoriteName } from '../../../api/_lib/rules/favoritos'
import { mealTotals } from '../../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, Slot } from '../../lib/types'

const MAIN_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']

// Ver uma refeição com os itens sempre visíveis; guardar como favorito,
// repetir, copiar para outro dia ou apagar (com Anular).
export default function MealSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const id = sheet.params.get('id')
  const [meal, setMeal] = useState<Meal | null | undefined>(undefined)
  const [photo, setPhoto] = useState<string | null>(null)
  const [favoriteId, setFavoriteId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'favorite' | 'copy'>('view')
  const [name, setName] = useState('')
  const [slot, setSlot] = useState<Slot>('almoco')
  const [busy, setBusy] = useState(false)
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  useEffect(() => {
    if (!id) return
    async function load() {
      const [{ data }, { data: favs }] = await Promise.all([
        supabase.from('meals').select('*').eq('id', id).maybeSingle(),
        supabase.from('favorites').select('id').eq('source_meal_id', id).eq('archived', false).limit(1),
      ])
      const row = (data ?? null) as Meal | null
      setMeal(row)
      setFavoriteId(row?.favorite_id ?? favs?.[0]?.id ?? null)
      if (row) {
        setName(favoriteName(row.items))
        setSlot(slotOf(new Date(row.logged_at)))
        if (row.photo_path) {
          const urls = await signedUrls([row.photo_path])
          setPhoto(urls[row.photo_path] ?? null)
        }
      }
    }
    void load()
  }, [id])

  if (meal === undefined) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  if (meal === null) {
    return (
      <BottomSheet title="Refeição" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Esta refeição já não existe.</p>
      </BottomSheet>
    )
  }

  const mealSlot = slotOf(new Date(meal.logged_at))
  const approx = meal.is_estimate ? '≈ ' : ''
  const protein = Number(meal.protein)
  const proteinOk = MAIN_SLOTS.includes(mealSlot) && protein >= profile.protein_per_meal_g

  async function saveFavorite() {
    if (!meal) return
    setBusy(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      return
    }
    const newId = crypto.randomUUID()
    let photoPath: string | null = null
    if (meal.photo_path) {
      const target = `${user.id}/fav/${newId}.jpg`
      const { error } = await supabase.storage.from('meal-photos').copy(meal.photo_path, target)
      if (!error) photoPath = target
    }
    const totals = mealTotals(meal.items)
    const { error } = await supabase.from('favorites').insert({
      id: newId,
      user_id: user.id,
      kind: 'meal',
      name: name.trim() || favoriteName(meal.items),
      items: meal.items,
      kcal: Math.round(totals.kcal),
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      photo_path: photoPath,
      default_slot: slot,
      source_meal_id: meal.id,
    })
    setBusy(false)
    if (error) {
      toast('Não consegui guardar o favorito.')
      return
    }
    setFavoriteId(newId)
    setMode('view')
    emitDataChanged()
    toast(`Guardado nos favoritos · ${name.trim() || favoriteName(meal.items)}`, [
      {
        label: 'Anular',
        run: async () => {
          await supabase.from('favorites').delete().eq('id', newId)
          if (photoPath) await supabase.storage.from('meal-photos').remove([photoPath])
          emitDataChanged()
        },
      },
    ])
  }

  async function restore() {
    if (!meal) return
    setBusy(true)
    try {
      await postApi('/api/meal/restore', { meal_id: meal.id })
      emitDataChanged()
      sheet.close()
    } catch {
      toast('Não consegui repor.')
    } finally {
      setBusy(false)
    }
  }

  const footer =
    meal.deleted_at != null ? (
      <button
        disabled={busy}
        onClick={() => void restore()}
        className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
      >
        Repor esta refeição
      </button>
    ) : mode === 'favorite' ? (
      <button
        disabled={busy}
        onClick={() => void saveFavorite()}
        className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
      >
        Guardar favorito
      </button>
    ) : (
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => (favoriteId ? undefined : setMode('favorite'))}
          className={`min-h-12 rounded-xl text-[15px] ${favoriteId ? 'bg-surface2 text-attn' : 'bg-surface2'}`}
        >
          {favoriteId ? '★ Favorito' : '☆ Favorito'}
        </button>
        <button
          onClick={() => {
            sheet.close()
            void repeatMeal(meal.id, null, 'Registado hoje', toast)
          }}
          className="min-h-12 rounded-xl bg-surface2 text-[15px]"
        >
          Repetir hoje
        </button>
        <button
          onClick={() => {
            sheet.close()
            void deleteMeal(meal.id, toast)
          }}
          className="min-h-12 rounded-xl bg-surface2 text-[15px] text-pain"
        >
          Apagar
        </button>
      </div>
    )

  return (
    <BottomSheet
      title={
        <span>
          {SLOT_LABEL[mealSlot]} · <span className="tabular-nums">{timeOf(meal.logged_at)}</span>
          {meal.date !== today && <span className="text-dim"> · {fmtDayShort(meal.date)}</span>}
        </span>
      }
      onClose={sheet.close}
      footer={footer}
    >
      <div className="space-y-4 pb-2">
        {meal.deleted_at && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">Apagada — não conta para as contas.</p>
        )}
        {photo && <img src={photo} alt="" className="max-h-72 w-full rounded-2xl object-cover" />}
        {meal.raw_text && meal.input_type !== 'favorite' && (
          <p className="text-[15px] text-dim">«{meal.raw_text}»</p>
        )}

        <div>
          <p className="text-[24px] font-semibold tabular-nums">
            {approx}
            {fmtKcal(Number(meal.kcal))} kcal
          </p>
          <p className="text-[15px] text-dim tabular-nums">
            <span className={proteinOk ? 'text-protein' : ''}>Proteína {fmtInt(protein)} g</span> · Hidratos{' '}
            {fmtInt(Number(meal.carbs))} g · Gordura {fmtInt(Number(meal.fat))} g
          </p>
        </div>

        <ul className="divide-y divide-line rounded-2xl bg-surface2">
          {meal.items.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-[15px]">
              <span className="min-w-0">
                {item.name} <span className="text-dim tabular-nums">· {fmtInt(item.grams)} g</span>
                {item.estimated && <span className="ml-1 text-[13px] text-attn">confirma a porção</span>}
              </span>
              <span className="shrink-0 tabular-nums text-dim">{fmtInt(item.kcal)} kcal</span>
            </li>
          ))}
        </ul>

        {mode === 'favorite' && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[13px] text-dim">Nome do favorito</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12 w-full rounded-xl border border-line bg-bg px-3 focus:border-eat focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {SLOTS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSlot(s)}
                  className={`rounded-full px-3 py-1.5 text-[13px] ${s === slot ? 'bg-eat text-bg' : 'bg-surface2'}`}
                >
                  {SLOT_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'view' && meal.deleted_at == null && (
          <div className="space-y-2">
            <button onClick={() => setMode('copy')} className="text-[15px] text-eat">
              Copiar para outro dia ›
            </button>
          </div>
        )}
        {mode === 'copy' && (
          <div className="flex flex-wrap gap-2">
            {[0, -1, -2].map((back) => {
              const date = shiftDate(today, back)
              if (date === meal.date) return null
              return (
                <button
                  key={back}
                  onClick={() => {
                    sheet.close()
                    void repeatMeal(
                      meal.id,
                      date,
                      `Copiado para ${back === 0 ? 'hoje' : back === -1 ? 'ontem' : 'anteontem'}`,
                      toast,
                    )
                  }}
                  className="rounded-full bg-surface2 px-3 py-1.5 text-[15px]"
                >
                  {back === 0 ? 'Hoje' : back === -1 ? 'Ontem' : 'Anteontem'}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
