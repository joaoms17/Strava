import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { nutritionalDay } from '../../lib/day'
import { recomputeFrom } from '../../lib/recompute'
import { fmtInt, fmtKcal, timeOf } from '../../lib/format'
import { diffText } from '../../lib/meal-diff'
import { PORTION_FACTORS, portionLabel } from '../../../api/_lib/rules/favoritos'
import { sharedFrom } from '../../../api/_lib/rules/partilha'
import { SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, MealItem } from '../../lib/types'

// Rever à noite as refeições com dúvidas. Opcional: já contam, com ≈.
// Só botões, sem gestos; «Corrigir» abre no próprio cartão e a porção muda
// com um toque (½ · 1 · 1½ · 2), que também confirma. Com ?id=, só essa
// refeição (a que outra pessoa partilhou, a partir do Hoje, a qualquer hora).
// Depois da última, a folha fecha (o aviso mantém o Anular).
export default function ReviewSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const date = sheet.params.get('data') ?? today
  const only = sheet.params.get('id')
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [correcting, setCorrecting] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    void (async () => {
      let query = supabase.from('meals').select('*').eq('status', 'por_rever').is('deleted_at', null)
      query = only ? query.eq('id', only) : query.eq('date', date)
      const { data } = await query.order('logged_at')
      const rows = (data ?? []) as Meal[]
      setMeals(rows)
      setPhotos(await signedUrls(rows.map((m) => m.photo_paths?.[0] ?? m.photo_path).filter((p): p is string => !!p)))
    })()
  }, [date, only])

  const meal = meals?.[index] ?? null
  const last = meals != null && index + 1 >= meals.length

  // A seguinte, ou fechar depois da última.
  function next(skip = false) {
    if (skip) setSkipped((n) => n + 1)
    if (last) {
      sheet.close()
      return
    }
    setCorrecting(false)
    setText('')
    setIndex((i) => i + 1)
  }

  async function confirm() {
    if (!meal) return
    try {
      await postApi('/api/meal/update', { meal_id: meal.id, confirm: true })
      emitDataChanged()
      const confirmed = meal.id
      toast(last && skipped === 0 && meals!.length > 1 ? 'Tudo confirmado' : 'Confirmado', [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/update', { meal_id: confirmed, confirm: false })
            emitDataChanged()
          },
        },
      ])
      next()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')
    }
  }

  // A porção certa (a da cópia é a de quem partilhou): muda e confirma.
  async function setPortion(factor: number) {
    if (!meal) return
    const before = Number(meal.portion_factor ?? 1)
    if (factor === before) return confirm()
    try {
      const { meal: changed } = await postApi<{ meal: Meal }>('/api/meal/portion', { meal_id: meal.id, factor })
      setMeals((list) => list?.map((m) => (m.id === changed.id ? { ...m, ...changed } : m)) ?? list)
      emitDataChanged()
      recomputeFrom(meal.date, today)
      await postApi('/api/meal/update', { meal_id: meal.id, confirm: true })
      emitDataChanged()
      const mealId = meal.id
      const day = meal.date
      toast(`Porção ${portionLabel(factor)} · ${fmtKcal(Number(changed.kcal))} kcal`, [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/portion', { meal_id: mealId, factor: before })
            await postApi('/api/meal/update', { meal_id: mealId, confirm: false })
            emitDataChanged()
            recomputeFrom(day, today)
          },
        },
      ])
      next()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')
    }
  }

  async function correct() {
    if (!meal || !text.trim()) return
    try {
      const result = await postApi<{ meal: Meal; previous: { items: MealItem[] } }>('/api/meal/correct', {
        meal_id: meal.id,
        text: text.trim(),
      })
      emitDataChanged()
      recomputeFrom(meal.date, today)
      const corrected = meal.id
      const day = meal.date
      toast(diffText(result.previous.items, result.meal.items), [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/update', { meal_id: corrected, items: result.previous.items, undo: true })
            emitDataChanged()
            recomputeFrom(day, today)
          },
        },
      ])
      next()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui corrigir.')
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
  const from = sharedFrom(meal.note)
  const factor = Number(meal.portion_factor ?? 1)
  const when = `${SLOT_LABEL[meal.slot ?? slotOf(new Date(meal.logged_at))]} · ${timeOf(meal.logged_at)}`
  const portions = (
    <div className="space-y-1.5">
      <p className="text-[13px] text-dim">{from ? 'A tua porção' : 'Porção'} · toca e fica confirmada</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={from ? 'A tua porção' : 'Porção'}>
        {PORTION_FACTORS.map((f) => (
          <BusyButton
            key={f}
            compact
            busy={f === factor ? 'A confirmar…' : 'A mudar a porção…'}
            aria-pressed={f === factor}
            onClick={() => setPortion(f)}
            className={`min-h-12 rounded-xl border text-[17px] font-semibold tabular-nums ${
              f === factor ? 'border-eat bg-eat text-bg' : 'border-line'
            }`}
          >
            {portionLabel(f)}
          </BusyButton>
        ))}
      </div>
    </div>
  )

  return (
    <BottomSheet
      title={meals.length > 1 ? `${index + 1} de ${meals.length}` : 'Rever'}
      onClose={sheet.close}
      footer={
        correcting ? (
          <BusyButton
            busy="A corrigir…"
            disabled={!text.trim()}
            onClick={correct}
            className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
          >
            Corrigir
          </BusyButton>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <BusyButton busy="A confirmar…" onClick={confirm} className="min-h-14 rounded-2xl bg-eat font-semibold text-bg">
              Está certo
            </BusyButton>
            <button onClick={() => setCorrecting(true)} className="min-h-14 rounded-2xl bg-surface2 text-[15px]">
              Corrigir
            </button>
            <button onClick={() => next(true)} className="min-h-14 rounded-2xl bg-surface2 text-[15px] text-dim">
              Depois
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3 pb-2">
        {/* Partilhada: a porção é o que há para decidir, por isso vem primeiro. */}
        {from && (
          <>
            <p className="text-[15px] text-dim">
              {when} · <span className="text-ink">{meal.note}</span>
            </p>
            {!correcting && portions}
          </>
        )}
        {photo && <img src={photo} alt="" className="max-h-64 w-full rounded-2xl object-cover" />}
        {!from && (
          <>
            <p className="text-[15px] text-dim">{when}</p>
            {meal.note && <p className="text-[15px]">Nota: {meal.note}</p>}
          </>
        )}
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
        {!from && !correcting && portions}
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
