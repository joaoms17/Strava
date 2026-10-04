import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import BarcodeScanner from '../BarcodeScanner'
import { getApi, postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { nutritionalDay } from '../../lib/day'
import { fmtInt } from '../../lib/format'
import { round1 } from '../../../api/_lib/rules/meal-totals'
import { SLOT_TIME, loggedAtFor, slotOf } from '../../../api/_lib/rules/momentos'
import { whenFromParams } from '../../lib/when'
import type { Food, Meal, MealItem } from '../../lib/types'

// Produto embalado pelo Open Food Facts, sem IA.
export default function BarcodeSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  // O «Quando» escolhido no Registar (?data=…&momento=…); sem ele, agora.
  const when = whenFromParams(sheet.params, today)
  const date = when.date
  const [scanning, setScanning] = useState(true)
  const [food, setFood] = useState<Food | null>(null)
  const [grams, setGrams] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function lookup(ean: string) {
    setScanning(false)
    setError(null)
    try {
      const { food: found } = await getApi<{ food: Food }>(`/api/food/barcode/${ean}`)
      setFood(found)
      setGrams(Number(found.default_portion_g) || 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não encontrei este código.')
    }
  }

  async function save() {
    if (!food) return
    setBusy(true)
    const factor = grams / 100
    const item: MealItem = {
      name: food.name,
      grams: round1(grams),
      kcal: round1(food.kcal_100g * factor),
      protein: round1(food.protein_100g * factor),
      carbs: round1(food.carbs_100g * factor),
      fat: round1(food.fat_100g * factor),
      food_id: food.id,
      estimated: false,
    }
    const now = new Date()
    const slot = when.slot && when.slot !== 'agora' ? when.slot : null
    const loggedAt =
      date === today && !slot
        ? now
        : loggedAtFor(date, SLOT_TIME[slot ?? slotOf(now)], profile.nutrition_day_cutoff_hour, now)
    try {
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/save', {
        input_type: 'barcode',
        raw_text: food.barcode ? `EAN ${food.barcode}` : food.name,
        photo_path: null,
        items: [item],
        is_estimate: false,
        logged_at: loggedAt.toISOString(),
        ...(slot ? { slot } : {}),
      })
      emitDataChanged()
      sheet.close()
      toast(`Registado · ${food.name}`, [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/delete', { meal_id: meal.id })
            emitDataChanged()
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar.')
    } finally {
      setBusy(false)
    }
  }

  if (scanning) {
    return <BarcodeScanner onDetect={(ean) => void lookup(ean)} onClose={sheet.close} />
  }

  return (
    <BottomSheet
      title="Código de barras"
      onClose={sheet.close}
      footer={
        food ? (
          <button
            disabled={busy}
            onClick={() => void save()}
            className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
          >
            Guardar
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4 pb-2">
        {error && (
          <div className="space-y-3">
            <p className="text-[15px]">{error}</p>
            <p className="text-[15px] text-dim">Tira uma foto ao rótulo: a IA lê os valores.</p>
            <button onClick={() => setScanning(true)} className="min-h-12 w-full rounded-xl bg-surface2 text-[15px]">
              Ler outra vez
            </button>
          </div>
        )}
        {food && (
          <>
            <p className="text-[17px] font-semibold">{food.name}</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setGrams(Math.max(5, grams - 10))} className="h-12 w-12 rounded-xl bg-surface2 text-[17px]">
                −
              </button>
              <p className="num flex-1 text-center text-[32px]">{fmtInt(grams)} g</p>
              <button onClick={() => setGrams(grams + 10)} className="h-12 w-12 rounded-xl bg-surface2 text-[17px]">
                +
              </button>
            </div>
            <p className="text-[15px] text-dim tabular-nums">
              {fmtInt((food.kcal_100g * grams) / 100)} kcal ·{' '}
              <span className="text-protein">Proteína {fmtInt((food.protein_100g * grams) / 100)} g</span> · Hidratos{' '}
              {fmtInt((food.carbs_100g * grams) / 100)} g · Gordura {fmtInt((food.fat_100g * grams) / 100)} g
            </p>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
