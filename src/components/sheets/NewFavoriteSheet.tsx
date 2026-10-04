import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import MealHistoryList, { type HistoryMeal } from '../MealHistoryList'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { postApi } from '../../lib/api'
import { nutritionalDay } from '../../lib/day'
import { fmtInt, fmtKcal } from '../../lib/format'
import { stepItem } from '../../lib/meal-diff'
import { mealName, mealSlot } from '../../lib/repetir'
import { deleteFavorite, favoriteFromMeal, insertFavorite, uploadFavoritePhoto } from '../../lib/favorites'
import { favoriteName } from '../../../api/_lib/rules/favoritos'
import { addOption } from '../../../api/_lib/rules/dieta'
import { peekDietDraft, saveDietDraft } from '../../lib/diets'
import { mealTotals } from '../../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL } from '../../../api/_lib/rules/momentos'
import { chip } from '../ui/Chips'
import type { MealItem, ParsedMealResponse, Slot } from '../../lib/types'

type Mode = 'escrever' | 'refeicao'

// Nova refeição favorita: escrever o que leva (e juntar a foto que vai
// aparecer sempre que a usares) ou escolher uma refeição já registada.
export default function NewFavoriteSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [mode, setMode] = useState<Mode>(sheet.params.get('modo') === 'refeicao' ? 'refeicao' : 'escrever')
  const [favId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [uploaded, setUploaded] = useState<string | null>(null)
  const initialSlot = sheet.params.get('momento') as Slot | null
  const [slot, setSlot] = useState<Slot | null>(initialSlot && SLOTS.includes(initialSlot) ? initialSlot : null)
  const [items, setItems] = useState<MealItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url)
  }, [photo])

  const totals = items ? mealTotals(items) : null

  // Criada a meio de uma dieta: volta à dieta, já com ela na refeição.
  function backToDiet(newId: string): boolean {
    if (sheet.params.get('voltar') !== 'dieta') return false
    const draft = peekDietDraft()
    if (!draft) return false
    const target = (SLOTS as string[]).includes(draft.slot ?? '') ? (draft.slot as Slot) : null
    saveDietDraft({ ...draft, meals: target ? addOption(draft.meals, target, newId) : draft.meals })
    sheet.open('dieta', draft.id ? { id: draft.id } : {})
    return true
  }

  // A foto sobe uma vez (para a análise por foto ou ao guardar).
  async function photoPath(): Promise<string | null> {
    if (!photo) return null
    if (uploaded) return uploaded
    const path = await uploadFavoritePhoto(photo.file, favId)
    setUploaded(path)
    return path
  }

  async function calculate() {
    if (busy || (!text.trim() && !photo)) return
    setBusy(true)
    try {
      // Com texto contam as palavras (mais exatas); só com foto, a IA olha para a foto.
      const parsed = text.trim()
        ? await postApi<ParsedMealResponse>('/api/meal/parse-text', { text: text.trim() })
        : await postApi<ParsedMealResponse>('/api/meal/parse-photo', {
            photo_path: await photoPath(),
            note: name.trim(),
          })
      if (parsed.items.length === 0) toast('Não percebi o que leva. Escreve os alimentos e as quantidades.')
      setItems(parsed.items.length ? parsed.items : null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui calcular. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!items || busy) return
    setBusy(true)
    try {
      const path = await photoPath()
      const finalName = name.trim() || favoriteName(items)
      await insertFavorite({ id: favId, name: finalName, items, slot, photoPath: path })
      emitDataChanged()
      if (backToDiet(favId)) {
        toast(`Guardada nas favoritas · ${finalName}`)
        return
      }
      sheet.close()
      toast(`Guardada nas favoritas · ${finalName}`, [
        {
          label: 'Anular',
          run: async () => {
            await deleteFavorite(favId, path)
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

  async function fromMeal(meal: HistoryMeal) {
    if (busy) return
    setBusy(true)
    try {
      const finalName = mealName(meal).slice(0, 60)
      const created = await favoriteFromMeal(meal, finalName, mealSlot(meal))
      emitDataChanged()
      if (backToDiet(created.id)) {
        toast(`Guardada nas favoritas · ${finalName}`)
        return
      }
      sheet.close()
      toast(`Guardada nas favoritas · ${finalName}`, [
        {
          label: 'Anular',
          run: async () => {
            await deleteFavorite(created.id, created.photoPath)
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

  const field =
    'w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none'
  const segment = (m: Mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`min-h-10 rounded-lg ${mode === m ? 'bg-surface font-semibold' : 'text-dim'}`}
    >
      {label}
    </button>
  )

  return (
    <BottomSheet
      title="Nova favorita"
      onClose={sheet.close}
      footer={
        mode === 'escrever' ? (
          items ? (
            <button
              disabled={busy}
              onClick={() => void save()}
              className="min-h-14 w-full rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40"
            >
              {busy ? 'A guardar…' : 'Guardar favorita'}
            </button>
          ) : (
            <button
              disabled={busy || (!text.trim() && !photo)}
              onClick={() => void calculate()}
              className="min-h-14 w-full rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40"
            >
              {busy ? 'A calcular…' : 'Calcular'}
            </button>
          )
        ) : undefined
      }
    >
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-2 rounded-xl bg-surface2 p-1 text-[15px]">
          {segment('escrever', 'Escrever')}
          {segment('refeicao', 'De uma refeição')}
        </div>

        {mode === 'refeicao' ? (
          <>
            <p className="text-[14px] text-dim">Toca numa refeição que já registaste: fica nas favoritas com a foto dela.</p>
            <MealHistoryList
              today={today}
              onPick={(meal) => void fromMeal(meal)}
              exclude={(meal) => meal.input_type === 'favorite'}
              emptyText="Ainda não há refeições analisadas para guardar."
            />
          </>
        ) : (
          <>
            <div className="flex gap-3">
              <label className="relative flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-dashed border-line text-[13px] text-dim">
                {photo ? (
                  <img src={photo.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <>
                    <Icon name="camera" size={26} />
                    Foto
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Foto da favorita"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    setPhoto({ file, url: URL.createObjectURL(file) })
                    setUploaded(null)
                    if (!text.trim()) setItems(null)
                  }}
                />
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="Nome (ex.: Papas de aveia)"
                  aria-label="Nome da favorita"
                  className={`${field} h-11`}
                />
                {photo && (
                  <button onClick={() => setPhoto(null)} className="text-[14px] text-dim">
                    Tirar a foto
                  </button>
                )}
              </div>
            </div>

            <textarea
              rows={3}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setItems(null)
              }}
              placeholder="O que leva? Ex.: 60 g de aveia, 200 ml de leite meio-gordo, 1 banana"
              aria-label="O que leva"
              className={`${field} block resize-none py-3 text-[17px]`}
            />
            <p className="-mt-2 text-[13px] text-dim">
              Com texto, a conta sai das quantidades; só com a foto, a IA estima pela foto.
            </p>

            {items && totals && (
              <div className="space-y-2">
                <ul className="divide-y divide-line rounded-2xl bg-surface2 text-[15px]">
                  {items.map((item, i) => (
                    <li key={`${item.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate">
                        {item.name} <span className="text-dim tabular-nums">· {fmtInt(item.grams)} g</span>
                      </span>
                      <span className="shrink-0 text-dim tabular-nums">{fmtInt(item.kcal)}</span>
                      {item.grams > 0 && (
                        <>
                          <button
                            aria-label={`menos 10 g de ${item.name}`}
                            onClick={() => setItems(items.map((x, j) => (j === i ? stepItem(x, -10) : x)))}
                            className="h-9 w-9 rounded-lg text-dim"
                          >
                            −
                          </button>
                          <button
                            aria-label={`mais 10 g de ${item.name}`}
                            onClick={() => setItems(items.map((x, j) => (j === i ? stepItem(x, 10) : x)))}
                            className="h-9 w-9 rounded-lg text-dim"
                          >
                            +
                          </button>
                        </>
                      )}
                      <button
                        aria-label={`Tirar ${item.name}`}
                        onClick={() => {
                          const next = items.filter((_, j) => j !== i)
                          setItems(next.length ? next : null)
                        }}
                        className="h-9 w-9 rounded-lg text-dim"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[14px] tabular-nums">
                  <span className="font-semibold">{fmtKcal(totals.kcal)} kcal</span>
                  <span className="text-dim">
                    {' '}
                    · Proteína {fmtInt(totals.protein)} g · Hidratos {fmtInt(totals.carbs)} g · Gordura{' '}
                    {fmtInt(totals.fat)} g
                  </span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <p className="label">Refeição habitual</p>
              <div className="flex flex-wrap gap-2">
                {SLOTS.map((s) => (
                  <button
                    key={s}
                    aria-pressed={slot === s}
                    onClick={() => setSlot(slot === s ? null : s)}
                    className={chip(slot === s)}
                  >
                    {SLOT_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
