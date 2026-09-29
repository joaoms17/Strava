import { useEffect, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { TagChips, toggle } from '../ui/Chips'
import { supabase } from '../../lib/supabase'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { emitDataChanged } from '../../lib/events'
import { signedUrls } from '../../lib/photos'
import { timeOf } from '../../lib/format'
import type { Meal } from '../../lib/types'

// «Uma ou outra coisa escrita» sobre uma foto já enviada, a qualquer momento.
export default function NoteSheet() {
  const sheet = useSheet()
  const toast = useToast()
  const id = sheet.params.get('id')
  const [meal, setMeal] = useState<Meal | null>(null)
  const [thumb, setThumb] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
    try {
      await postApi('/api/meal/update', { meal_id: meal.id, note: note.trim() || null, tags })
      emitDataChanged()
      sheet.close()
      toast(meal.status === 'a_analisar' ? 'Nota guardada · entra na análise' : 'Nota aplicada')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar a nota.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title="Nota"
      onClose={sheet.close}
      footer={
        <button
          disabled={busy || !meal}
          onClick={() => void save()}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          {busy ? 'A guardar…' : 'Guardar'}
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        {meal && (
          <div className="flex items-center gap-3">
            {thumb && <img src={thumb} alt="" className="h-14 w-14 rounded-xl object-cover" />}
            <p className="text-[15px] text-dim tabular-nums">{timeOf(meal.logged_at)}</p>
          </div>
        )}
        <TagChips value={tags} onToggle={(tag) => setTags(toggle(tags, tag))} />
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: comi metade, com azeite"
          enterKeyHint="done"
          className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
        />
        {meal && (
          <p className="text-[13px] text-dim">
            {meal.status === 'a_analisar' ? 'Junto a nota à análise.' : 'Vou corrigir a refeição com esta nota.'}
          </p>
        )}
      </div>
    </BottomSheet>
  )
}
