import { useEffect, useRef, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { DayChips, SlotChips, TagChips, toggle } from '../ui/Chips'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { enqueueCapture } from '../../lib/capture-queue'
import { exifDateTimeOf } from '../../lib/exif'
import { nutritionalDay } from '../../lib/day'
import { photoInstant } from '../../../api/_lib/rules/captura'
import Icon from '../ui/Icon'
import type { Slot } from '../../lib/types'

// Escrever ou ditar (microfone do teclado), com foto opcional: texto e foto
// seguem juntos numa só análise. Envia e fecha; a conta chega sozinha.
export default function WriteSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const initialDate = sheet.params.get('data')
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today)
  const [slot, setSlot] = useState<Slot | 'agora'>(initialDate && initialDate < today ? 'almoco' : 'agora')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const isPast = date !== today
  const effectiveSlot = isPast && slot === 'agora' ? 'almoco' : slot

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url)
  }, [photo])

  async function send() {
    if (!text.trim() && !photo) return
    setBusy(true)
    try {
      const now = new Date()
      let takenAt: string | null = null
      if (effectiveSlot === 'agora') {
        const exif = photo ? await exifDateTimeOf(photo.file) : null
        takenAt = (photoInstant({ exif, lastModified: null, now }) ?? now).toISOString()
      }
      await enqueueCapture({
        files: photo ? [photo.file] : [],
        text: text.trim() || null,
        note: null,
        tags,
        taken_at: takenAt,
        date: effectiveSlot === 'agora' ? null : date,
        slot: effectiveSlot === 'agora' ? null : effectiveSlot,
      })
      sheet.close()
    } catch {
      toast('Não consegui guardar. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title="Escrever ou ditar"
      onClose={sheet.close}
      footer={
        <button
          disabled={busy || (!text.trim() && !photo)}
          onClick={() => void send()}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          Enviar
        </button>
      }
    >
      <div className="space-y-4 pb-2">
        <textarea
          rows={4}
          autoFocus
          enterKeyHint="done"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: 2 ovos mexidos, 1 torrada, café com leite"
          className="w-full rounded-2xl border border-line bg-bg px-4 py-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
        />
        <p className="-mt-2 text-[13px] text-dim">Para ditar, toca no microfone do teclado.</p>

        <div className="flex items-center gap-3">
          {photo ? (
            <>
              <img src={photo.url} alt="" className="h-16 w-16 rounded-xl object-cover" />
              <button onClick={() => setPhoto(null)} className="text-[15px] text-dim">
                Tirar foto
              </button>
            </>
          ) : (
            <button onClick={() => fileInput.current?.click()} className="min-h-11 rounded-xl bg-surface2 px-3 text-[15px]">
              <Icon name="camera" size={18} className="mr-1 inline" /> Juntar foto
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) setPhoto({ file, url: URL.createObjectURL(file) })
            }}
          />
        </div>

        <TagChips value={tags} onToggle={(tag) => setTags(toggle(tags, tag))} />
        <DayChips today={today} value={date} onChange={setDate} />
        <SlotChips value={effectiveSlot} onChange={setSlot} allowNow={!isPast} />

        <div className="flex gap-4 text-[15px]">
          <button onClick={() => sheet.open('barras', isPast ? { data: date } : {})} className="text-eat">
            Código de barras
          </button>
          <button onClick={() => sheet.open('numeros', isPast ? { data: date } : {})} className="text-eat">
            Só números
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
