import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { emitDataChanged, useDataVersion } from '../lib/events'
import { signedUrls } from '../lib/photos'
import { fmtInt, fmtKcal } from '../lib/format'
import { logFavorite } from '../lib/meal-actions'
import { SLOTS, SLOT_LABEL } from '../../api/_lib/rules/momentos'
import type { Favorite, Food, Slot } from '../lib/types'
import Icon from '../components/ui/Icon'
import BottomSheet from '../components/ui/BottomSheet'
import { chip } from '../components/ui/Chips'
import { useSheet } from '../lib/sheet'

type Segment = 'refeicoes' | 'treinos' | 'alimentos'

// Tudo o que se repete: refeições favoritas (registar com 1 toque), treinos
// favoritos (a Bicicleta habitual) e a biblioteca de alimentos.
export default function Favoritos() {
  const toast = useToast()
  const version = useDataVersion()
  const [segment, setSegment] = useState<Segment>('refeicoes')
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)
  const [foods, setFoods] = useState<Food[]>([])
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Favorite | null>(null)
  const [editingFood, setEditingFood] = useState<Food | null>(null)
  const [workoutFavs, setWorkoutFavs] = useState<Favorite[]>([])
  const sheet = useSheet()
  const [, navigate] = useLocation()

  const load = useCallback(async () => {
    const [{ data: favRows }, { data: foodRows }, { data: workoutRows }] = await Promise.all([
      supabase
        .from('favorites')
        .select('*')
        .eq('kind', 'meal')
        .eq('archived', false)
        .order('use_count', { ascending: false }),
      supabase.from('foods').select('*').order('use_count', { ascending: false }).limit(300),
      supabase
        .from('favorites')
        .select('*')
        .eq('kind', 'workout')
        .eq('archived', false)
        .order('use_count', { ascending: false }),
    ])
    setWorkoutFavs((workoutRows ?? []) as Favorite[])
    const list = (favRows ?? []) as Favorite[]
    setFavorites(list)
    setFoods((foodRows ?? []) as Food[])
    setPhotos(await signedUrls(list.map((f) => f.photo_path).filter((p): p is string => !!p)))
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  async function archive(favorite: Favorite) {
    await supabase.from('favorites').update({ archived: true }).eq('id', favorite.id)
    setEditing(null)
    emitDataChanged()
    toast(`Arquivado · ${favorite.name}`, [
      {
        label: 'Anular',
        run: async () => {
          await supabase.from('favorites').update({ archived: false }).eq('id', favorite.id)
          emitDataChanged()
        },
      },
    ])
  }

  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-3 rounded-xl bg-surface2 p-1 text-[15px]">
        {(
          [
            ['refeicoes', 'Refeições'],
            ['treinos', 'Treinos'],
            ['alimentos', 'Alimentos'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSegment(id)}
            className={`min-h-10 rounded-lg ${segment === id ? 'bg-surface font-semibold' : 'text-dim'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {segment === 'refeicoes' &&
        (favorites == null ? (
          <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
        ) : favorites.length === 0 ? (
          <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
            Toca na ☆ de uma refeição para a guardares aqui. Depois registas com 1 toque.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {favorites.map((favorite) => {
              const photo = favorite.photo_path ? photos[favorite.photo_path] : null
              return (
                <div key={favorite.id} className="overflow-hidden rounded-2xl bg-surface">
                  <button onClick={() => void logFavorite(favorite, null, toast)} className="block w-full text-left">
                    {photo ? (
                      <img src={photo} alt="" className="h-28 w-full object-cover" />
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-surface2 text-3xl" aria-hidden>
                        <Icon name="plate" />
                      </div>
                    )}
                    <div className="space-y-0.5 px-3 pt-2">
                      <p className="line-clamp-2 text-[15px] leading-snug">{favorite.name}</p>
                      <p className="text-[13px] text-dim tabular-nums">
                        {fmtKcal(favorite.kcal)} kcal · {fmtInt(Number(favorite.protein))} g proteína
                      </p>
                    </div>
                  </button>
                  <div className="flex justify-end px-1 pb-1">
                    <button
                      onClick={() => setEditing(favorite)}
                      className="min-h-10 px-3 text-[17px] text-dim"
                      aria-label={`Opções de ${favorite.name}`}
                    >
                      ⋯
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

      {segment === 'treinos' && (
        <div className="space-y-2">
          <button
            onClick={() => sheet.open('meu-treino')}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[15px]"
          >
            <Icon name="plus" size={18} /> Novo treino
          </button>
          {workoutFavs.length === 0 && (
            <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
              Define os teus treinos (ginásio com os exercícios, corrida, padel…) para os registares com um toque.
            </p>
          )}
          {workoutFavs.map((favorite) => (
            <div key={favorite.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-burn text-bg">
                <Icon name={favorite.workout?.type === 'bike' ? 'bike' : favorite.workout?.type === 'strength' ? 'dumbbell' : 'walk'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{favorite.name}</span>
                <span className="block text-[14px] text-dim tabular-nums">
                  {favorite.workout?.type === 'strength'
                    ? `${favorite.workout.exercises?.length ?? 0} exercícios · `
                    : ''}
                  {favorite.workout?.minutes} min
                  {favorite.workout?.watts ? ` · ${favorite.workout.watts} W` : ''}
                  {favorite.kcal ? ` · +${fmtKcal(favorite.kcal)}` : ''}
                </span>
              </span>
              <button
                onClick={() =>
                  favorite.workout?.type === 'strength'
                    ? navigate(`/treino/ginasio?fav=${favorite.id}`)
                    : sheet.open('joelho', { fav: favorite.id })
                }
                className="min-h-10 rounded-xl bg-cta px-3 font-semibold text-on-cta"
              >
                Registar
              </button>
              <button
                onClick={() => sheet.open('meu-treino', { id: favorite.id })}
                className="min-h-10 px-2 text-[17px] text-dim"
                aria-label={`Editar ${favorite.name}`}
              >
                ⋯
              </button>
            </div>
          ))}
        </div>
      )}

      {segment === 'alimentos' && (
        <div className="space-y-2">
          <p className="text-[13px] text-dim">
            Os alimentos que a app aprendeu contigo, com a porção habitual. Entram nas contas das
            refeições por texto.
          </p>
          {foods.length === 0 && (
            <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
              Ainda sem alimentos. Aparecem quando registas refeições por texto ou por código de barras.
            </p>
          )}
          <ul className="divide-y divide-line rounded-2xl bg-surface">
            {foods.map((food) => (
              <li key={food.id}>
                <button
                  onClick={() => setEditingFood(food)}
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0 truncate text-[15px]">{food.name}</span>
                  <span className="shrink-0 text-[13px] text-dim tabular-nums">
                    {food.default_portion_g != null && `${fmtInt(Number(food.default_portion_g))} g · `}
                    {fmtInt(Number(food.kcal_100g))} kcal/100 g
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <EditFavorite favorite={editing} onClose={() => setEditing(null)} onArchive={() => void archive(editing)} />
      )}
      {editingFood && <EditFood food={editingFood} onClose={() => setEditingFood(null)} />}
    </div>
  )
}

function EditFavorite({
  favorite,
  onClose,
  onArchive,
}: {
  favorite: Favorite
  onClose: () => void
  onArchive: () => void
}) {
  const [name, setName] = useState(favorite.name)
  const [slot, setSlot] = useState<Slot | null>(favorite.default_slot)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    await supabase
      .from('favorites')
      .update({ name: name.trim() || favorite.name, default_slot: slot, updated_at: new Date().toISOString() })
      .eq('id', favorite.id)
    setBusy(false)
    emitDataChanged()
    onClose()
  }

  return (
    <BottomSheet
      title="Editar favorito"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button onClick={onArchive} className="min-h-14 rounded-2xl bg-surface2 text-[15px] text-dim">
            Arquivar
          </button>
          <button
            disabled={busy}
            onClick={() => void save()}
            className="min-h-14 rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <label className="block space-y-1">
          <span className="text-[13px] text-dim">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-bg px-3 focus:border-eat focus:outline-none"
          />
        </label>
        <div className="space-y-2">
          <p className="text-[13px] text-dim">Momento habitual</p>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((s) => (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`rounded-full px-3 py-1.5 text-[15px] ${s === slot ? 'bg-eat text-bg' : 'bg-surface2'}`}
              >
                {SLOT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-line rounded-2xl bg-surface2 text-[15px]">
          {favorite.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0 truncate">
                {item.name} <span className="text-dim">· {fmtInt(item.grams)} g</span>
              </span>
              <span className="shrink-0 text-dim tabular-nums">{fmtInt(item.kcal)} kcal</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-dim tabular-nums">
          {fmtKcal(favorite.kcal)} kcal · Proteína {fmtInt(Number(favorite.protein))} g · Hidratos{' '}
          {fmtInt(Number(favorite.carbs))} g · Gordura {fmtInt(Number(favorite.fat))} g
        </p>
      </div>
    </BottomSheet>
  )
}

function EditFood({ food, onClose }: { food: Food; onClose: () => void }) {
  const [name, setName] = useState(food.name)
  const [portion, setPortion] = useState(food.default_portion_g != null ? String(food.default_portion_g) : '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const grams = Number(portion.replace(',', '.'))
    await supabase
      .from('foods')
      .update({
        name: name.trim() || food.name,
        default_portion_g: Number.isFinite(grams) && grams > 0 ? grams : null,
      })
      .eq('id', food.id)
    setBusy(false)
    emitDataChanged()
    onClose()
  }

  async function remove() {
    setBusy(true)
    await supabase.from('foods').delete().eq('id', food.id)
    setBusy(false)
    emitDataChanged()
    onClose()
  }

  return (
    <BottomSheet
      title="Alimento"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button disabled={busy} onClick={() => void remove()} className="min-h-14 rounded-2xl bg-surface2 text-[15px] text-pain">
            Apagar
          </button>
          <button
            disabled={busy}
            onClick={() => void save()}
            className="min-h-14 rounded-2xl bg-eat font-semibold text-bg disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <label className="block space-y-1">
          <span className="text-[13px] text-dim">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-bg px-3 focus:border-eat focus:outline-none"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[13px] text-dim">Porção habitual (g)</span>
          <input
            inputMode="decimal"
            value={portion}
            onChange={(e) => setPortion(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-bg px-3 tabular-nums focus:border-eat focus:outline-none"
          />
        </label>
        <p className="text-[13px] text-dim tabular-nums">
          Por 100 g: {fmtInt(Number(food.kcal_100g))} kcal · Proteína {fmtInt(Number(food.protein_100g))} g ·
          Hidratos {fmtInt(Number(food.carbs_100g))} g · Gordura {fmtInt(Number(food.fat_100g))} g
        </p>
      </div>
    </BottomSheet>
  )
}

