import { useState } from 'react'
import type { MealItem, ParsedMealResponse } from '../lib/types'

interface Props {
  parsed: ParsedMealResponse
  busy: boolean
  onSave: (items: MealItem[]) => void
  onCorrect: (correction: string) => void
  onDiscard: () => void
}

function num(value: string): number {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

export default function MealReview({ parsed, busy, onSave, onCorrect, onDiscard }: Props) {
  const [items, setItems] = useState<MealItem[]>(parsed.items)
  const [correction, setCorrection] = useState('')

  function update(index: number, patch: Partial<MealItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const totalKcal = Math.round(items.reduce((acc, i) => acc + i.kcal, 0))
  const totalProtein = Math.round(items.reduce((acc, i) => acc + i.protein, 0) * 10) / 10

  const fieldClass =
    'w-full rounded-lg border border-edge bg-bg px-2 py-1.5 text-right text-sm focus:border-accent focus:outline-none'

  return (
    <div className="space-y-4 rounded-2xl border border-edge bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Confirma a refeição</h2>
        <span className="text-xs text-dim">
          confiança {(parsed.confidence * 100).toFixed(0)}%
          {parsed.is_estimate && ' · estimada'}
        </span>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="space-y-2 rounded-xl border border-edge p-3">
            <div className="flex items-center gap-2">
              <input
                value={item.name}
                onChange={(e) => update(index, { name: e.target.value })}
                className="w-full rounded-lg border border-edge bg-bg px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              {item.estimated && <span className="shrink-0 text-xs text-dim">est.</span>}
              <button
                className="shrink-0 px-1 text-dim"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                aria-label={`Remover ${item.name}`}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label className="space-y-1">
                <span className="block text-xs text-dim">g</span>
                <input
                  inputMode="decimal"
                  value={String(item.grams)}
                  onChange={(e) => update(index, { grams: num(e.target.value) })}
                  className={fieldClass}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-dim">kcal</span>
                <input
                  inputMode="decimal"
                  value={String(item.kcal)}
                  onChange={(e) => update(index, { kcal: num(e.target.value) })}
                  className={fieldClass}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-dim">prot. g</span>
                <input
                  inputMode="decimal"
                  value={String(item.protein)}
                  onChange={(e) => update(index, { protein: num(e.target.value) })}
                  className={fieldClass}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-dim">
        Total: <span className="font-semibold text-ink">{totalKcal} kcal</span> ·{' '}
        <span className="font-semibold text-ink">{totalProtein} g proteína</span>
      </p>

      {parsed.assumed_portions && parsed.assumed_portions.length > 0 && (
        <ul className="space-y-1 text-xs text-dim">
          {parsed.assumed_portions.map((assumption, i) => (
            <li key={i}>· {assumption}</li>
          ))}
        </ul>
      )}

      {parsed.questions.length > 0 && (
        <ul className="space-y-1 text-sm text-accent">
          {parsed.questions.map((question, i) => (
            <li key={i}>? {question}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          placeholder="corrigir… (ex.: eram 200 g)"
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-edge bg-bg px-3 py-2 text-sm placeholder:text-dim focus:border-accent focus:outline-none"
        />
        <button
          disabled={busy || !correction.trim()}
          onClick={() => {
            onCorrect(correction.trim())
            setCorrection('')
          }}
          className="rounded-xl border border-edge px-4 py-2 text-sm text-ink disabled:opacity-50"
        >
          Corrigir
        </button>
      </div>

      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={onDiscard}
          className="rounded-xl border border-edge px-4 py-3 text-sm text-dim"
        >
          Descartar
        </button>
        <button
          disabled={busy || items.length === 0}
          onClick={() => onSave(items)}
          className="flex-1 rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
        >
          {busy ? 'A guardar…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
