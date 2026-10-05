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
import { MAX_MEAL_PHOTOS, clearPendingCamera, peekPendingCamera } from '../../lib/capture'
import { loadActiveDiet } from '../../lib/diets'
import { useSignedUrls } from '../../lib/photos'
import Thumb from '../ui/Thumb'
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
import type { Diet, Favorite, Meal, Slot } from '../../lib/types'

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
  // Fotos desta refeição (a da câmara chega já aqui): com fotos, o campo é
  // a nota delas.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>(() =>
    (peekPendingCamera() ?? []).map((file) => ({ file, url: URL.createObjectURL(file) })),
  )
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [askSlot, setAskSlot] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[] | null>(null)
  const [sameAsYesterday, setSameAsYesterday] = useState<Meal | null>(null)
  const [weighedToday, setWeighedToday] = useState(true)
  const [diet, setDiet] = useState<Diet | null>(null)
  const textBox = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const refSlot = slotForRanking(when, now)
  const api = whenApi(when, today)
  const isNow = Object.keys(api).length === 0
  const hasContent = text.trim().length > 0 || photos.length > 0
  const reviewing = photos.length > 0

  useEffect(() => {
    if (focus) textBox.current?.focus()
  }, [focus])

  useEffect(() => clearPendingCamera(), [])

  function addPhotos(files: File[]) {
    const room = MAX_MEAL_PHOTOS - photos.length
    if (room <= 0) {
      toast(`Até ${MAX_MEAL_PHOTOS} fotos por refeição.`)
      return
    }
    setPhotos([...photos, ...files.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }

  function removePhoto(i: number) {
    URL.revokeObjectURL(photos[i]!.url)
    setPhotos(photos.filter((_, j) => j !== i))
  }

  useEffect(() => {
    let alive = true
    void Promise.all([
      supabase.from('favorites').select('*').eq('kind', 'meal').eq('archived', false),
      supabase.from('weights').select('date').eq('date', localCalendarDate()),
      loadActiveDiet(),
    ]).then(([{ data: favRows }, { data: weights }, activeDiet]) => {
      if (!alive) return
      setFavorites((favRows ?? []) as Favorite[])
      setWeighedToday((weights ?? []).length > 0)
      setDiet(activeDiet)
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
  // A dieta que segues: as favoritas desta refeição (a habitual primeiro).
  const dietOptions = useMemo(() => {
    const byId = new Map((favorites ?? []).map((f) => [f.id, f]))
    return (diet?.meals[refSlot] ?? []).map((id) => byId.get(id)).filter((f): f is Favorite => !!f)
  }, [diet, favorites, refSlot])
  const favUrls = useSignedUrls([...ranked, ...dietOptions].map((f) => f.photo_path))
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
        const exif = photos[0] ? await exifDateTimeOf(photos[0].file) : null
        takenAt = (photoInstant({ exif, lastModified: null, now: at }) ?? at).toISOString()
      }
      await enqueueCapture({
        files: photos.map((p) => p.file),
        // Com fotos, o que se escreve é a nota (a IA lê-a com a foto).
        text: reviewing ? null : text.trim() || null,
        note: reviewing ? text.trim() || null : null,
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

  // Favorita (ou da dieta) no «Quando» escolhido; da dieta fica na refeição
  // dela mesmo com «Agora».
  function pickFavorite(favorite: Favorite, dietSlot: Slot | null = null) {
    if (!slotChosen()) return
    sheet.close()
    void logFavorite(favorite, api.date ?? null, toast, api.slot ?? dietSlot, isNow ? null : label)
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

        {reviewing && (
          <div className="space-y-2">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {photos.map((p, i) => (
                <div key={p.url} className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    aria-label={`Tirar a foto ${i + 1}`}
                    className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              {photos.length < MAX_MEAL_PHOTOS && (
                <label className="flex h-28 w-28 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-[13px] text-dim">
                  <Icon name="camera" size={24} />
                  Outra foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    aria-label="Outra foto"
                    className="hidden"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])]
                      e.target.value = ''
                      if (files.length) addPhotos(files)
                    }}
                  />
                </label>
              )}
            </div>
            <p className="text-[13px] text-dim">
              Junta uma nota se quiseres (o que não se vê, o que sobrou) e carrega em Registar.
            </p>
          </div>
        )}

        <div className="relative">
          <textarea
            ref={textBox}
            rows={3}
            enterKeyHint="send"
            aria-label={reviewing ? 'Nota da foto' : 'O que comeste'}
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
            placeholder={
              reviewing
                ? 'Nota (opcional). Ex.: comi metade do arroz, molho à parte, frito em azeite'
                : 'O que comeste? Ex.: 2 ovos mexidos, torrada, café com leite'
            }
            className={`block w-full resize-none rounded-2xl border border-line bg-bg px-4 py-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none ${
              reviewing ? '' : 'pr-14'
            }`}
          />
          {!reviewing && (
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
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) addPhotos(files)
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

        {reviewing ? (
          <button
            onClick={() => {
              for (const p of photos) URL.revokeObjectURL(p.url)
              setPhotos([])
              setText('')
            }}
            className="min-h-11 w-full text-[15px] text-dim"
          >
            Cancelar a foto
          </button>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-3">
          {/* A foto fica aqui para a nota; só segue com «Registar». */}
          <label className={`cursor-pointer ${big} bg-eat text-bg`}>
            <Icon name="camera" size={28} />
            Fotografar
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Fotografar"
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length) addPhotos(files.slice(0, 1))
              }}
            />
          </label>
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

        {dietOptions.length > 0 && (
          <div className="space-y-2" aria-label="Da tua dieta">
            <div className="flex items-baseline justify-between">
              <h3 className="label">Da tua dieta · {SLOT_LABEL[refSlot].toLowerCase()}</h3>
              <button onClick={() => navigate('/favoritos?separador=dieta', { replace: true })} className="text-[13px] text-eat">
                Dieta ›
              </button>
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              {dietOptions.map((fav, i) => (
                <button
                  key={fav.id}
                  onClick={() => pickFavorite(fav, refSlot)}
                  className={`w-36 shrink-0 overflow-hidden rounded-2xl text-left ${i === 0 ? 'border-2 border-eat' : 'border border-line'}`}
                >
                  <Thumb url={fav.photo_path ? favUrls[fav.photo_path] : null} fill size={64} className="h-24 w-full rounded-none" />
                  <span className="block px-2 pt-1.5 text-[14px] leading-tight">
                    <span className="line-clamp-2">{fav.name}</span>
                    <span className="block pb-2 text-[12px] text-dim tabular-nums">{fmtKcal(fav.kcal)} kcal</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="label">Favoritas</h3>
            <span className="flex gap-4">
              <button onClick={() => sheet.open('nova-favorita')} className="text-[13px] text-eat">
                ＋ Nova
              </button>
              <button onClick={() => navigate('/favoritos', { replace: true })} className="text-[13px] text-eat">
                Todas ›
              </button>
            </span>
          </div>
          {favorites != null && ranked.length === 0 ? (
            <p className="rounded-xl bg-surface2 px-3 py-3 text-[13px] text-dim">
              Guarda as refeições que repetes em «＋ Nova» (com foto) ou na ☆ de uma refeição. Depois registas com 1
              toque.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {ranked.map((favorite) => (
                <button
                  key={favorite.id}
                  onClick={() => pickFavorite(favorite)}
                  className="flex min-h-14 items-center gap-2 rounded-xl bg-surface2 p-1.5 pr-3 text-left"
                >
                  <Thumb url={favorite.photo_path ? favUrls[favorite.photo_path] : null} size={42} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{favorite.name}</span>
                    <span className="block text-[13px] text-dim tabular-nums">{fmtKcal(favorite.kcal)} kcal</span>
                  </span>
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
          </>
        )}
      </div>
    </BottomSheet>
  )
}
