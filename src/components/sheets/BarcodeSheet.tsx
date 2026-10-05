import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import BarcodeScanner from '../BarcodeScanner'
import { getApi, postApi } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { nutritionalDay } from '../../lib/day'
import { fmtInt } from '../../lib/format'
import { dayLabel, whenFromParams } from '../../lib/when'
import { mealName, mealSlot } from '../../lib/repetir'
import { round1 } from '../../../api/_lib/rules/meal-totals'
import { SLOT_LABEL, SLOT_TIME, loggedAtFor, slotOf } from '../../../api/_lib/rules/momentos'
import type { Food, Meal, MealItem } from '../../lib/types'

type Target = Pick<Meal, 'id' | 'items' | 'status' | 'slot' | 'logged_at' | 'date' | 'input_type' | 'raw_text'>

function itemOf(food: Food, grams: number): MealItem {
  const factor = grams / 100
  return {
    name: food.name,
    grams: round1(grams),
    kcal: round1(food.kcal_100g * factor),
    protein: round1(food.protein_100g * factor),
    carbs: round1(food.carbs_100g * factor),
    fat: round1(food.fat_100g * factor),
    food_id: food.id,
    estimated: false,
  }
}

// Código de barras (Open Food Facts, sem IA): lê vários produtos para a mesma
// refeição, um a seguir ao outro, e grava-os juntos — numa refeição nova ou
// juntos a uma já registada (?refeicao=id, a partir da folha da refeição, ou
// escolhida aqui entre as desse dia).
export default function BarcodeSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  // O «Quando» escolhido no Registar (?data=…&momento=…); sem ele, agora.
  const when = whenFromParams(sheet.params, today)
  const date = when.date
  const targetId = sheet.params.get('refeicao')
  const [scanning, setScanning] = useState(true)
  const [food, setFood] = useState<Food | null>(null)
  const [grams, setGrams] = useState(100)
  const [basket, setBasket] = useState<MealItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<Target | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [dayMeals, setDayMeals] = useState<Target[]>([])

  const columns = 'id,items,status,slot,logged_at,date,input_type,raw_text'
  useEffect(() => {
    if (!targetId) return
    void supabase
      .from('meals')
      .select(columns)
      .eq('id', targetId)
      .maybeSingle()
      .then(({ data }) => setTarget((data as Target | null) ?? null))
  }, [targetId])

  useEffect(() => {
    if (!choosing) return
    void supabase
      .from('meals')
      .select(columns)
      .eq('date', date)
      .is('deleted_at', null)
      .neq('status', 'a_analisar')
      .order('logged_at')
      .then(({ data }) => setDayMeals(((data ?? []) as Target[]).filter((m) => (m.items?.length ?? 0) > 0)))
  }, [choosing, date])

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

  function addCurrent() {
    if (!food) return
    setBasket([...basket, itemOf(food, grams)])
    setFood(null)
  }

  const items = food ? [...basket, itemOf(food, grams)] : basket
  const kcal = items.reduce((a, i) => a + i.kcal, 0)
  const protein = items.reduce((a, i) => a + i.protein, 0)

  async function saveNew() {
    if (items.length === 0) return
    setBusy(true)
    const now = new Date()
    const slot = when.slot && when.slot !== 'agora' ? when.slot : null
    const loggedAt =
      date === today && !slot
        ? now
        : loggedAtFor(date, SLOT_TIME[slot ?? slotOf(now)], profile.nutrition_day_cutoff_hour, now)
    try {
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/save', {
        input_type: 'barcode',
        raw_text: items.length === 1 ? items[0]!.name : items.map((i) => i.name).join(', '),
        photo_path: null,
        items,
        is_estimate: false,
        logged_at: loggedAt.toISOString(),
        ...(slot ? { slot } : {}),
      })
      emitDataChanged()
      sheet.close()
      toast(items.length === 1 ? `Registado · ${items[0]!.name}` : `Registados ${items.length} produtos`, [
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

  // Junta os produtos aos itens de uma refeição já registada.
  async function addTo(meal: Target) {
    if (items.length === 0) return
    if (meal.status === 'a_analisar') {
      toast('Essa refeição ainda está a ser analisada. Espera um pouco.')
      return
    }
    setBusy(true)
    try {
      const { previous } = await postApi<{ meal: Meal; previous: { items: MealItem[] } }>('/api/meal/update', {
        meal_id: meal.id,
        items: [...(meal.items ?? []), ...items],
      })
      emitDataChanged()
      toast(`Juntei ${items.length === 1 ? items[0]!.name : `${items.length} produtos`} à refeição`, [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/update', { meal_id: meal.id, items: previous.items })
            emitDataChanged()
          },
        },
      ])
      sheet.open('refeicao', { id: meal.id })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui juntar.')
    } finally {
      setBusy(false)
    }
  }

  if (scanning) {
    return (
      <BarcodeScanner
        onDetect={(ean) => void lookup(ean)}
        onClose={() => (basket.length > 0 ? setScanning(false) : sheet.close())}
      />
    )
  }

  const describe = (m: Target) =>
    `${SLOT_LABEL[mealSlot(m)]} · ${dayLabel(m.date, today).toLowerCase()} · ${mealName(m)}`
  const primary =
    'min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40'

  return (
    <BottomSheet
      title={target ? 'Juntar à refeição' : 'Código de barras'}
      onClose={sheet.close}
      footer={
        items.length > 0 && !choosing ? (
          <button disabled={busy} onClick={() => void (target ? addTo(target) : saveNew())} className={primary}>
            {busy
              ? 'A guardar…'
              : `${target ? 'Juntar' : 'Guardar'}${items.length > 1 ? ` ${items.length} produtos` : ''} · ${fmtInt(kcal)} kcal`}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4 pb-2">
        {target && <p className="truncate text-[15px] text-dim">A juntar a: {describe(target)}</p>}

        {error && (
          <div className="space-y-3">
            <p className="text-[15px]">{error}</p>
            <p className="text-[15px] text-dim">Tira uma foto ao rótulo: a IA lê os valores.</p>
            <button onClick={() => setScanning(true)} className="min-h-12 w-full rounded-xl bg-surface2 text-[15px]">
              Ler outra vez
            </button>
          </div>
        )}

        {basket.length > 0 && (
          <ul className="divide-y divide-line rounded-2xl bg-surface2" aria-label="Produtos lidos">
            {basket.map((item, i) => (
              <li key={`${item.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{item.name}</p>
                  <p className="text-[13px] text-dim tabular-nums">
                    {fmtInt(item.grams)} g · {fmtInt(item.kcal)} kcal · proteína {fmtInt(item.protein)} g
                  </p>
                </div>
                <button
                  onClick={() => setBasket(basket.filter((_, j) => j !== i))}
                  aria-label={`Tirar ${item.name}`}
                  className="h-10 w-10 shrink-0 rounded-lg text-[17px] text-dim"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {food && (
          <div className="space-y-3 rounded-2xl border border-line p-3">
            <p className="text-[17px] font-semibold">{food.name}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setGrams(Math.max(5, grams - 10))}
                aria-label="Menos 10 g"
                className="h-12 w-12 rounded-xl bg-surface2 text-[17px]"
              >
                −
              </button>
              <p className="num flex-1 text-center text-[32px]">{fmtInt(grams)} g</p>
              <button onClick={() => setGrams(grams + 10)} aria-label="Mais 10 g" className="h-12 w-12 rounded-xl bg-surface2 text-[17px]">
                +
              </button>
            </div>
            <p className="text-[15px] text-dim tabular-nums">
              {fmtInt((food.kcal_100g * grams) / 100)} kcal ·{' '}
              <span className="text-protein">Proteína {fmtInt((food.protein_100g * grams) / 100)} g</span> · Hidratos{' '}
              {fmtInt((food.carbs_100g * grams) / 100)} g · Gordura {fmtInt((food.fat_100g * grams) / 100)} g
            </p>
          </div>
        )}

        {items.length > 0 && !choosing && (
          <>
            <button
              onClick={() => {
                addCurrent()
                setScanning(true)
              }}
              className="min-h-12 w-full rounded-xl border border-line text-[16px]"
            >
              ＋ Ler outro produto
            </button>
            {items.length > 1 && (
              <p className="text-[14px] text-dim tabular-nums">
                Total: {fmtInt(kcal)} kcal · proteína {fmtInt(protein)} g
              </p>
            )}
            {!target && (
              <button onClick={() => setChoosing(true)} className="min-h-10 text-[15px] text-eat">
                Juntar a uma refeição já registada
              </button>
            )}
          </>
        )}

        {choosing && (
          <div className="space-y-2">
            <p className="label">Juntar a qual? · {dayLabel(date, today)}</p>
            {dayMeals.length === 0 ? (
              <p className="text-[15px] text-dim">Não há refeições registadas neste dia.</p>
            ) : (
              <ul className="space-y-2">
                {dayMeals.map((m) => (
                  <li key={m.id}>
                    <button
                      disabled={busy}
                      onClick={() => void addTo(m)}
                      className="min-h-12 w-full truncate rounded-xl border border-line px-3 text-left text-[15px]"
                    >
                      {describe(m)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setChoosing(false)} className="min-h-10 text-[15px] text-dim">
              Voltar
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
