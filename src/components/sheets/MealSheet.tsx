import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { DayChips, SlotChips, TAG_LABEL, TagChips } from '../ui/Chips'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useProfile, useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { MAX_MEAL_PHOTOS } from '../../lib/capture'
import AttachPhotoButton from '../ui/AttachPhotoButton'
import Icon from '../ui/Icon'
import { recomputeFrom } from '../../lib/recompute'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtDayShort, fmtInt, fmtKcal, timeOf } from '../../lib/format'
import { deleteMeal, repeatMeal } from '../../lib/meal-actions'
import { diffText, stepItem } from '../../lib/meal-diff'
import { favoriteName, patternKey, similarCount, SIMILAR_MIN_COUNT } from '../../../api/_lib/rules/favoritos'
import { mealTotals } from '../../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, MealItem, Slot } from '../../lib/types'

const MAIN_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']
type Mode = 'view' | 'favorite' | 'copy' | 'when' | 'correct' | 'write'

// Ver, confirmar, corrigir, repetir, guardar como favorito ou apagar uma
// refeição, com os itens sempre visíveis.
export default function MealSheet() {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const sheet = useSheet()
  const toast = useToast()
  const id = sheet.params.get('id')
  const [meal, setMeal] = useState<Meal | null | undefined>(undefined)
  const [photos, setPhotos] = useState<string[]>([])
  const [favoriteId, setFavoriteId] = useState<string | null>(null)
  const [suggest, setSuggest] = useState(false)
  const [items, setItems] = useState<MealItem[]>([])
  const [mode, setMode] = useState<Mode>('view')
  const [name, setName] = useState('')
  const [slot, setSlot] = useState<Slot>('almoco')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)

  async function load() {
    if (!id) return
    const [{ data }, { data: favs }] = await Promise.all([
      supabase.from('meals').select('*').eq('id', id).maybeSingle(),
      supabase.from('favorites').select('id').eq('source_meal_id', id).eq('archived', false).limit(1),
    ])
    const row = (data ?? null) as Meal | null
    setMeal(row)
    if (!row) return
    setItems(row.items)
    setFavoriteId(row.favorite_id ?? favs?.[0]?.id ?? null)
    setName(favoriteName(row.items))
    setSlot(row.slot ?? slotOf(new Date(row.logged_at)))
    const paths = row.photo_paths?.length ? row.photo_paths : row.photo_path ? [row.photo_path] : []
    if (paths.length) {
      const urls = await signedUrls(paths)
      setPhotos(paths.map((p) => urls[p]).filter((u): u is string => !!u))
    }
    // Sugestão de favorito: a 3.ª refeição parecida no mesmo momento, em 30 dias.
    if (!row.favorite_id && !favs?.length && row.items.length && (row.status === 'ok' || row.status === 'por_rever')) {
      const key = patternKey(row.items)
      if (!(profile.dismissed_hints ?? []).includes(key)) {
        const { data: recent } = await supabase
          .from('meals_counted')
          .select('id,items')
          .eq('slot', row.slot ?? slotOf(new Date(row.logged_at)))
          .gte('date', shiftDate(today, -30))
          .neq('id', row.id)
          .limit(60)
        const others = ((recent ?? []) as Pick<Meal, 'items'>[]).map((m) => m.items)
        setSuggest(similarCount(row.items, others) >= SIMILAR_MIN_COUNT)
      }
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Enquanto analisa, os números chegam sozinhos.
  const analysing = meal?.status === 'a_analisar'
  useEffect(() => {
    if (!analysing) return
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 3000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysing, id])

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

  const current = meal
  const mealSlot = current.slot ?? slotOf(new Date(current.logged_at))
  const analysed = current.status === 'ok' || current.status === 'por_rever'
  const dirty = JSON.stringify(items) !== JSON.stringify(current.items)
  const totals = mealTotals(items)
  const proteinOk = MAIN_SLOTS.includes(mealSlot) && totals.protein >= profile.protein_per_meal_g

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    setBusy(true)
    try {
      return await postApi<T>(path, body)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function afterWrite(updated: Meal | undefined) {
    emitDataChanged()
    if (updated) {
      setMeal(updated)
      setItems(updated.items)
    }
  }

  async function saveItems() {
    const result = await call<{ meal: Meal; previous: { items: MealItem[] } }>('/api/meal/update', {
      meal_id: current.id,
      items,
    })
    if (!result) return
    await afterWrite(result.meal)
    toast(`Guardado · ${diffText(result.previous.items, result.meal.items)}`, [
      { label: 'Anular', run: () => undo({ items: result.previous.items }) },
    ])
    recomputeFrom(current.date, today)
  }

  async function undo(body: Record<string, unknown>) {
    const result = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, ...body })
    if (result) await afterWrite(result.meal)
  }

  async function correct(correction: string) {
    const result = await call<{ meal: Meal; previous: { items: MealItem[] } }>('/api/meal/correct', {
      meal_id: current.id,
      text: correction,
    })
    if (!result) return false
    await afterWrite(result.meal)
    setMode('view')
    setText('')
    toast(diffText(result.previous.items, result.meal.items), [
      { label: 'Anular', run: () => undo({ items: result.previous.items }) },
    ])
    recomputeFrom(current.date, today)
    return true
  }

  async function toggleTag(tag: string) {
    const on = !(current.tags ?? []).includes(tag)
    const tags = on ? [...(current.tags ?? []), tag] : (current.tags ?? []).filter((t) => t !== tag)
    // Com a análise feita, ligar «Comi metade» (ou outra marca) corrige a refeição.
    if (on && analysed && tag !== 'jantar_fora') {
      if (!(await correct(TAG_LABEL[tag] ?? tag))) return
    }
    const result = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, tags })
    if (result) await afterWrite(result.meal)
  }

  async function analyse(body: Record<string, unknown>, message: string) {
    const result = await call<{ meal: Meal; limit?: boolean }>('/api/meal/analyse', { meal_id: current.id, ...body })
    if (!result) return
    await afterWrite(result.meal)
    toast(result.limit ? 'Chegaste ao limite da IA. Podes analisar esta mesmo assim.' : message)
  }

  async function writeInstead() {
    const note = text.trim()
    if (!note) return
    const saved = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, note })
    if (!saved) return
    setText('')
    setMode('view')
    await analyse({ reset: true, force: current.status === 'sem_analise' }, 'A analisar com o que escreveste…')
  }

  async function moveTo(date: string, newSlot: Slot) {
    const result = await call<{ meal: Meal; previous: { logged_at: string } }>('/api/meal/update', {
      meal_id: current.id,
      date,
      slot: newSlot,
    })
    if (!result) return
    await afterWrite(result.meal)
    setMode('view')
    recomputeFrom(date < current.date ? date : current.date, today)
    toast(`Passou para ${SLOT_LABEL[newSlot].toLowerCase()}${date !== today ? ` de ${fmtDayShort(date)}` : ''}`, [
      { label: 'Anular', run: () => undo({ logged_at: result.previous.logged_at }) },
    ])
  }

  async function confirm() {
    const result = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, confirm: true })
    if (!result) return
    await afterWrite(result.meal)
    toast('Confirmado', [{ label: 'Anular', run: () => undo({ confirm: false }) }])
  }

  async function saveFavorite() {
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
    const source = current.photo_paths?.[0] ?? current.photo_path
    if (source) {
      const target = `${user.id}/fav/${newId}.jpg`
      const { error } = await supabase.storage.from('meal-photos').copy(source, target)
      if (!error) photoPath = target
    }
    const favoriteTotals = mealTotals(current.items)
    const { error } = await supabase.from('favorites').insert({
      id: newId,
      user_id: user.id,
      kind: 'meal',
      name: name.trim() || favoriteName(current.items),
      items: current.items,
      kcal: Math.round(favoriteTotals.kcal),
      protein: favoriteTotals.protein,
      carbs: favoriteTotals.carbs,
      fat: favoriteTotals.fat,
      photo_path: photoPath,
      default_slot: slot,
      source_meal_id: current.id,
    })
    setBusy(false)
    if (error) {
      toast('Não consegui guardar o favorito.')
      return
    }
    setFavoriteId(newId)
    setSuggest(false)
    setMode('view')
    emitDataChanged()
    toast(`Guardado nos favoritos · ${name.trim() || favoriteName(current.items)}`, [
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
    const result = await call<{ meal: Meal }>('/api/meal/restore', { meal_id: current.id })
    if (!result) return
    emitDataChanged()
    recomputeFrom(current.date, today)
    sheet.close()
  }

  const primary = 'min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40'
  const secondary = 'min-h-12 rounded-xl bg-surface2 text-[15px] disabled:opacity-40'

  let footer = null
  if (current.deleted_at != null) {
    footer = (
      <button disabled={busy} onClick={() => void restore()} className={primary}>
        Repor esta refeição
      </button>
    )
  } else if (mode === 'favorite') {
    footer = (
      <button disabled={busy} onClick={() => void saveFavorite()} className={primary}>
        Guardar favorito
      </button>
    )
  } else if (analysed && dirty) {
    footer = (
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button onClick={() => setItems(current.items)} className={secondary}>
          Desfazer
        </button>
        <button disabled={busy} onClick={() => void saveItems()} className={primary}>
          Guardar alterações
        </button>
      </div>
    )
  } else if (analysed) {
    footer = (
      <div className="space-y-2">
        {current.status === 'por_rever' && (
          <button disabled={busy} onClick={() => void confirm()} className={primary}>
            Está certo
          </button>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => (favoriteId ? undefined : setMode('favorite'))}
            className={`${secondary} ${favoriteId ? 'text-attn' : ''}`}
          >
            {favoriteId ? '★ Favorito' : '☆ Favorito'}
          </button>
          <button
            onClick={() => {
              sheet.close()
              void repeatMeal(current.id, null, 'Registado hoje', toast)
            }}
            className={secondary}
          >
            Repetir hoje
          </button>
          <button
            onClick={() => {
              sheet.close()
              void deleteMeal(current.id, toast)
              recomputeFrom(current.date, today)
            }}
            className={`${secondary} text-pain`}
          >
            Apagar
          </button>
        </div>
      </div>
    )
  } else {
    footer = (
      <button
        onClick={() => {
          sheet.close()
          void deleteMeal(current.id, toast)
        }}
        className={`${secondary} w-full text-pain`}
      >
        Apagar
      </button>
    )
  }

  return (
    <BottomSheet
      title={
        <span>
          {SLOT_LABEL[mealSlot]} · <span className="tabular-nums">{timeOf(current.logged_at)}</span>
          {current.date !== today && <span className="text-dim"> · {fmtDayShort(current.date)}</span>}
        </span>
      }
      onClose={sheet.close}
      footer={footer}
    >
      <div className="space-y-4 pb-2">
        {current.deleted_at && (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">Apagada — não conta para as contas.</p>
        )}
        {photos.length > 0 && (
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4">
            {photos.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className={`h-60 shrink-0 snap-center rounded-2xl object-cover ${photos.length > 1 ? 'w-[85%]' : 'w-full'}`}
              />
            ))}
          </div>
        )}
        {current.raw_text && current.input_type !== 'favorite' && (
          <p className="text-[15px] text-dim">«{current.raw_text}»</p>
        )}
        {current.note && <p className="text-[15px]">Nota: {current.note}</p>}

        {current.status === 'a_analisar' && (
          <div className="space-y-3">
            <p className="animate-pulse text-[17px]">A analisar…</p>
            <p className="text-[13px] text-dim">Os números chegam sozinhos. Podes fechar e continuar.</p>
            <button onClick={() => sheet.open('nota', { id: current.id })} className={`${secondary} w-full`}>
              ＋ Nota
            </button>
          </div>
        )}

        {(current.status === 'erro' || current.status === 'sem_analise') && current.deleted_at == null && (
          <div className="space-y-3">
            <p className="text-[17px]">
              {current.status === 'erro'
                ? (current.analysis_error ?? 'Não consegui ler esta refeição.')
                : 'Chegaste ao limite da IA que definiste. A foto está guardada.'}
            </p>
            {current.status === 'erro' && (current.photo_paths?.length ?? 0) < MAX_MEAL_PHOTOS && (
              <AttachPhotoButton
                meal={current}
                onDone={() => void load()}
                className={`${primary} flex items-center justify-center gap-2`}
              >
                <Icon name="camera" size={20} />
                Juntar outra foto
              </AttachPhotoButton>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() =>
                  void analyse(
                    current.status === 'erro' ? { reset: true } : { force: true },
                    'A analisar outra vez…',
                  )
                }
                className={secondary}
              >
                {current.status === 'erro' ? 'Tentar de novo' : 'Analisar esta mesmo assim'}
              </button>
              <button onClick={() => setMode('write')} className={secondary}>
                Escrever o que era
              </button>
            </div>
            {mode === 'write' && (
              <div className="space-y-2">
                <textarea
                  rows={2}
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ex.: bitoque com batata frita e ovo"
                  className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
                />
                <button disabled={busy || !text.trim()} onClick={() => void writeInstead()} className={`${primary}`}>
                  Enviar
                </button>
              </div>
            )}
          </div>
        )}

        {analysed && (
          <>
            <div>
              <p className="num text-[32px]">
                {current.is_estimate ? '≈ ' : ''}
                {fmtKcal(totals.kcal)} kcal
              </p>
              <p className="text-[15px] text-dim tabular-nums">
                <span className={proteinOk ? 'text-protein' : ''}>Proteína {fmtInt(totals.protein)} g</span> · Hidratos{' '}
                {fmtInt(totals.carbs)} g · Gordura {fmtInt(totals.fat)} g
              </p>
            </div>

            <ul className="divide-y divide-line rounded-2xl bg-surface2">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">{item.name}</p>
                    <p className="text-[13px] text-dim tabular-nums">
                      {item.grams > 0 && `${fmtInt(item.grams)} g · `}
                      {fmtInt(item.kcal)} kcal
                      {item.confidence === 'baixa' && <span className="ml-1 text-attn">confirma a porção</span>}
                    </p>
                  </div>
                  {item.grams > 0 && current.deleted_at == null && (
                    <>
                      <button
                        onClick={() => setItems(items.map((it, j) => (j === i ? stepItem(it, -10) : it)))}
                        className="h-10 w-10 shrink-0 rounded-lg bg-surface text-[17px]"
                        aria-label={`menos 10 g de ${item.name}`}
                      >
                        −
                      </button>
                      <button
                        onClick={() => setItems(items.map((it, j) => (j === i ? stepItem(it, 10) : it)))}
                        className="h-10 w-10 shrink-0 rounded-lg bg-surface text-[17px]"
                        aria-label={`mais 10 g de ${item.name}`}
                      >
                        +
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {current.deleted_at == null && (
              <>
                <TagChips value={current.tags ?? []} onToggle={(tag) => void toggleTag(tag)} />

                {suggest && mode === 'view' && (
                  <div className="space-y-2 rounded-2xl border border-line p-3">
                    <p className="text-[15px]">Registas isto muitas vezes. Guardar como favorito?</p>
                    <div className="flex gap-2">
                      <button onClick={() => setMode('favorite')} className="min-h-11 flex-1 rounded-xl bg-eat font-semibold text-bg">
                        Guardar
                      </button>
                      <button
                        onClick={() => {
                          setSuggest(false)
                          void update({ dismissed_hints: [...(profile.dismissed_hints ?? []), patternKey(current.items)] })
                        }}
                        className="min-h-11 px-3 text-[15px] text-dim"
                      >
                        Não voltar a perguntar
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'correct' ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Ex.: o arroz era metade, sem queijo"
                      enterKeyHint="send"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && text.trim()) void correct(text.trim())
                      }}
                      className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
                    />
                    <button disabled={busy || !text.trim()} onClick={() => void correct(text.trim())} className={primary}>
                      {busy ? 'A corrigir…' : 'Corrigir'}
                    </button>
                  </div>
                ) : (
                  mode === 'view' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px]">
                      <button onClick={() => setMode('correct')} className="text-eat">
                        Corrigir por texto
                      </button>
                      <button onClick={() => setMode('when')} className="text-eat">
                        Mudar dia ou momento
                      </button>
                      <button onClick={() => setMode('copy')} className="text-eat">
                        Copiar para outro dia
                      </button>
                      {photos.length > 0 && (
                        <button
                          disabled={busy}
                          onClick={() => void analyse({ reset: true }, 'A analisar a foto outra vez…')}
                          className="text-eat"
                        >
                          Reanalisar foto
                        </button>
                      )}
                      {(current.photo_paths?.length ?? 0) < MAX_MEAL_PHOTOS && (
                        <AttachPhotoButton meal={current} onDone={() => void load()} className="text-eat">
                          Juntar foto
                        </AttachPhotoButton>
                      )}
                    </div>
                  )
                )}
              </>
            )}
          </>
        )}

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

        {mode === 'when' && <WhenPicker today={today} initialDate={current.date} initialSlot={mealSlot} onPick={moveTo} />}

        {mode === 'copy' && (
          <div className="flex flex-wrap gap-2">
            {[0, -1, -2].map((back) => {
              const date = shiftDate(today, back)
              if (date === current.date) return null
              return (
                <button
                  key={back}
                  onClick={() => {
                    sheet.close()
                    void repeatMeal(
                      current.id,
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

function WhenPicker({
  today,
  initialDate,
  initialSlot,
  onPick,
}: {
  today: string
  initialDate: string
  initialSlot: Slot
  onPick: (date: string, slot: Slot) => void
}) {
  const [date, setDate] = useState(initialDate)
  const [slot, setSlot] = useState<Slot>(initialSlot)
  return (
    <div className="space-y-3">
      <DayChips today={today} value={date} onChange={setDate} />
      <SlotChips value={slot} onChange={(s) => setSlot(s as Slot)} />
      <button
        disabled={date === initialDate && slot === initialSlot}
        onClick={() => onPick(date, slot)}
        className="min-h-12 w-full rounded-xl bg-eat font-semibold text-bg disabled:opacity-40"
      >
        Mudar
      </button>
    </div>
  )
}
