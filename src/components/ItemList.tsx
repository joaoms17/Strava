import { useRef, useState } from 'react'
import { fmtInt, parseDecimal } from '../lib/format'
import { setItemGrams, stepItem } from '../lib/meal-diff'
import type { MealItem } from '../lib/types'

// Os alimentos de uma refeição (ou de uma favorita a criar): o nome, «230 g ·
// 200 kcal» por baixo e × − + à direita. Tocar no alimento deixa escrever as
// gramas (as kcal e os macros mudam na mesma proporção, logo ao escrever);
// sair do campo fecha-o e Esc volta ao que estava. Sem `onRemoveLast`, o
// último alimento não se tira (para tirar tudo há «Apagar»).
export default function ItemList({
  items,
  onChange,
  onRemoveLast,
  readOnly = false,
}: {
  items: MealItem[]
  onChange: (next: MealItem[]) => void
  onRemoveLast?: () => void
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState<{ index: number; original: MealItem; text: string } | null>(null)
  const cancelled = useRef(false)
  const button = 'h-10 w-10 shrink-0 rounded-lg bg-surface text-[17px]'

  const replace = (i: number, item: MealItem) => onChange(items.map((it, j) => (j === i ? item : it)))

  function type(text: string) {
    if (!editing) return
    setEditing({ ...editing, text })
    // Enquanto o número não serve (campo vazio, 0), fica o que estava.
    replace(editing.index, setItemGrams(editing.original, parseDecimal(text)))
  }

  function close() {
    if (editing && cancelled.current) replace(editing.index, editing.original)
    cancelled.current = false
    setEditing(null)
  }

  // No iPhone, tocar num botão nem sempre tira o foco do campo: × − + fecham
  // a edição antes (o número escrito já está nos alimentos), para o campo não
  // ficar a apontar para outro alimento.
  function act(next: MealItem[]) {
    cancelled.current = false
    setEditing(null)
    onChange(next)
  }

  return (
    <ul className="divide-y divide-line rounded-2xl bg-surface2">
      {items.map((item, i) => {
        const editable = !readOnly && item.grams > 0
        const line = (
          <>
            <span className="block truncate text-[15px]">{item.name}</span>
            <span className="block text-[13px] text-dim tabular-nums">
              {item.grams > 0 && (
                <>
                  <span className={editable ? 'underline decoration-dotted underline-offset-2' : ''}>
                    {fmtInt(item.grams)} g
                  </span>
                  {' · '}
                </>
              )}
              {fmtInt(item.kcal)} kcal
              {item.confidence === 'baixa' && <span className="ml-1 text-attn">confirma a porção</span>}
            </span>
          </>
        )
        return (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5">
            {editing?.index === i ? (
              <label className="min-h-11 min-w-0 flex-1">
                <span className="block truncate text-[15px]">{item.name}</span>
                <span className="flex items-center gap-1.5 text-[13px] text-dim tabular-nums">
                  <input
                    autoFocus
                    inputMode="decimal"
                    enterKeyHint="done"
                    aria-label={`Gramas de ${item.name}`}
                    value={editing.text}
                    onChange={(e) => type(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={close}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') cancelled.current = true
                      if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                    }}
                    className="h-9 w-20 rounded-lg border border-eat bg-bg px-2 text-[17px] text-ink focus:outline-none"
                  />
                  g · {fmtInt(item.kcal)} kcal
                </span>
              </label>
            ) : editable ? (
              <button
                onClick={() => setEditing({ index: i, original: item, text: String(Math.round(item.grams)) })}
                className="min-h-11 min-w-0 flex-1 text-left"
              >
                {line}
                <span className="sr-only">Escrever as gramas</span>
              </button>
            ) : (
              <div className="min-h-11 min-w-0 flex-1 py-0.5">{line}</div>
            )}
            {!readOnly && (items.length > 1 || onRemoveLast) && (
              <button
                onClick={() => {
                  if (items.length > 1) act(items.filter((_, j) => j !== i))
                  else {
                    setEditing(null)
                    onRemoveLast?.()
                  }
                }}
                className={`${button} text-pain`}
                aria-label={`tirar ${item.name}`}
              >
                ×
              </button>
            )}
            {editable && (
              <>
                <button onClick={() => act(items.map((it, j) => (j === i ? stepItem(it, -10) : it)))} className={button} aria-label={`menos 10 g de ${item.name}`}>
                  −
                </button>
                <button onClick={() => act(items.map((it, j) => (j === i ? stepItem(it, 10) : it)))} className={button} aria-label={`mais 10 g de ${item.name}`}>
                  +
                </button>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
