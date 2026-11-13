import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { TagChips, toggle } from '../ui/Chips'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { BusyButton } from '../../lib/busy'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { timeOf } from '../../lib/format'
import { diffText } from '../../lib/meal-diff'
import type { Meal, MealItem } from '../../lib/types'

// «Uma ou outra coisa escrita» sobre uma foto já enviada, a qualquer momento.
export default function NoteSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const id = sheet.params.get('id')
  const [meal, setMeal] = useState<Meal | null>(null)
  const [thumb, setThumb] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    if (!id) return
    void (async () => {
      const { data } = await supabase.from('meals').select('*').eq('id', id).maybeSingle()
      const row = (data ?? null) as Meal | null
      setMeal(row)
      setNote(row?.note ?? '')
      setTags(row?.tags ?? [])
      const path = row?.thumb_paths?.[0] ?? row?.photo_path
      if (path) setThumb((await signedUrls([path]))[path] ?? null)
    })()
  }, [id])

  async function save() {
    if (!meal) return
    try {
      const result = await postApi<{
        meal: Meal
        previous: { items: MealItem[]; note: string | null; tags: string[] | null }
        corrected?: boolean
      }>('/api/meal/update', { meal_id: meal.id, note: note.trim() || null, tags })
      emitDataChanged()
      sheet.close()
      // «Nota aplicada» só quando os números mudaram mesmo (M1); a analisar,
      // entra na análise (a escrita protegida vê a nota e as etiquetas).
      if (meal.status === 'a_analisar') toast('Nota guardada · entra na análise')
      else if (result.corrected) {
        const previous = result.previous
        toast(`Nota aplicada · ${diffText(previous.items, result.meal.items)}`, [
          {
            label: 'Anular',
            run: async () => {
              try {
                await postApi('/api/meal/update', {
                  meal_id: meal.id,
                  items: previous.items,
                  note: previous.note,
                  tags: previous.tags ?? [],
                  undo: true,
                })
                emitDataChanged()
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Não consegui anular.')
              }
            },
          },
        ])
      } else toast('Nota guardada')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar a nota.')
    }
  }

  return (
    <BottomSheet
      title="Nota"
      onClose={sheet.close}
      footer={
        <BusyButton
          busy="A guardar…"
          disabled={!meal}
          onClick={save}
          className="min-h-14 w-full rounded-2xl bg-eat text-[1.0625rem] font-semibold text-bg disabled:opacity-40"
        >
          Guardar
        </BusyButton>
      }
    >
      <div className="space-y-4 pb-2">
        {meal && (
          <div className="flex items-center gap-3">
            {thumb && <img loading="lazy" decoding="async" src={thumb} alt="" className="h-14 w-14 rounded-xl object-cover" />}
            <p className="text-[0.9375rem] text-dim tabular-nums">{timeOf(meal.logged_at)}</p>
          </div>
        )}
        <TagChips value={tags} onToggle={(tag) => setTags(toggle(tags, tag))} />
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: comi metade, com azeite"
          enterKeyHint="done"
          className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[1.0625rem] placeholder:text-dim focus:border-eat focus:outline-none"
        />
        {meal && (
          <p className="text-[0.8125rem] text-dim">
            {meal.status === 'a_analisar'
              ? 'Junto a nota e as etiquetas à análise.'
              : 'Vou corrigir a refeição com o que mudou na nota e nas etiquetas.'}
          </p>
        )}
      </div>
    </BottomSheet>
  )
}
