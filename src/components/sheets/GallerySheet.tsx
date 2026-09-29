import { useEffect, useMemo, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { DayChips, SlotChips, TagChips, toggle } from '../ui/Chips'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { clearPendingGallery, peekPendingGallery } from '../../lib/capture'
import { enqueueCapture } from '../../lib/capture-queue'
import { exifDateTimeOf } from '../../lib/exif'
import { nutritionalDay } from '../../lib/day'
import { fmtDayShort, timeOf } from '../../lib/format'
import { groupPhotos, photoInstant } from '../../../api/_lib/rules/captura'
import { SLOT_LABEL, slotOf } from '../../../api/_lib/rules/momentos'
import type { Slot } from '../../lib/types'

interface Photo {
  id: string
  file: File
  url: string
  at: Date | null
}

interface GroupState {
  note: string
  tags: string[]
  date: string | null
  slot: Slot | null
}

// Fotos tiradas mais cedo: cada uma cai na refeição, hora e dia certos (EXIF).
// Fotos a 15 min umas das outras juntam-se; as sem hora pedem dia e momento.
export default function GallerySheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [fallbackDate, setFallbackDate] = useState<string | null>(null)
  const [split, setSplit] = useState<Set<string>>(new Set())
  const [groupsState, setGroupsState] = useState<Record<string, GroupState>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const pending = peekPendingGallery()
    if (!pending) {
      setPhotos([])
      return
    }
    setFallbackDate(pending.date)
    let alive = true
    void (async () => {
      const now = new Date()
      const result: Photo[] = []
      // Uma de cada vez: só se lê o início de cada ficheiro (EXIF).
      for (const file of pending.files.slice(0, 12)) {
        const exif = await exifDateTimeOf(file)
        result.push({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
          at: photoInstant({ exif, lastModified: file.lastModified || null, now }),
        })
      }
      if (alive) setPhotos(result)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(
    () => () => {
      for (const photo of photos ?? []) URL.revokeObjectURL(photo.url)
    },
    [photos],
  )

  const groups = useMemo(() => {
    if (!photos) return []
    const base = groupPhotos(photos)
    // «Separar» parte um grupo em fotos soltas.
    return base.flatMap((group) => (group.length > 1 && split.has(group[0]!.id) ? group.map((p) => [p]) : [group]))
  }, [photos, split])

  const stateOf = (key: string): GroupState =>
    groupsState[key] ?? { note: '', tags: [], date: fallbackDate, slot: null }
  const patch = (key: string, value: Partial<GroupState>) =>
    setGroupsState((prev) => ({ ...prev, [key]: { ...stateOf(key), ...value } }))

  const missingWhen = groups.some((group) => {
    if (group[0]!.at) return false
    const state = stateOf(group[0]!.id)
    return !state.date || !state.slot
  })

  async function analyse() {
    setBusy(true)
    try {
      for (const group of groups) {
        const key = group[0]!.id
        const state = stateOf(key)
        const at = group[0]!.at
        await enqueueCapture({
          files: group.map((p) => p.file),
          text: null,
          note: state.note.trim() || null,
          tags: state.tags,
          taken_at: at ? at.toISOString() : null,
          date: at ? null : state.date,
          slot: at ? slotOf(at) : state.slot,
        })
      }
      clearPendingGallery()
      sheet.close()
      toast(`${groups.length} ${groups.length === 1 ? 'refeição' : 'refeições'} a analisar. Podes continuar.`)
    } catch {
      toast('Não consegui guardar as fotos. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  if (photos == null) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A ler as fotos…</p>
      </BottomSheet>
    )
  }
  if (photos.length === 0) {
    return (
      <BottomSheet title="Fotos da galeria" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Escolhe as fotos outra vez no botão (+) › Galeria.</p>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet
      title={`${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'} → ${groups.length} ${groups.length === 1 ? 'refeição' : 'refeições'}`}
      onClose={sheet.close}
      footer={
        <button
          disabled={busy || missingWhen}
          onClick={() => void analyse()}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          {missingWhen ? 'Diz quando foi cada foto sem hora' : `Analisar (${groups.length})`}
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        {groups.map((group) => {
          const key = group[0]!.id
          const state = stateOf(key)
          const at = group[0]!.at
          const day = at ? nutritionalDay(at, profile.nutrition_day_cutoff_hour) : null
          return (
            <section key={key} className="space-y-3 rounded-2xl bg-surface2 p-3">
              <div className="flex gap-2 overflow-x-auto">
                {group.map((photo) => (
                  <img key={photo.id} src={photo.url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                ))}
              </div>
              {at ? (
                <p className="text-[15px]">
                  {SLOT_LABEL[slotOf(at)]} · <span className="tabular-nums">{timeOf(at.toISOString())}</span>
                  {day !== today && <span className="text-dim"> · {fmtDayShort(day!)}</span>}
                  {group.length > 1 && (
                    <button
                      onClick={() => setSplit((prev) => new Set(prev).add(key))}
                      className="ml-3 text-[13px] text-eat"
                    >
                      Separar
                    </button>
                  )}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-[15px] font-semibold">Quando foi?</p>
                  <DayChips today={today} value={state.date} onChange={(date) => patch(key, { date })} />
                  <SlotChips value={state.slot} onChange={(slot) => patch(key, { slot: slot as Slot })} />
                </div>
              )}
              <TagChips value={state.tags} onToggle={(tag) => patch(key, { tags: toggle(state.tags, tag) })} />
              <input
                value={state.note}
                onChange={(e) => patch(key, { note: e.target.value })}
                placeholder="Nota (ex.: comi metade, com azeite)"
                enterKeyHint="done"
                className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[15px] placeholder:text-dim focus:border-eat focus:outline-none"
              />
            </section>
          )
        })}
      </div>
    </BottomSheet>
  )
}
