import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import BottomSheet from '../ui/BottomSheet'
import PhotoButton from '../ui/PhotoButton'
import WhenPicker from '../ui/WhenPicker'
import Icon from '../ui/Icon'
import { TAG_LABEL, chip, toggle } from '../ui/Chips'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { localCalendarDate, nutritionalDay, shiftDate } from '../../lib/day'
import { fmtKcal } from '../../lib/format'
import { logFavorite, repeatMeal } from '../../lib/meal-actions'
import { enqueueCapture } from '../../lib/capture-queue'
import { exifDateTimeOf } from '../../lib/exif'
import { mealName, mealSlot } from '../../lib/repetir'
import {
  dayLabel,
  needsSlot,
  slotForRanking,
  whenApi,
  whenFromParams,
  whenLabel,
  whenParams,
  type When,
} from '../../lib/when'
import { rankFavorites } from '../../../api/_lib/rules/favoritos'
import { photoInstant } from '../../../api/_lib/rules/captura'
import { SLOT_LABEL, lisbonClock } from '../../../api/_lib/rules/momentos'
import type { Favorite, Meal } from '../../lib/types'

// Registar: tudo numa folha. Em cima o «Quando» (dia e refeição, com «Agora»
// por defeito), logo a seguir o campo para escrever o que comeste, depois as
// fotos, repetir uma refeição de qualquer dia e os favoritos. O que se
// escolhe no «Quando» vale para tudo o que se regista daqui.
export default function CaptureSheet({ focus = false }: { focus?: boolean }) {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const [location, navigate] = useLocation()
  const [now] = useState(() => new Date())
  const today = nutritionalDay(now, profile.nutrition_day_cutoff_hour)
  const viewing = /^\/hoje\/(\d{4}-\d{2}-\d{2})$/.exec(location)?.[1]
  const [when, setWhen] = useState<When>(() =>
    whenFromParams(sheet.params, today, viewing && viewing < today ? viewing : null),
  )
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [askSlot, setAskSlot] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)
  const [sameAsYesterday, setSameAsYesterday] = useState<Meal | null>(null)
  const [weighedToday, setWeighedToday] = useState(true)
  const textBox = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const refSlot = slotForRanking(when, now)
  const api = whenApi(when, today)
  const isNow = Object.keys(api).length === 0
  const hasContent = text.trim().length > 0 || photo != null

  useEffect(() => {
    if (focus) textBox.current?.focus()
  }, [focus])

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url)
  }, [photo])

  useEffect(() => {
    let alive = true
    void Promise.all([
      supabase.from('favorites').select('*').eq('kind', 'meal').eq('archived', false),
      supabase.from('weights').select('date').eq('date', localCalendarDate()),
    ]).then(([{ data: favRows }, { data: weights }]) => {
      if (!alive) return
      setFavorites((favRows ?? []) as Favorite[])
      setWeighedToday((weights ?? []).length > 0)
    })
    return () => {
      alive = false
    }
  }, [])

  // «Igual a ontem»: a mesma refeição no dia antes do escolhido.
  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('*')
      .eq('date', shiftDate(when.date, -1))
      .order('logged_at')
      .then(({ data }) => {
        if (!alive) return
        const meals = (data ?? []) as Meal[]
        setSameAsYesterday(meals.find((m) => mealSlot(m) === refSlot && m.items.length > 0) ?? null)
      })
    return () => {
      alive = false
    }
  }, [when.date, refSlot])

  const ranked = useMemo(() => rankFavorites(favorites ?? [], refSlot).slice(0, 6), [favorites, refSlot])
  const weighDot = !weighedToday && lisbonClock(now).hour < 11
  const label = whenLabel(when, today)

  // Num dia passado a refeição é obrigatória: assinala-a e não regista.
  function slotChosen(): boolean {
    if (!needsSlot(when)) return true
    setAskSlot(true)
    toast('Escolhe primeiro a refeição (pequeno-almoço, almoço…).')
    return false
  }

  function changeWhen(next: When) {
    setWhen(next)
    setAskSlot(false)
  }

  // Num dia que não está à vista, o aviso leva lá.
  function seeDay(): { label: string; run: () => void }[] {
    const shown = viewing ?? today
    return when.date === shown ? [] : [{ label: 'Ver', run: () => navigate(when.date === today ? '/hoje' : `/hoje/${when.date}`) }]
  }

  async function send() {
    if (!hasContent || busy || !slotChosen()) return
    setBusy(true)
    try {
      let takenAt: string | null = null
      if (isNow) {
        const at = new Date()
        const exif = photo ? await exifDateTimeOf(photo.file) : null
        takenAt = (photoInstant({ exif, lastModified: null, now: at }) ?? at).toISOString()
      }
      await enqueueCapture({
        files: photo ? [photo.file] : [],
        text: text.trim() || null,
        note: null,
        tags,
        taken_at: takenAt,
        date: api.date ?? null,
        slot: api.slot ?? null,
      })
      sheet.close()
      if (!isNow) toast(`A analisar · ${label}`, seeDay())
    } catch {
      toast('Não consegui guardar. Tenta outra vez.')
    } finally {
      setBusy(false)
    }
  }

  function open(name: 'barras' | 'numeros' | 'repetir') {
    sheet.open(name, whenParams(when, today))
  }

  const big =
    'flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl font-display text-[18px] font-bold tracking-[0.06em] uppercase'
  const pastParam: Record<string, string> = when.date !== today ? { data: when.date } : {}

  return (
    <BottomSheet
      onClose={sheet.close}
      footer={
        hasContent ? (
          <button
            disabled={busy}
            onClick={() => void send()}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-eat font-display text-[18px] font-bold tracking-[0.04em] text-bg uppercase disabled:opacity-40"
          >
            {busy ? 'A guardar…' : <>Registar · {isNow ? 'agora' : label}</>}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4 pb-2">
        <WhenPicker today={today} value={when} onChange={changeWhen} highlight={askSlot} />

        <div className="relative">
          <textarea
            ref={textBox}
            rows={3}
            enterKeyHint="send"
            aria-label="O que comeste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => {
              // Depois de o teclado abrir, o campo fica à vista.
              const box = e.currentTarget
              window.setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && text.trim()) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="O que comeste? Ex.: 2 ovos mexidos, torrada, café com leite"
            className="block w-full resize-none rounded-2xl border border-line bg-bg px-4 py-3 pr-14 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
          />
          {photo ? (
            <button
              onClick={() => setPhoto(null)}
              aria-label="Tirar a foto"
              className="absolute top-2 right-2 h-11 w-11 overflow-hidden rounded-xl"
            >
              <img src={photo.url} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              onClick={() => fileInput.current?.click()}
              aria-label="Juntar foto ao texto"
              className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-xl text-dim"
            >
              <Icon name="camera" size={22} />
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
        {hasContent ? (
          <div className="-mx-4 -mt-2 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {Object.entries(TAG_LABEL).map(([tag, tagLabel]) => (
              <button
                key={tag}
                onClick={() => setTags(toggle(tags, tag))}
                className={`${chip(tags.includes(tag))} shrink-0 whitespace-nowrap`}
              >
                {tagLabel}
              </button>
            ))}
          </div>
        ) : (
          <p className="-mt-2 text-[13px] text-dim">Escreve ou dita (microfone do teclado). A conta chega sozinha.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <PhotoButton
            source="camera"
            date={api.date ?? null}
            slot={api.slot ?? null}
            canOpen={slotChosen}
            className={`${big} bg-eat text-bg`}
            onDone={() => {
              sheet.close()
              if (!isNow) toast(`A analisar · ${label}`, seeDay())
            }}
          >
            <Icon name="camera" size={28} />
            Fotografar
          </PhotoButton>
          <PhotoButton
            source="gallery"
            date={api.date ?? null}
            slot={api.slot ?? null}
            className={`${big} border border-line bg-surface2`}
          >
            <Icon name="gallery" size={28} />
            Galeria
          </PhotoButton>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => open('repetir')}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface2 px-4 text-left"
          >
            <Icon name="repeat" size={22} className="shrink-0 text-eat" />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">Repetir uma refeição</span>
              <span className="block text-[13px] text-dim">De qualquer dia, com pesquisa</span>
            </span>
            <Icon name="chevron" size={18} className="shrink-0 text-dim" />
          </button>
          {sameAsYesterday && (
            <button
              onClick={() => {
                if (!slotChosen()) return
                sheet.close()
                void repeatMeal(
                  sameAsYesterday.id,
                  api.date ?? null,
                  `Registado · ${isNow ? `igual a ontem (${SLOT_LABEL[refSlot].toLowerCase()})` : label}`,
                  toast,
                  api.slot ?? refSlot,
                )
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">
                  Igual {when.date === today ? 'a ontem' : `a ${dayLabel(shiftDate(when.date, -1), today).toLowerCase()}`} ·{' '}
                  {SLOT_LABEL[refSlot].toLowerCase()}
                </span>
                <span className="block truncate text-[13px] text-dim">{mealName(sameAsYesterday)}</span>
              </span>
              <span className="shrink-0 text-[13px] text-dim tabular-nums">
                {fmtKcal(Number(sameAsYesterday.kcal))} kcal
              </span>
            </button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="label">Favoritos</h3>
            <button onClick={() => navigate('/favoritos', { replace: true })} className="text-[13px] text-eat">
              Todos ›
            </button>
          </div>
          {favorites != null && ranked.length === 0 ? (
            <p className="rounded-xl bg-surface2 px-3 py-3 text-[13px] text-dim">
              Toca na ☆ de uma refeição para a guardares aqui. Depois registas com 1 toque.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {ranked.map((favorite) => (
                <button
                  key={favorite.id}
                  onClick={() => {
                    if (!slotChosen()) return
                    sheet.close()
                    void logFavorite(favorite, api.date ?? null, toast, api.slot ?? null, isNow ? null : label)
                  }}
                  className="flex min-h-12 flex-col justify-center rounded-xl bg-surface2 px-3 py-2 text-left"
                >
                  <span className="truncate text-[15px]">{favorite.name}</span>
                  <span className="text-[13px] text-dim tabular-nums">{fmtKcal(favorite.kcal)} kcal</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => open('barras')}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-[15px]"
          >
            <Icon name="barcode" size={18} /> Código de barras
          </button>
          <button
            onClick={() => open('numeros')}
            className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line text-[15px]"
          >
            Só números
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => sheet.open('peso', pastParam)}
            className="relative flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface2 font-display text-[17px] font-bold tracking-[0.06em] uppercase"
          >
            <Icon name="scale" size={20} /> Peso
            {weighDot && <span className="absolute top-2 right-3 h-2 w-2 rounded-full bg-eat" aria-label="por fazer hoje" />}
          </button>
          <button
            onClick={() => sheet.open('medidas')}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface2 font-display text-[17px] font-bold tracking-[0.06em] uppercase"
          >
            <Icon name="ruler" size={20} /> Medidas
          </button>
          <button
            onClick={() => sheet.open('treino', pastParam)}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface2 font-display text-[17px] font-bold tracking-[0.06em] uppercase"
          >
            <Icon name="bike" size={20} /> Treino
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
