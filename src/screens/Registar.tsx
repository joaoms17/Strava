import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { postApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { toJpeg } from '../lib/image'
import type { MealItem, Meal, ParsedMealResponse } from '../lib/types'
import MealReview from '../components/MealReview'

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'review'; parsed: ParsedMealResponse }
  | { kind: 'saved'; meal: Meal }

interface Source {
  input_type: 'text' | 'photo'
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
        prompt_version: parsed.prompt_version,
        model: parsed.model,
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

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      {stage.kind === 'saved' && (
        <div className="rounded-2xl border border-edge bg-card p-4 text-sm">
          <p>
            Guardado: <span className="font-semibold">{Math.round(stage.meal.kcal)} kcal</span> ·{' '}
            <span className="font-semibold">{stage.meal.protein} g proteína</span>
          </p>
        </div>
      )}

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
        <button disabled className="rounded-xl border border-edge px-3 py-2 text-xs text-dim opacity-60">
          Barcode · M2
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
    </div>
  )
}
