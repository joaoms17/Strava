import { useEffect, useMemo, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import Thumb from '../ui/Thumb'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { useSignedUrls } from '../../lib/photos'
import { fmtInt, fmtKcal } from '../../lib/format'
import { archiveDiet, clearDietDraft, loadDiet, peekDietDraft, saveDiet, saveDietDraft } from '../../lib/diets'
import {
  DIET_MAX_OPTIONS,
  addOption,
  cleanDietMeals,
  dietTotals,
  makeHabitual,
  removeOption,
  type DietMeals,
} from '../../../api/_lib/rules/dieta'
import { SLOTS, SLOT_LABEL, type Slot } from '../../../api/_lib/rules/momentos'
import type { Favorite } from '../../lib/types'

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// A dieta: para cada refeição do dia, as favoritas que comes (a primeira é a
// habitual, as outras são alternativas). Mostra o total do dia contra o plano.
export default function DietSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const profile = useReadyProfile()
  const id = sheet.params.get('id')
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('A minha dieta')
  const [meals, setMeals] = useState<DietMeals>({})
  const [active, setActive] = useState(true)
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [picking, setPicking] = useState<Slot | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const urls = useSignedUrls(favorites.map((f) => f.photo_path))

  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase.from('favorites').select('*').eq('kind', 'meal').eq('archived', false)
      const favs = (data ?? []) as Favorite[]
      const known = new Set(favs.map((f) => f.id))
      // Voltar de «Nova favorita»: o rascunho tem o que estava a ser feito.
      const draft = peekDietDraft()
      if (draft && draft.id === id) {
        clearDietDraft()
        if (!alive) return
        setName(draft.name)
        setMeals(cleanDietMeals(draft.meals, known))
        setActive(draft.active)
        setPicking((SLOTS as string[]).includes(draft.slot ?? '') ? (draft.slot as Slot) : null)
      } else if (id) {
        const diet = await loadDiet(id)
        if (!alive) return
        if (diet) {
          setName(diet.name)
          setMeals(cleanDietMeals(diet.meals, known))
          setActive(diet.active)
        }
      }
      if (!alive) return
      setFavorites(favs)
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [id])

  const byId = useMemo(() => new Map(favorites.map((f) => [f.id, f])), [favorites])
  const totals = dietTotals(meals, byId)
  const hasMeals = totals.meals > 0
  const kcalDiff = totals.kcal - profile.base_kcal

  async function save() {
    if (!hasMeals || busy) return
    setBusy(true)
    try {
      await saveDiet({ id, name, meals, active })
      emitDataChanged()
      sheet.close()
      toast(active ? `«${name.trim() || 'A minha dieta'}» guardada e a seguir.` : 'Dieta guardada.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar a dieta.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!id) return
    try {
      await archiveDiet(id)
      emitDataChanged()
      sheet.close()
      toast('Dieta apagada.', [
        {
          label: 'Anular',
          run: async () => {
            await archiveDiet(id, false)
            emitDataChanged()
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui apagar.')
    }
  }

  function newFavorite(slot: Slot) {
    saveDietDraft({ id, name, meals, active, slot })
    sheet.open('nova-favorita', { momento: slot, voltar: 'dieta' })
  }

  const candidates = (slot: Slot) => {
    const chosen = meals[slot] ?? []
    const q = fold(query.trim())
    return favorites
      .filter((f) => !chosen.includes(f.id) && (!q || fold(f.name).includes(q)))
      .sort(
        (a, b) =>
          Number(b.default_slot === slot) - Number(a.default_slot === slot) ||
          b.use_count - a.use_count ||
          a.name.localeCompare(b.name, 'pt'),
      )
  }

  return (
    <BottomSheet
      title={id ? 'Editar dieta' : 'Nova dieta'}
      onClose={sheet.close}
      footer={
        <div className="space-y-2">
          <p className="text-center text-[14px] tabular-nums">
            {hasMeals ? (
              <>
                <span className="font-semibold">{fmtKcal(totals.kcal)} kcal</span> · {fmtInt(totals.protein)} g proteína
                <span className="text-dim">
                  {' '}
                  · plano {fmtKcal(profile.base_kcal)} kcal ({kcalDiff > 0 ? '+' : kcalDiff < 0 ? '−' : ''}
                  {fmtKcal(Math.abs(kcalDiff))})
                </span>
              </>
            ) : (
              <span className="text-dim">Junta pelo menos uma favorita a uma refeição.</span>
            )}
          </p>
          <button
            disabled={!loaded || !hasMeals || busy}
            onClick={() => void save()}
            className="min-h-14 w-full rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40"
          >
            {busy ? 'A guardar…' : 'Guardar dieta'}
          </button>
        </div>
      }
    >
      {!loaded ? (
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      ) : (
        <div className="space-y-5 pb-2">
          <label className="block space-y-1">
            <span className="label">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="ex.: Dia de treino"
              className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
            />
          </label>

          {favorites.length === 0 && (
            <p className="rounded-xl bg-surface2 px-3 py-3 text-[14px] text-dim">
              Ainda não tens favoritas. Cria a primeira em «＋ Nova favorita» numa das refeições abaixo.
            </p>
          )}

          {SLOTS.map((slot) => {
            const options = meals[slot] ?? []
            const habitual = options[0] ? byId.get(options[0]) : null
            return (
              <section key={slot} className="space-y-2" aria-label={SLOT_LABEL[slot]}>
                <div className="flex items-baseline justify-between">
                  <h3 className="label">{SLOT_LABEL[slot]}</h3>
                  {habitual && <span className="text-[13px] text-dim tabular-nums">{fmtKcal(habitual.kcal)} kcal</span>}
                </div>
                {options.map((favId, i) => {
                  const fav = byId.get(favId)
                  if (!fav) return null
                  return (
                    <div key={favId} className="flex items-center gap-3 rounded-xl border border-line p-2">
                      <Thumb url={fav.photo_path ? urls[fav.photo_path] : null} size={48} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]">{fav.name}</span>
                        <span className="block text-[13px] text-dim tabular-nums">
                          {i === 0 ? 'habitual' : 'alternativa'} · {fmtKcal(fav.kcal)} kcal · {fmtInt(Number(fav.protein))} g
                        </span>
                      </span>
                      {i > 0 && (
                        <button
                          onClick={() => setMeals(makeHabitual(meals, slot, favId))}
                          className="min-h-9 shrink-0 rounded-lg px-2 text-[13px] text-eat"
                        >
                          Habitual
                        </button>
                      )}
                      <button
                        onClick={() => setMeals(removeOption(meals, slot, favId))}
                        aria-label={`Tirar ${fav.name} de ${SLOT_LABEL[slot]}`}
                        className="h-9 w-9 shrink-0 rounded-lg text-dim"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  )
                })}
                {picking === slot ? (
                  <div className="space-y-2 rounded-xl border border-line bg-surface p-2">
                    {favorites.length > 6 && (
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Procurar favorita"
                        aria-label="Procurar favorita"
                        className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
                      />
                    )}
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {candidates(slot).map((fav) => (
                        <button
                          key={fav.id}
                          onClick={() => {
                            setMeals(addOption(meals, slot, fav.id))
                            setQuery('')
                          }}
                          className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left active:bg-surface2"
                        >
                          <Thumb url={fav.photo_path ? urls[fav.photo_path] : null} size={40} />
                          <span className="min-w-0 flex-1 truncate text-[15px]">{fav.name}</span>
                          <span className="shrink-0 text-[13px] text-dim tabular-nums">{fmtKcal(fav.kcal)} kcal</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between">
                      <button onClick={() => newFavorite(slot)} className="min-h-10 px-1 text-[15px] text-eat">
                        ＋ Nova favorita
                      </button>
                      <button onClick={() => setPicking(null)} className="min-h-10 px-1 text-[15px] text-dim">
                        Fechar
                      </button>
                    </div>
                  </div>
                ) : (
                  options.length < DIET_MAX_OPTIONS && (
                    <button
                      onClick={() => {
                        setQuery('')
                        if (favorites.length === 0) newFavorite(slot)
                        else setPicking(slot)
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[15px] text-dim"
                    >
                      <Icon name="plus" size={16} /> {options.length ? 'Alternativa' : 'Juntar favorita'}
                    </button>
                  )
                )}
              </section>
            )
          })}

          <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-surface2 px-3">
            <span className="text-[15px]">
              Seguir esta dieta
              <span className="block text-[13px] text-dim">Aparece no Hoje e no ＋ (só uma de cada vez).</span>
            </span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-6 w-6 accent-[var(--color-eat)]"
            />
          </label>

          {id && (
            <button onClick={() => void remove()} className="min-h-11 w-full text-[15px] text-pain">
              Apagar esta dieta
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
