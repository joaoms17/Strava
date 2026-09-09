import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { getApi, isNetworkError, postApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { toJpeg } from '../lib/image'
import { enqueueMeal, listQueuedMeals, removeQueuedMeal, type QueuedMeal } from '../lib/queue'
import { round1 } from '../../api/_lib/rules/meal-totals'
import type { Food, MealItem, Meal, ParsedMealResponse } from '../lib/types'
import MealReview from '../components/MealReview'
import BarcodeScanner from '../components/BarcodeScanner'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'review'; parsed: ParsedMealResponse }
  | { kind: 'portion'; food: Food; from: string }
  | { kind: 'saved'; meal: Meal }

interface Source {
  input_type: 'text' | 'photo' | 'barcode'
  raw_text: string | null
  photo_path: string | null
  notes: string[]
}

export default function Registar() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [text, setText] = useState('')
  const [jantarFora, setJantarFora] = useState(false)
  const [slow, setSlow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [grams, setGrams] = useState('')
  const [pending, setPending] = useState<QueuedMeal[]>([])
  const [syncing, setSyncing] = useState(false)
  const source = useRef<Source | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (stage.kind !== 'parsing') {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), 5000)
    return () => clearTimeout(timer)
  }, [stage.kind])

  const refreshPending = useCallback(async () => {
    try {
      setPending(await listQueuedMeals())
    } catch {
      // IndexedDB indisponível — a fila simplesmente não aparece
    }
  }, [])

  const syncPending = useCallback(async () => {
    if (!navigator.onLine) return
    const queued = await listQueuedMeals().catch(() => [] as QueuedMeal[])
    if (queued.length === 0) return
    setSyncing(true)
    for (const entry of queued) {
      try {
        const parsed = await postApi<ParsedMealResponse>('/api/meal/parse-text', {
          text: entry.text,
          jantar_fora: entry.jantar_fora,
        })
        await postApi<{ meal: Meal }>('/api/meal/save', {
          input_type: 'text',
          raw_text: entry.text,
          photo_path: null,
          items: parsed.items,
          is_estimate: parsed.is_estimate,
          confidence: parsed.confidence,
          prompt_version: parsed.prompt_version,
          model: parsed.model,
          cost_usd: parsed.cost_usd,
          logged_at: entry.logged_at,
        })
        await removeQueuedMeal(entry.id)
      } catch {
        break // sem rede outra vez (ou erro) — fica para a próxima
      }
    }
    setSyncing(false)
    await refreshPending()
  }, [refreshPending])

  useEffect(() => {
    void refreshPending()
    void syncPending()
    const onOnline = () => void syncPending()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshPending, syncPending])

  async function parseText(fullText: string) {
    setError(null)
    setInfo(null)
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
        await enqueueMeal(fullText, jantarFora).catch(() => undefined)
        await refreshPending()
        setInfo('Sem rede — a refeição ficou na fila e entra quando voltares a ter ligação.')
        setText('')
        setJantarFora(false)
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao analisar.')
      }
      setStage({ kind: 'idle' })
    }
  }

  async function parsePhoto(photoPath: string, notes: string[]) {
    setError(null)
    setInfo(null)
    setStage({ kind: 'parsing' })
    try {
      const parsed = await postApi<ParsedMealResponse>('/api/meal/parse-photo', {
        photo_path: photoPath,
        note: notes.join('; ') || undefined,
        jantar_fora: jantarFora,
      })
      source.current = { input_type: 'photo', raw_text: null, photo_path: photoPath, notes }
      setStage({ kind: 'review', parsed })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao analisar a fotografia.')
      setStage({ kind: 'idle' })
    }
  }

  async function onPhotoChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
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
      if (uploadError) throw new Error('Falha no upload da fotografia.')
      await parsePhoto(path, text.trim() ? [text.trim()] : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro com a fotografia.')
      setStage({ kind: 'idle' })
    }
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
      })
      setStage({ kind: 'saved', meal })
      setText('')
      setJantarFora(false)
      source.current = null
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar.')
    } finally {
      setBusy(false)
    }
  }

  if (stage.kind === 'review') {
    return (
      <div className="mx-auto max-w-md space-y-4 pt-2">
        {error && <p className="text-sm text-warn">{error}</p>}
        <MealReview
          parsed={stage.parsed}
          busy={busy}
          onSave={(items) => void save(items, stage.parsed)}
          onCorrect={correct}
          onDiscard={() => setStage({ kind: 'idle' })}
        />
      </div>
    )
  }

  if (stage.kind === 'portion') {
    const quantity = Number(grams.replace(',', '.')) || 0
    return (
      <div className="mx-auto max-w-md space-y-4 pt-2">
        <div className="space-y-3 rounded-2xl border border-edge bg-card p-4">
          <p className="font-semibold">{stage.food.name}</p>
          <p className="text-xs text-dim">
            {Math.round(stage.food.kcal_100g)} kcal · {stage.food.protein_100g} g prot. por 100 g
            {stage.from === 'pessoal' && ' · já conhecido'}
          </p>
          <label className="block space-y-1">
            <span className="text-xs text-dim">quantidade (g)</span>
            <input
              inputMode="decimal"
              autoFocus
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              className="w-full rounded-xl border border-edge bg-bg px-3 py-3 text-lg text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <p className="text-sm text-dim">
            = <span className="font-semibold text-ink">{Math.round((stage.food.kcal_100g * quantity) / 100)} kcal</span> ·{' '}
            <span className="font-semibold text-ink">
              {round1((stage.food.protein_100g * quantity) / 100)} g proteína
            </span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setStage({ kind: 'idle' })}
              className="rounded-xl border border-edge px-4 py-3 text-sm text-dim"
            >
              Cancelar
            </button>
            <button
              disabled={quantity <= 0}
              onClick={() => confirmPortion(stage.food)}
              className="flex-1 rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
            >
              Rever
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {scanning && <BarcodeScanner onDetect={(ean) => void onBarcode(ean)} onClose={() => setScanning(false)} />}

      {stage.kind === 'saved' && (
        <div className="rounded-2xl border border-edge bg-card p-4 text-sm">
          <p>
            Guardado: <span className="font-semibold">{Math.round(stage.meal.kcal)} kcal</span> ·{' '}
            <span className="font-semibold">{stage.meal.protein} g proteína</span>
          </p>
        </div>
      )}
      {info && <p className="rounded-2xl border border-edge bg-card p-4 text-sm text-dim">{info}</p>}

      <button
        disabled={stage.kind === 'parsing'}
        onClick={() => fileInput.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border border-edge bg-card py-10 disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-10 w-10 text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 8h3l2-3h6l2 3h3v12H4V8Z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        <span className="text-sm text-dim">Fotografar a refeição</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPhotoChosen(e)}
      />

      <textarea
        rows={3}
        placeholder="ex.: 2 ovos mexidos, 100g arroz, salada"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={stage.kind === 'parsing'}
        className="w-full rounded-2xl border border-edge bg-card px-4 py-3 text-ink placeholder:text-dim focus:border-accent focus:outline-none"
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-dim">
          <input
            type="checkbox"
            checked={jantarFora}
            onChange={(e) => setJantarFora(e.target.checked)}
            className="h-5 w-5 accent-amber-500"
          />
          Jantar fora
        </label>
        <button
          disabled={stage.kind === 'parsing'}
          onClick={() => setScanning(true)}
          className="rounded-xl border border-edge px-3 py-2 text-xs text-ink disabled:opacity-50"
        >
          Barcode
        </button>
      </div>

      {error && <p className="text-sm text-warn">{error}</p>}

      <button
        disabled={stage.kind === 'parsing' || !text.trim()}
        onClick={() => void parseText(text.trim())}
        className="w-full rounded-2xl bg-accent py-4 text-lg font-semibold text-bg disabled:opacity-50"
      >
        {stage.kind === 'parsing' ? (slow ? 'Ainda a processar…' : 'A analisar…') : 'Analisar'}
      </button>

      {pending.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-edge bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dim">Na fila ({pending.length})</h2>
            <button
              disabled={syncing}
              onClick={() => void syncPending()}
              className="text-xs text-accent disabled:opacity-50"
            >
              {syncing ? 'A sincronizar…' : 'Sincronizar'}
            </button>
          </div>
          {pending.map((entry) => (
            <p key={entry.id} className="truncate text-xs text-dim">
              · {entry.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
