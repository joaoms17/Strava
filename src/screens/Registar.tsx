import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation, useSearch } from 'wouter'
import { getApi, isNetworkError, postApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { toJpeg } from '../lib/image'
import { enqueueMeal } from '../lib/queue'
import { takePendingPhoto } from '../lib/capture'
import { useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { emitDataChanged } from '../lib/events'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmtDayShort, fmtKcal } from '../lib/format'
import { round1 } from '../../api/_lib/rules/meal-totals'
import { SLOTS, SLOT_LABEL, SLOT_TIME, loggedAtFor, type Slot } from '../../api/_lib/rules/momentos'
import type { Food, MealItem, Meal, ParsedMealResponse } from '../lib/types'
import MealReview from '../components/MealReview'
import BarcodeScanner from '../components/BarcodeScanner'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'review'; parsed: ParsedMealResponse }
  | { kind: 'portion'; food: Food; from: string }

interface Source {
  input_type: 'text' | 'photo' | 'barcode'
  raw_text: string | null
  photo_path: string | null
  notes: string[]
}

// Registar por foto, galeria, texto ou código de barras. Nesta fase a análise
// ainda espera pela IA; na Fase 2 passa a correr em segundo plano.
export default function Registar() {
  const profile = useReadyProfile()
  const toast = useToast()
  const [, navigate] = useLocation()
  const search = new URLSearchParams(useSearch())
  const cutoff = profile.nutrition_day_cutoff_hour
  const today = nutritionalDay(new Date(), cutoff)
  const initialDate = search.get('data')
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today)
  const [slot, setSlot] = useState<Slot | 'agora'>(initialDate && initialDate < today ? 'almoco' : 'agora')
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [text, setText] = useState('')
  const [jantarFora, setJantarFora] = useState(false)
  const [slow, setSlow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [grams, setGrams] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const source = useRef<Source | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const started = useRef(false)

  const isPast = date !== today
  const effectiveSlot: Slot | 'agora' = isPast && slot === 'agora' ? 'almoco' : slot

  function loggedAt(): string {
    if (effectiveSlot === 'agora') return new Date().toISOString()
    return loggedAtFor(date, SLOT_TIME[effectiveSlot], cutoff, new Date()).toISOString()
  }

  useEffect(() => {
    if (stage.kind !== 'parsing') {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), 5000)
    return () => clearTimeout(timer)
  }, [stage.kind])

  // Foto escolhida na folha (+): começa logo.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const pending = takePendingPhoto()
    if (pending) void handlePhoto(pending.file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function parseText(fullText: string) {
    setError(null)
    setStage({ kind: 'parsing' })
    try {
      const parsed = await postApi<ParsedMealResponse>('/api/meal/parse-text', {
        text: fullText,
        jantar_fora: jantarFora,
      })
      source.current = { input_type: 'text', raw_text: fullText, photo_path: null, notes: [] }
      setStage({ kind: 'review', parsed })
    } catch (err) {
      if (isNetworkError(err)) {
        await enqueueMeal(fullText, jantarFora, loggedAt()).catch(() => undefined)
        emitDataChanged()
        toast('Sem rede — a refeição ficou guardada e entra quando voltares a ter ligação.')
        navigate(isPast ? `/hoje/${date}` : '/hoje')
        return
      }
      setError(err instanceof Error ? err.message : 'Erro ao analisar.')
      setStage({ kind: 'idle' })
    }
  }

  async function parsePhoto(photoPath: string, notes: string[]) {
    setError(null)
    setStage({ kind: 'parsing' })
    try {
      const parsed = await postApi<ParsedMealResponse>('/api/meal/parse-photo', {
        photo_path: photoPath,
        note: notes.join('; ') || undefined,
        jantar_fora: jantarFora,
      })
      source.current = { input_type: 'photo', raw_text: notes.join('; ') || null, photo_path: photoPath, notes }
      setStage({ kind: 'review', parsed })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao analisar a fotografia.')
      setStage({ kind: 'idle' })
    }
  }

  async function handlePhoto(file: File) {
    setError(null)
    setPreview(URL.createObjectURL(file))
    setStage({ kind: 'parsing' })
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Sessão expirada.')
      const blob = await toJpeg(file)
      const path = `${user.id}/${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('meal-photos')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (uploadError) throw new Error('Falha no envio da fotografia. Tenta outra vez.')
      await parsePhoto(path, text.trim() ? [text.trim()] : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro com a fotografia.')
      setStage({ kind: 'idle' })
    }
  }

  function onPhotoChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void handlePhoto(file)
  }

  async function onBarcode(ean: string) {
    setScanning(false)
    setError(null)
    setStage({ kind: 'parsing' })
    try {
      const { food, from } = await getApi<{ food: Food; from: string }>(`/api/food/barcode/${ean}`)
      setGrams(String(food.default_portion_g ?? 100))
      setStage({ kind: 'portion', food, from })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no código de barras.')
      setStage({ kind: 'idle' })
    }
  }

  function confirmPortion(food: Food) {
    const quantity = Number(grams.replace(',', '.'))
    if (!Number.isFinite(quantity) || quantity <= 0) return
    const factor = quantity / 100
    const item: MealItem = {
      name: food.name,
      grams: round1(quantity),
      kcal: round1(food.kcal_100g * factor),
      protein: round1(food.protein_100g * factor),
      carbs: round1(food.carbs_100g * factor),
      fat: round1(food.fat_100g * factor),
      food_id: food.id,
      estimated: false,
    }
    source.current = {
      input_type: 'barcode',
      raw_text: food.barcode ? `EAN ${food.barcode}` : food.name,
      photo_path: null,
      notes: [],
    }
    setStage({
      kind: 'review',
      parsed: {
        items: [item],
        confidence: 1,
        questions: [],
        is_estimate: false,
        prompt_version: '',
        model: '',
        cost_usd: 0,
      },
    })
  }

  function correct(correction: string) {
    const current = source.current
    if (!current) return
    if (current.input_type === 'photo' && current.photo_path) {
      void parsePhoto(current.photo_path, [...current.notes, correction])
    } else {
      void parseText(`${current.raw_text ?? ''}\n(correção: ${correction})`)
    }
  }

  async function save(items: MealItem[], parsed: ParsedMealResponse) {
    const current = source.current
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/save', {
        input_type: current.input_type,
        raw_text: current.raw_text,
        photo_path: current.photo_path,
        items,
        is_estimate: parsed.is_estimate,
        confidence: parsed.confidence,
        prompt_version: parsed.prompt_version || null,
        model: parsed.model || null,
        cost_usd: parsed.cost_usd,
        logged_at: loggedAt(),
      })
      emitDataChanged()
      toast(`Registado · ${fmtKcal(Number(meal.kcal))} kcal`, [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/delete', { meal_id: meal.id })
            emitDataChanged()
          },
        },
      ])
      navigate(meal.date === today ? '/hoje' : `/hoje/${meal.date}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar.')
    } finally {
      setBusy(false)
    }
  }

  const when = (
    <div className="space-y-2">
      <div className="flex gap-2">
        {[0, -1, -2].map((back) => {
          const day = shiftDate(today, back)
          return (
            <button
              key={back}
              onClick={() => setDate(day)}
              className={`rounded-full px-3 py-1.5 text-[15px] ${day === date ? 'bg-eat text-bg' : 'bg-surface2'}`}
            >
              {back === 0 ? 'Hoje' : back === -1 ? 'Ontem' : 'Anteontem'}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {!isPast && (
          <button
            onClick={() => setSlot('agora')}
            className={`rounded-full px-3 py-1.5 text-[13px] ${effectiveSlot === 'agora' ? 'bg-eat text-bg' : 'bg-surface2'}`}
          >
            Agora
          </button>
        )}
        {SLOTS.map((s) => (
          <button
            key={s}
            onClick={() => setSlot(s)}
            className={`rounded-full px-3 py-1.5 text-[13px] ${effectiveSlot === s ? 'bg-eat text-bg' : 'bg-surface2'}`}
          >
            {SLOT_LABEL[s]} {SLOT_TIME[s]}
          </button>
        ))}
      </div>
      {isPast && <p className="text-[13px] text-dim">Fica em {fmtDayShort(date)}.</p>}
    </div>
  )

  if (stage.kind === 'review') {
    return (
      <div className="space-y-4 pt-1">
        {preview && <img src={preview} alt="" className="max-h-48 w-full rounded-2xl object-cover" />}
        {when}
        {error && <p className="text-[15px] text-pain">{error}</p>}
        <MealReview
          parsed={stage.parsed}
          busy={busy}
          onSave={(items) => void save(items, stage.parsed)}
          onCorrect={correct}
          onDiscard={() => {
            setStage({ kind: 'idle' })
            setPreview(null)
          }}
        />
      </div>
    )
  }

  if (stage.kind === 'portion') {
    const quantity = Number(grams.replace(',', '.')) || 0
    return (
      <div className="space-y-4 pt-1">
        <div className="space-y-3 rounded-2xl bg-surface p-4">
          <p className="font-semibold">{stage.food.name}</p>
          <p className="text-[13px] text-dim">
            {Math.round(stage.food.kcal_100g)} kcal · {stage.food.protein_100g} g proteína por 100 g
            {stage.from === 'pessoal' && ' · já conhecido'}
          </p>
          <label className="block space-y-1">
            <span className="text-[13px] text-dim">quantidade (g)</span>
            <input
              inputMode="decimal"
              autoFocus
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] focus:border-eat focus:outline-none"
            />
          </label>
          <p className="text-[15px] text-dim">
            = <span className="font-semibold text-ink">{Math.round((stage.food.kcal_100g * quantity) / 100)} kcal</span> ·{' '}
            <span className="font-semibold text-protein">
              {round1((stage.food.protein_100g * quantity) / 100)} g proteína
            </span>
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStage({ kind: 'idle' })} className="min-h-12 rounded-xl bg-surface2 px-4 text-[15px] text-dim">
              Cancelar
            </button>
            <button
              disabled={quantity <= 0}
              onClick={() => confirmPortion(stage.food)}
              className="min-h-12 flex-1 rounded-xl bg-eat font-semibold text-bg disabled:opacity-50"
            >
              Rever
            </button>
          </div>
        </div>
      </div>
    )
  }

  const parsing = stage.kind === 'parsing'
  return (
    <div className="space-y-4 pt-1">
      {scanning && <BarcodeScanner onDetect={(ean) => void onBarcode(ean)} onClose={() => setScanning(false)} />}

      {preview && <img src={preview} alt="" className="max-h-56 w-full rounded-2xl object-cover" />}

      {parsing ? (
        <div className="space-y-2 rounded-2xl bg-surface p-5 text-center">
          <p className="text-[17px]">{slow ? 'Ainda a analisar…' : 'A analisar…'}</p>
          <p className="text-[13px] text-dim">Demora uns segundos. Dá para ir preenchendo o dia e a hora.</p>
        </div>
      ) : (
        <>
          <textarea
            rows={4}
            autoFocus={search.get('modo') === 'escrever'}
            enterKeyHint="done"
            placeholder={preview ? 'Nota (ex.: comi metade, com azeite)' : 'Ex.: 2 ovos mexidos, 1 torrada, café com leite'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[17px] placeholder:text-dim focus:border-eat focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[15px] text-dim">
              <input
                type="checkbox"
                checked={jantarFora}
                onChange={(e) => setJantarFora(e.target.checked)}
                className="h-5 w-5 accent-[var(--color-eat)]"
              />
              Jantar fora
            </label>
            <div className="flex gap-2">
              <button onClick={() => fileInput.current?.click()} className="min-h-11 rounded-xl bg-surface2 px-3 text-[15px]">
                📷 Juntar foto
              </button>
              <button onClick={() => setScanning(true)} className="min-h-11 rounded-xl bg-surface2 px-3 text-[15px]">
                Código de barras
              </button>
            </div>
          </div>
        </>
      )}
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPhotoChosen} />

      {when}

      {error && <p className="text-[15px] text-pain">{error}</p>}

      {!parsing && (
        <button
          disabled={!text.trim()}
          onClick={() => void parseText(text.trim())}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          Enviar
        </button>
      )}
    </div>
  )
}
