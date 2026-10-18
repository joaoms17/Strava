import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import MealHistoryList, { type HistoryMeal } from '../MealHistoryList'
import ItemList from '../ItemList'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton, runBusy } from '../../lib/busy'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { getApi, postApi } from '../../lib/api'
import { nutritionalDay } from '../../lib/day'
import { fmtInt, fmtKcal } from '../../lib/format'
import { mealName, mealSlot } from '../../lib/repetir'
import { deleteFavorite, favoriteFromMeal, insertFavorite, uploadFavoritePhoto } from '../../lib/favorites'
import { favoriteName, scaleItems } from '../../../api/_lib/rules/favoritos'
import { MAX_DOSES } from '../../../api/_lib/rules/receita'
import { addOption } from '../../../api/_lib/rules/dieta'
import { peekDietDraft, saveDietDraft } from '../../lib/diets'
import { mealTotals } from '../../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL } from '../../../api/_lib/rules/momentos'
import { chip } from '../ui/Chips'
import type { MealItem, Slot } from '../../lib/types'

type Mode = 'escrever' | 'receita' | 'refeicao'
const MODES: Mode[] = ['escrever', 'receita', 'refeicao']

// Uma receita lida: os itens da receita toda e em quantas doses se divide.
interface Recipe {
  items: MealItem[]
  doses: number
  dosesKnown: boolean
}

// Nova refeição favorita: escrever o que leva (e juntar a foto que vai
// aparecer sempre que a usares), importar uma receita (link ou texto, a
// conta da receita toda dividida pelas doses; também para a outra pessoa)
// ou escolher uma refeição já registada.
export default function NewFavoriteSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const asked = sheet.params.get('modo') as Mode | null
  const [mode, setMode] = useState<Mode>(asked && MODES.includes(asked) ? asked : 'escrever')
  const [favId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [uploaded, setUploaded] = useState<string | null>(null)
  const initialSlot = sheet.params.get('momento') as Slot | null
  const [slot, setSlot] = useState<Slot | null>(initialSlot && SLOTS.includes(initialSlot) ? initialSlot : null)
  const [items, setItems] = useState<MealItem[] | null>(null)
  const [source, setSource] = useState('')
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  // As outras pessoas da casa: a receita fica também nas favoritas delas.
  const [people, setPeople] = useState<{ user_id: string; name: string }[]>([])
  const [alsoFor, setAlsoFor] = useState<string[]>([])

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url)
  }, [photo])

  useEffect(() => {
    if (mode !== 'receita' || people.length) return
    let alive = true
    getApi<{ people: { user_id: string; name: string }[] }>('/api/meal/people')
      .then((r) => {
        if (!alive) return
        setPeople(r.people)
        setAlsoFor(r.people.map((p) => p.user_id))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mode, people.length])

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
    if (!text.trim() && !photo) return
    try {
      // Com texto contam as palavras (mais exatas); só com foto, a IA olha para
      // a foto (com o nome como descrição). As mesmas contas das refeições.
      const estimated = await postApi<{ items: MealItem[]; title: string }>(
        '/api/meal/estimate',
        text.trim() ? { text: text.trim() } : { text: name.trim() || undefined, photo_path: (await photoPath()) ?? undefined },
      )
      if (estimated.items.length === 0) toast('Não percebi o que leva. Escreve os alimentos e as quantidades.')
      setItems(estimated.items.length ? estimated.items : null)
      if (estimated.items.length && !name.trim() && estimated.title) setName(estimated.title.slice(0, 60))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui calcular. Tenta outra vez.')
    }
  }

  async function save() {
    if (!items) return
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
    }
  }

  // Um link (https://…) ou o texto da receita colado.
  async function readRecipe() {
    const input = source.trim()
    if (!input) return
    // Partilhar a partir de outra app cola muitas vezes «Vê esta receita https://…»:
    // com um só link e pouco texto à volta, conta o link.
    const links = input.match(/https?:\/\/\S+/gi) ?? []
    const link = links.length === 1 && input.length - links[0]!.length < 120 ? links[0]! : null
    try {
      const result = await postApi<{ title: string; doses: number | null; items: MealItem[] }>(
        '/api/meal/recipe',
        link ? { url: link } : { text: input },
      )
      setRecipe({ items: result.items, doses: result.doses ?? 4, dosesKnown: result.doses != null })
      if (!name.trim() && result.title) setName(result.title.slice(0, 60))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui ler a receita. Tenta outra vez.')
    }
  }

  // Guarda uma dose (a favorita regista-se depois com ½ · 1 · 1½ · 2).
  async function saveRecipe() {
    if (!recipe) return
    const perDose = scaleItems(recipe.items, 1 / recipe.doses)
    try {
      const path = await photoPath()
      const finalName = name.trim() || favoriteName(perDose)
      await insertFavorite({ id: favId, name: finalName, items: perDose, slot, photoPath: path })
      const copies: { id: string; to: string; userId: string }[] = []
      for (const userId of alsoFor) {
        // A cópia é um extra: se falhar, a favorita desta pessoa já ficou.
        const copy = await postApi<{ id: string; to: string }>('/api/meal/favorite-copy', {
          favorite_id: favId,
          to_user_id: userId,
        }).catch(() => null)
        if (copy) copies.push({ ...copy, userId })
      }
      emitDataChanged()
      const done = `Guardada nas favoritas · ${finalName}${copies.length ? ` (também para ${copies.map((c) => c.to).join(' e ')})` : ''}`
      if (backToDiet(favId)) {
        toast(done)
        return
      }
      sheet.close()
      toast(done, [
        {
          label: 'Anular',
          run: async () => {
            // As cópias primeiro: o servidor confirma que vêm desta favorita.
            for (const c of copies) {
              await postApi('/api/meal/favorite-copy', { favorite_id: favId, to_user_id: c.userId, undo_id: c.id }).catch(
                () => null,
              )
            }
            await deleteFavorite(favId, path)
            emitDataChanged()
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar.')
    }
  }

  async function fromMeal(meal: HistoryMeal) {
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
    }
  }

  const field =
    'w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none'
  const big =
    'min-h-14 w-full rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40'
  const segment = (m: Mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`min-h-10 rounded-lg ${mode === m ? 'bg-surface font-semibold' : 'text-dim'}`}
    >
      {label}
    </button>
  )
  const perDose = recipe ? mealTotals(scaleItems(recipe.items, 1 / recipe.doses)) : null

  let footer = null
  if (mode === 'escrever') {
    footer = items ? (
      <BusyButton busy="A guardar…" onClick={save} className={big}>
        Guardar favorita
      </BusyButton>
    ) : (
      <BusyButton busy="A calcular…" disabled={!text.trim() && !photo} onClick={calculate} className={big}>
        Calcular
      </BusyButton>
    )
  } else if (mode === 'receita') {
    footer = recipe ? (
      <BusyButton busy="A guardar…" onClick={saveRecipe} className={big}>
        Guardar · 1 dose
      </BusyButton>
    ) : (
      <BusyButton busy="A ler a receita…" disabled={!source.trim()} onClick={readRecipe} className={big}>
        Ler a receita
      </BusyButton>
    )
  }

  return (
    <BottomSheet title="Nova favorita" onClose={sheet.close} footer={footer ?? undefined}>
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-3 rounded-xl bg-surface2 p-1 text-[15px]">
          {segment('escrever', 'Escrever')}
          {segment('receita', 'Receita')}
          {segment('refeicao', 'De uma refeição')}
        </div>

        {mode === 'refeicao' ? (
          <>
            <p className="text-[14px] text-dim">Toca numa refeição que já registaste: fica nas favoritas com a foto dela.</p>
            <MealHistoryList
              today={today}
              onPick={(meal) => void runBusy('A guardar…', () => fromMeal(meal))}
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
                    if (mode === 'escrever' && !text.trim()) setItems(null)
                  }}
                />
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder={mode === 'receita' ? 'Nome (ex.: Arroz de pato)' : 'Nome (ex.: Papas de aveia)'}
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

            {mode === 'escrever' ? (
              <>
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
                    <ItemList items={items} onChange={setItems} onRemoveLast={() => setItems(null)} />
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
              </>
            ) : (
              <>
                <textarea
                  rows={4}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value)
                    setRecipe(null)
                  }}
                  placeholder="Cola o link da receita (https://…) ou o texto, com os ingredientes e as quantidades"
                  aria-label="Link ou texto da receita"
                  className={`${field} block resize-none py-3 text-[17px]`}
                />
                <p className="-mt-2 text-[13px] text-dim">
                  Pingo Doce, Continente, Teleculinária, blogs… A conta sai dos ingredientes da receita toda e
                  divide-se pelas doses.
                </p>

                {recipe && perDose && (
                  <div className="space-y-3">
                    <p className="label">A receita toda</p>
                    <ItemList
                      items={recipe.items}
                      onChange={(next) => setRecipe({ ...recipe, items: next })}
                      onRemoveLast={() => setRecipe(null)}
                    />
                    <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold">Doses</span>
                        {!recipe.dosesKnown && (
                          <span className="block text-[13px] text-attn">A receita não diz para quantos. Confirma.</span>
                        )}
                      </span>
                      <button
                        onClick={() => setRecipe({ ...recipe, doses: Math.max(1, recipe.doses - 1), dosesKnown: true })}
                        aria-label="Menos uma dose"
                        className="h-11 w-11 rounded-xl bg-surface2 text-[17px]"
                      >
                        −
                      </button>
                      <span className="num w-10 text-center text-[24px] tabular-nums">{recipe.doses}</span>
                      <button
                        onClick={() =>
                          setRecipe({ ...recipe, doses: Math.min(MAX_DOSES, recipe.doses + 1), dosesKnown: true })
                        }
                        aria-label="Mais uma dose"
                        className="h-11 w-11 rounded-xl bg-surface2 text-[17px]"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-[14px] tabular-nums">
                      <span className="text-dim">Por dose: </span>
                      <span className="font-semibold">{fmtKcal(perDose.kcal)} kcal</span>
                      <span className="text-dim">
                        {' '}
                        · Proteína {fmtInt(perDose.protein)} g · Hidratos {fmtInt(perDose.carbs)} g · Gordura{' '}
                        {fmtInt(perDose.fat)} g
                      </span>
                    </p>
                    {people.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {people.map((p) => (
                          <button
                            key={p.user_id}
                            aria-pressed={alsoFor.includes(p.user_id)}
                            onClick={() =>
                              setAlsoFor(
                                alsoFor.includes(p.user_id)
                                  ? alsoFor.filter((id) => id !== p.user_id)
                                  : [...alsoFor, p.user_id],
                              )
                            }
                            className={chip(alsoFor.includes(p.user_id))}
                          >
                            Também nas favoritas de {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
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
