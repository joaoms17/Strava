import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import WhenPicker from '../ui/WhenPicker'
import { whenLabel, type When } from '../../lib/when'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton, runBusy } from '../../lib/busy'
import { useProfile, useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { MAX_MEAL_PHOTOS } from '../../lib/capture'
import AttachPhotoButton from '../ui/AttachPhotoButton'
import ItemList from '../ItemList'
import Icon from '../ui/Icon'
import ErrorReason from '../ui/ErrorReason'
import AiCheck from '../AiCheck'
import { LeftoversButton, LeftoversNote } from '../Sobras'
import { analysisStuck } from '../../../api/_lib/rules/analise'
import { splitStoredError } from '../../../api/_lib/rules/resposta-ia'
import { recomputeFrom } from '../../lib/recompute'
import { nutritionalDay, shiftDate } from '../../lib/day'
import { fmtDayShort, fmtInt, fmtKcal, timeOf } from '../../lib/format'
import { deleteMeal, repeatMeal } from '../../lib/meal-actions'
import { deleteFavorite, favoriteFromMeal } from '../../lib/favorites'
import { diffText } from '../../lib/meal-diff'
import { usePeople, type Person } from '../../lib/people'
import { favoriteName, patternKey, similarCount, SIMILAR_MIN_COUNT } from '../../../api/_lib/rules/favoritos'
import { mealTotals } from '../../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, MealItem, Slot } from '../../lib/types'

const MAIN_SLOTS: Slot[] = ['pequeno_almoco', 'almoco', 'jantar']
type Mode = 'view' | 'favorite' | 'when' | 'correct' | 'write'

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
  // Partilhada agora mesmo nesta folha (o servidor só o diz ao abrir).
  const [shared, setShared] = useState<string[]>([])
  const [name, setName] = useState('')
  const [slot, setSlot] = useState<Slot>('almoco')
  const [text, setText] = useState('')
  // «Tentar outra vez» e «Analisar mesmo assim» correm por trás (como no Hoje):
  // a folha mostra «A analisar…» e pode fechar-se.
  const [reanalysing, setReanalysing] = useState(false)
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
  // As outras pessoas da app, para «Partilhar com …» (comeram o mesmo), e com
  // quem já está partilhada; outra vez quando a análise acaba (o «Também para
  // …» do ＋ partilha nessa altura).
  const people = usePeople(id, analysing)
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
  const stuck = analysisStuck(current, Date.now())
  const failed = current.status === 'erro' || stuck
  const dirty = JSON.stringify(items) !== JSON.stringify(current.items)
  const totals = mealTotals(items)
  const proteinOk = MAIN_SLOTS.includes(mealSlot) && totals.protein >= profile.protein_per_meal_g
  // «Também para …» do ＋, à espera do fim da análise.
  const shareWith = current.share_with ?? []
  const goingTo = people.filter((p) => shareWith.includes(p.user_id) && !p.shared)
  // Mexer nos alimentos de uma refeição por rever também a confirma.
  const confirming = current.status === 'por_rever'

  async function call<T>(path: string, body: unknown): Promise<T | null> {
    try {
      return await postApi<T>(path, body)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gravar. Tenta outra vez.')
      return null
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
      ...(confirming ? { confirm: true } : {}),
    })
    if (!result) return
    await afterWrite(result.meal)
    const mealId = current.id
    toast(`${confirming ? 'Confirmado' : 'Guardado'} · ${diffText(result.previous.items, result.meal.items)}`, [
      {
        label: 'Anular',
        run: async () => {
          // Anular volta aos alimentos de antes e, se estava por rever, a por rever.
          await postApi('/api/meal/update', {
            meal_id: mealId,
            items: result.previous.items,
            undo: true,
            ...(confirming ? { confirm: false } : {}),
          }).catch(() => null)
          emitDataChanged()
          recomputeFrom(current.date, today)
        },
      },
    ])
    recomputeFrom(current.date, today)
    sheet.close()
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
      { label: 'Anular', run: () => undo({ items: result.previous.items, undo: true }) },
    ])
    recomputeFrom(current.date, today)
    return true
  }

  async function analyse(body: Record<string, unknown>, message: string) {
    if (reanalysing) return
    setReanalysing(true)
    toast(message)
    const result = await call<{ meal: Meal; limit?: boolean }>('/api/meal/analyse', { meal_id: current.id, ...body })
    setReanalysing(false)
    if (!result) return
    await afterWrite(result.meal)
    if (result.limit) toast('Chegaste ao limite da IA. Podes analisar esta mesmo assim.')
  }

  async function writeInstead() {
    const note = text.trim()
    if (!note) return
    const saved = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, note })
    if (!saved) return
    setText('')
    setMode('view')
    void analyse({ reset: true, force: current.status === 'sem_analise' }, 'A analisar com o que escreveste…')
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

  async function shareTo(person: Person) {
    const result = await call<{ ok: boolean; to: string; already?: boolean }>('/api/meal/share', {
      meal_id: current.id,
      to_user_id: person.user_id,
    })
    if (!result) return
    setShared([...shared, person.user_id])
    toast(
      result.already
        ? `Já estava partilhada com ${result.to}.`
        : `Partilhada com ${result.to}. Aparece-lhe no Hoje para confirmar a porção.`,
    )
  }

  async function confirm() {
    const result = await call<{ meal: Meal }>('/api/meal/update', { meal_id: current.id, confirm: true })
    if (!result) return
    await afterWrite(result.meal)
    toast('Confirmado', [{ label: 'Anular', run: () => undo({ confirm: false }) }])
    // O aviso tem Anular; a folha volta a abrir-se pela refeição.
    sheet.close()
  }

  async function saveFavorite() {
    const favName = name.trim() || favoriteName(current.items)
    let created: { id: string; photoPath: string | null }
    try {
      created = await favoriteFromMeal(current, favName, slot)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar o favorito.')
      return
    }
    setFavoriteId(created.id)
    setSuggest(false)
    setMode('view')
    emitDataChanged()
    toast(`Guardado nos favoritos · ${favName}`, [
      {
        label: 'Anular',
        run: async () => {
          await deleteFavorite(created.id, created.photoPath)
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
      <BusyButton busy="A repor…" onClick={restore} className={primary}>
        Repor esta refeição
      </BusyButton>
    )
  } else if (mode === 'favorite') {
    footer = (
      <BusyButton busy="A guardar…" onClick={saveFavorite} className={primary}>
        Guardar favorito
      </BusyButton>
    )
  } else if (analysed && dirty) {
    footer = (
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button onClick={() => setItems(current.items)} className={secondary}>
          Desfazer
        </button>
        <BusyButton busy={confirming ? 'A confirmar…' : 'A guardar…'} onClick={saveItems} className={primary}>
          {confirming ? 'Guardar e confirmar' : 'Guardar alterações'}
        </BusyButton>
      </div>
    )
  } else if (analysed) {
    footer = (
      <div className="space-y-2">
        {current.status === 'por_rever' && (
          <BusyButton busy="A confirmar…" onClick={confirm} className={primary}>
            Está certo
          </BusyButton>
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
              void runBusy('A registar…', () => repeatMeal(current.id, null, 'Registado hoje', toast))
            }}
            className={secondary}
          >
            Repetir hoje
          </button>
          <button
            onClick={() => {
              sheet.close()
              void runBusy('A apagar…', async () => {
                await deleteMeal(current.id, toast)
                recomputeFrom(current.date, today)
              })
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
          void runBusy('A apagar…', () => deleteMeal(current.id, toast))
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

        {(reanalysing || (current.status === 'a_analisar' && !stuck)) && (
          <div className="space-y-3">
            <p className="animate-pulse text-[17px]">A analisar…</p>
            <p className="text-[13px] text-dim">Os números chegam sozinhos. Podes fechar e continuar.</p>
            {goingTo.length > 0 && (
              <p className="text-[13px] text-dim">Depois vai também para {goingTo.map((p) => p.name).join(' e ')}.</p>
            )}
            <button onClick={() => sheet.open('nota', { id: current.id })} className={`${secondary} w-full`}>
              ＋ Nota
            </button>
          </div>
        )}

        {!reanalysing && (failed || current.status === 'sem_analise') && current.deleted_at == null && (
          <div className="space-y-3">
            {failed ? (
              <ErrorReason
                stored={stuck ? null : current.analysis_error}
                fallback={stuck ? 'A análise parou a meio.' : 'Não consegui analisar esta refeição.'}
              />
            ) : (
              <p className="text-[17px]">Chegaste ao limite da IA que definiste. A foto está guardada.</p>
            )}
            {goingTo.length > 0 && (
              <p className="text-[13px] text-dim">
                Vai para {goingTo.map((p) => p.name).join(' e ')} quando for analisada.
              </p>
            )}
            {failed && (
              <button
                onClick={() => void analyse({ reset: true }, 'A analisar outra vez…')}
                className={`${primary} flex items-center justify-center gap-2`}
              >
                <Icon name="retry" size={20} />
                Tentar outra vez
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {failed ? (
                (current.photo_paths?.length ?? 0) < MAX_MEAL_PHOTOS ? (
                  <AttachPhotoButton
                    meal={current}
                    onDone={() => void load()}
                    className={`${secondary} flex items-center justify-center gap-2`}
                  >
                    <Icon name="camera" size={18} />
                    Juntar foto
                  </AttachPhotoButton>
                ) : (
                  <span />
                )
              ) : (
                <button
                  onClick={() => void analyse({ force: true }, 'A analisar outra vez…')}
                  className={secondary}
                >
                  Analisar esta mesmo assim
                </button>
              )}
              <button onClick={() => setMode('write')} className={secondary}>
                Escrever o que era
              </button>
            </div>
            {failed && <AiCheck compact />}
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
                <BusyButton busy="A guardar…" disabled={!text.trim()} onClick={writeInstead} className={`${primary}`}>
                  Enviar
                </BusyButton>
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
            <LeftoversNote meal={current} />

            {current.model_reserve && current.deleted_at == null && !reanalysing && (
              <div className="space-y-2 rounded-xl bg-surface2 px-3 py-2">
                <p className="text-[14px] text-dim">
                  Hoje a IA principal já não estava disponível; esta foto foi lida por outra que acerta menos nas
                  porções. Confirma as quantidades ou analisa outra vez mais logo.
                </p>
                <button onClick={() => void analyse({ reset: true }, 'A analisar outra vez…')} className="text-[15px] text-eat">
                  Analisar outra vez
                </button>
              </div>
            )}
            {current.analysis_error && (current.photo_paths?.length ?? 0) > 0 && current.deleted_at == null && (
              <p className="text-[14px] text-attn">
                A foto nova não foi analisada. {splitStoredError(current.analysis_error).message} Junta o que faltava
                em «Corrigir por texto».
              </p>
            )}

            <ItemList items={items} onChange={setItems} readOnly={current.deleted_at != null} />

            {current.deleted_at == null && (
              <>
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
                        if (e.key === 'Enter' && text.trim()) void runBusy('A corrigir…', () => correct(text.trim()))
                      }}
                      className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
                    />
                    <BusyButton busy="A corrigir…" disabled={!text.trim()} onClick={() => correct(text.trim())} className={primary}>
                      Corrigir
                    </BusyButton>
                  </div>
                ) : (
                  mode === 'view' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px]">
                      <button onClick={() => setMode('correct')} className="text-eat">
                        Corrigir por texto
                      </button>
                      <button onClick={() => setMode('when')} className="text-eat">
                        Mudar dia ou refeição
                      </button>
                      {(current.photo_paths?.length ?? 0) < MAX_MEAL_PHOTOS && (
                        <AttachPhotoButton meal={current} onDone={() => void load()} className="text-eat">
                          Juntar foto
                        </AttachPhotoButton>
                      )}
                      <LeftoversButton meal={current} onDone={() => void load()} className="text-eat" />
                      {people.map((p) =>
                        p.shared || shared.includes(p.user_id) || shareWith.includes(p.user_id) ? (
                          <span key={p.user_id} className="text-dim">
                            Partilhada com {p.name} ✓
                          </span>
                        ) : (
                          <BusyButton key={p.user_id} busy="A partilhar…" onClick={() => shareTo(p)} className="text-eat">
                            Partilhar com {p.name}
                          </BusyButton>
                        ),
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

        {mode === 'when' && (
          <PickWhen
            today={today}
            initial={{ date: current.date, slot: mealSlot }}
            action="Mudar"
            unchanged={(date, slot) => date === current.date && slot === mealSlot}
            onPick={(date, slot) => moveTo(date, slot)}
          />
        )}

      </div>
    </BottomSheet>
  )
}

// Escolher dia (qualquer um) e refeição: para mudar esta ou copiá-la.
function PickWhen({
  today,
  initial,
  action,
  unchanged,
  onPick,
}: {
  today: string
  initial: When
  action: string
  unchanged?: (date: string, slot: Slot) => boolean
  onPick: (date: string, slot: Slot, label: string) => unknown
}) {
  const [when, setWhen] = useState<When>(initial)
  // «Agora» é a refeição desta hora.
  const slot = when.slot === 'agora' ? slotOf(new Date()) : when.slot
  return (
    <div className="space-y-3">
      <WhenPicker today={today} value={when} onChange={setWhen} />
      <BusyButton
        busy="A mudar…"
        disabled={slot == null || (unchanged?.(when.date, slot) ?? false)}
        onClick={() => slot && onPick(when.date, slot, whenLabel(when, today))}
        className="min-h-12 w-full rounded-xl bg-eat font-semibold text-bg disabled:opacity-40"
      >
        {action}
      </BusyButton>
    </div>
  )
}
