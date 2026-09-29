import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { nutritionalDay } from '../../lib/day'
import { fmtInt, fmtKcal, timeOf } from '../../lib/format'
import { diffText } from '../../lib/meal-diff'
import { SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, MealItem } from '../../lib/types'

// Rever à noite as refeições com dúvidas. Opcional: já contam, com ≈.
// Só botões, sem gestos; «Corrigir» abre no próprio cartão.
export default function ReviewSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const date = sheet.params.get('data') ?? nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const [correcting, setCorrecting] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('meals')
        .select('*')
        .eq('date', date)
        .eq('status', 'por_rever')
        .is('deleted_at', null)
        .order('logged_at')
      const rows = (data ?? []) as Meal[]
      setMeals(rows)
      setPhotos(await signedUrls(rows.map((m) => m.photo_paths?.[0] ?? m.photo_path).filter((p): p is string => !!p)))
    })()
  }, [date])

  const meal = meals?.[index] ?? null

  function next() {
    setCorrecting(false)
    setText('')
    setIndex((i) => i + 1)
  }

  async function confirm() {
    if (!meal) return
    setBusy(true)
    try {
      await postApi('/api/meal/update', { meal_id: meal.id, confirm: true })
      emitDataChanged()
      const confirmed = meal.id
      toast('Confirmado', [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/update', { meal_id: confirmed, confirm: false })
            emitDataChanged()
          },
        },
      ])
      next()
    } catch {
      toast('Não consegui gravar. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  async function correct() {
    if (!meal || !text.trim()) return
    setBusy(true)
    try {
      const result = await postApi<{ meal: Meal; previous: { items: MealItem[] } }>('/api/meal/correct', {
        meal_id: meal.id,
        text: text.trim(),
      })
      emitDataChanged()
      const corrected = meal.id
      toast(diffText(result.previous.items, result.meal.items), [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/update', { meal_id: corrected, items: result.previous.items })
            emitDataChanged()
          },
        },
      ])
      next()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui corrigir.')
    } finally {
      setBusy(false)
    }
  }

  if (meals == null) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }

  if (!meal) {
    return (
      <BottomSheet title="Rever" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Nada por confirmar.</p>
      </BottomSheet>
    )
  }

  const photo = photos[meal.photo_paths?.[0] ?? meal.photo_path ?? '']
  return (
    <BottomSheet
      title={`${index + 1} de ${meals.length}`}
      onClose={sheet.close}
      footer={
        correcting ? (
          <button
            disabled={busy || !text.trim()}
            onClick={() => void correct()}
            className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
          >
            {busy ? 'A corrigir…' : 'Corrigir'}
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <button disabled={busy} onClick={() => void confirm()} className="min-h-14 rounded-2xl bg-eat font-semibold text-bg">
              Está certo
            </button>
            <button onClick={() => setCorrecting(true)} className="min-h-14 rounded-2xl bg-surface2 text-[15px]">
              Corrigir
            </button>
            <button onClick={next} className="min-h-14 rounded-2xl bg-surface2 text-[15px] text-dim">
              Depois
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3 pb-2">
        {photo && <img src={photo} alt="" className="max-h-64 w-full rounded-2xl object-cover" />}
        <p className="text-[15px] text-dim">
          {SLOT_LABEL[meal.slot ?? slotOf(new Date(meal.logged_at))]} · {timeOf(meal.logged_at)}
        </p>
        <ul className="divide-y divide-line rounded-2xl bg-surface2">
          {meal.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 px-3 py-2.5 text-[15px]">
              <span className="min-w-0">
                {item.name} <span className="text-dim tabular-nums">· {fmtInt(item.grams)} g</span>
                {item.confidence === 'baixa' && <span className="ml-1 text-[13px] text-attn">confirma a porção</span>}
              </span>
              <span className="shrink-0 text-dim tabular-nums">{fmtInt(item.kcal)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[17px] font-semibold tabular-nums">≈ {fmtKcal(Number(meal.kcal))} kcal</p>
        {correcting && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ex.: o arroz era metade, sem queijo"
            className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
          />
        )}
      </div>
    </BottomSheet>
  )
}
