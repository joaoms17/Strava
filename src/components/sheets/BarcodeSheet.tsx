import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import BarcodeScanner from '../BarcodeScanner'
import { ApiError, getApi, postApi } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton, BusyLabel, busyContent, runBusy, useBusyKey } from '../../lib/busy'
import { useClientId } from '../../lib/client-id'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { nutritionalDay } from '../../lib/day'
import { fmtInt } from '../../lib/format'
import { prepareMenuPhoto } from '../../lib/image'
import { foodExtrasText } from '../../lib/food-extras'
import { dayLabel, whenFromParams } from '../../lib/when'
import { mealName, mealSlot } from '../../lib/repetir'
import { round1 } from '../../../api/_lib/rules/meal-totals'
import { SLOT_LABEL, SLOT_TIME, loggedAtFor, slotOf } from '../../../api/_lib/rules/momentos'
import type { OffHit } from '../../../api/_lib/rules/off'
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
// escolhida aqui entre as desse dia). Também se procura pelo nome, e um
// produto que o Open Food Facts não tem lê-se pela foto do rótulo (fica
// ligado ao código para a próxima vez, também para a outra pessoa).
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
  // O código que o Open Food Facts não tem (ou sem tabela): «Fotografar o rótulo».
  const [missing, setMissing] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OffHit[] | null>(null)
  const [searchBusyKey, searchBusy] = useBusyKey()
  const [labelKey, labelBusy] = useBusyKey()
  // Tocar outra vez depois de uma falha de rede não grava a dobrar; outros
  // produtos (ou outro dia) são outro registo.
  const clientIdFor = useClientId()
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
    setMissing(null)
    try {
      const { food: found } = await getApi<{ food: Food }>(`/api/food/barcode/${ean}`)
      showFood(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não encontrei este código.')
      if (err instanceof ApiError && (err.status === 404 || err.status === 422)) setMissing(ean)
    }
  }

  function showFood(found: Food) {
    setFood(found)
    setGrams(Number(found.default_portion_g) || 100)
    setSearching(false)
    setResults(null)
  }

  // Só ao carregar em «Procurar» (o Open Food Facts limita as pesquisas).
  async function search() {
    const q = query.trim()
    if (q.length < 3) return
    try {
      const { results: found } = await getApi<{ results: OffHit[] }>(`/api/meal/food-search?q=${encodeURIComponent(q)}`)
      setResults(found)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui procurar. Tenta outra vez.')
    }
  }

  // O produto não está no Open Food Facts: a IA lê a tabela do rótulo e o
  // alimento fica com este código.
  async function readLabel(file: File) {
    const ean = missing
    if (!ean) return
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada. Volta a entrar.')
      const path = `${user.id}/rotulo/${ean}-${Date.now().toString(36)}.jpg`
      const { error: upload } = await supabase.storage
        .from('meal-photos')
        .upload(path, await prepareMenuPhoto(file), { contentType: 'image/jpeg', upsert: true })
      if (upload) throw new Error('Não consegui enviar a foto. Tenta outra vez.')
      const { food: read } = await postApi<{ food: Food }>('/api/meal/label', { ean, photo_path: path })
      setError(null)
      setMissing(null)
      showFood(read)
      toast('Li o rótulo. Da próxima vez este código já é conhecido.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui ler o rótulo.')
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
    const now = new Date()
    const slot = when.slot && when.slot !== 'agora' ? when.slot : null
    const loggedAt =
      date === today && !slot
        ? now
        : loggedAtFor(date, SLOT_TIME[slot ?? slotOf(now)], profile.nutrition_day_cutoff_hour, now)
    try {
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/save', {
        client_id: clientIdFor({ items, date, slot }),
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
    }
  }

  // Junta os produtos aos itens de uma refeição já registada.
  async function addTo(meal: Target) {
    if (items.length === 0) return
    if (meal.status === 'a_analisar') {
      toast('Essa refeição ainda está a ser analisada. Espera um pouco.')
      return
    }
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
    }
  }

  if (scanning) {
    return (
      <BarcodeScanner
        onDetect={(ean) => void runBusy('A procurar o produto…', () => lookup(ean))}
        onClose={() => (basket.length > 0 ? setScanning(false) : sheet.close())}
        onSearch={() => {
          setScanning(false)
          setError(null)
          setMissing(null)
          setSearching(true)
        }}
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
          <BusyButton busy="A guardar…" onClick={() => (target ? addTo(target) : saveNew())} className={primary}>
            {`${target ? 'Juntar' : 'Guardar'}${items.length > 1 ? ` ${items.length} produtos` : ''} · ${fmtInt(kcal)} kcal`}
          </BusyButton>
        ) : undefined
      }
    >
      <div className="space-y-4 pb-2">
        {target && <p className="truncate text-[15px] text-dim">A juntar a: {describe(target)}</p>}

        {error && (
          <div className="space-y-3">
            <p className="text-[15px]">{error}</p>
            {missing && (
              <>
                <p className="text-[15px] text-dim">
                  Tira uma foto à tabela nutricional: a IA lê os valores e o código fica conhecido para a próxima vez.
                </p>
                <label
                  className={`flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-eat text-[16px] font-semibold text-bg ${labelBusy ? 'pointer-events-none' : ''}`}
                  aria-busy={labelBusy || undefined}
                >
                  {labelBusy ? <BusyLabel text="A ler o rótulo…" /> : 'Fotografar o rótulo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={labelBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void runBusy('A ler o rótulo…', () => readLabel(file), labelKey)
                    }}
                  />
                </label>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setScanning(true)} className="min-h-12 rounded-xl bg-surface2 text-[15px]">
                Ler outra vez
              </button>
              <button
                onClick={() => {
                  setError(null)
                  setMissing(null)
                  setSearching(true)
                }}
                className="min-h-12 rounded-xl bg-surface2 text-[15px]"
              >
                Procurar pelo nome
              </button>
            </div>
          </div>
        )}

        {searching && !food && !error && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={80}
                enterKeyHint="search"
                aria-label="Nome do produto"
                placeholder="Ex.: iogurte proteico Pingo Doce"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && query.trim().length >= 3) {
                    e.preventDefault()
                    void runBusy('A procurar…', search, searchBusyKey)
                  }
                }}
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
              />
              <button
                disabled={searchBusy || query.trim().length < 3}
                aria-busy={searchBusy || undefined}
                onClick={() => void runBusy('A procurar…', search, searchBusyKey)}
                className="min-h-12 shrink-0 rounded-xl bg-eat px-4 font-semibold text-bg disabled:opacity-40"
              >
                {busyContent(searchBusy, 'A procurar…', 'Procurar')}
              </button>
            </div>
            {results &&
              (results.length === 0 ? (
                <p className="text-[15px] text-dim">Não encontrei nada com esse nome. Tenta outras palavras ou lê o código.</p>
              ) : (
                <ul className="divide-y divide-line rounded-2xl bg-surface2" aria-label="Produtos encontrados">
                  {results.map((r) => (
                    <li key={r.code}>
                      <BusyButton
                        busy="A abrir…"
                        onClick={() => lookup(r.code)}
                        className="flex min-h-12 w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left"
                      >
                        <span className="min-w-0 flex-1 text-[15px]">{r.name}</span>
                        <span className="shrink-0 text-[13px] text-dim tabular-nums">
                          {r.kcal_100g != null ? `${fmtInt(r.kcal_100g)} kcal/100 g` : 'sem valores'}
                        </span>
                      </BusyButton>
                    </li>
                  ))}
                </ul>
              ))}
            <button onClick={() => setScanning(true)} className="min-h-10 text-[15px] text-eat">
              Ler o código
            </button>
            <p className="text-[12px] text-dim">Dados: Open Food Facts (ODbL)</p>
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
            {foodExtrasText(food, grams) && (
              <p className="text-[13px] text-dim tabular-nums">{foodExtrasText(food, grams)}</p>
            )}
            {food.serving_label && <p className="text-[13px] text-dim">Dose do rótulo: {food.serving_label}</p>}
            {food.source === 'off' && <p className="text-[12px] text-dim">Dados: Open Food Facts (ODbL)</p>}
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
                    <BusyButton
                      busy="A juntar…"
                      onClick={() => addTo(m)}
                      className="min-h-12 w-full truncate rounded-xl border border-line px-3 text-left text-[15px]"
                    >
                      {describe(m)}
                    </BusyButton>
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
