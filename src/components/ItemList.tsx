import { useRef, useState } from 'react'
import { fmtInt, parseDecimal } from '../lib/format'
import { setItemGrams, setItemKcal, stepItem } from '../lib/meal-diff'
import type { MealItem } from '../lib/types'

// Os alimentos de uma refeição (ou de uma favorita a criar): o nome, «230 g ·
// 200 kcal» por baixo (duas caixas tocáveis) e × − + à direita. Tocar nas
// gramas ou nas kcal deixa escrevê-las (o resto muda na mesma proporção, logo
// ao escrever); sair do campo fecha-o e Esc volta ao que estava. Sem `onRemoveLast`, o
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
  const [editing, setEditing] = useState<{ index: number; field: 'grams' | 'kcal'; original: MealItem; text: string } | null>(null)
  const cancelled = useRef(false)
  const button = 'h-10 w-10 shrink-0 rounded-lg bg-surface text-[1.0625rem]'

  const replace = (i: number, item: MealItem) => onChange(items.map((it, j) => (j === i ? item : it)))

  function type(text: string) {
    if (!editing) return
    setEditing({ ...editing, text })
    // Enquanto o número não serve (campo vazio, 0), fica o que estava.
    const value = parseDecimal(text)
    replace(editing.index, editing.field === 'kcal' ? setItemKcal(editing.original, value) : setItemGrams(editing.original, value))
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
        const box = 'rounded-lg border border-line px-2'
        const startEdit = (field: 'grams' | 'kcal') =>
          setEditing({ index: i, field, original: item, text: String(Math.round(field === 'kcal' ? item.kcal : item.grams)) })
        return (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5">
            <div className="min-h-11 min-w-0 flex-1 py-0.5">
              <span className="block truncate text-[0.9375rem]">{item.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-dim tabular-nums">
                {editing?.index === i ? (
                  <label className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      inputMode="decimal"
                      enterKeyHint="done"
                      aria-label={`${editing.field === 'kcal' ? 'Kcal' : 'Gramas'} de ${item.name}`}
                      value={editing.text}
                      onChange={(e) => type(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={close}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelled.current = true
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                      }}
                      className="h-9 w-20 rounded-lg border border-eat bg-bg px-2 text-[1.0625rem] text-ink focus:outline-none"
                    />
                    {editing.field === 'kcal' ? `kcal · ${fmtInt(item.grams)} g` : `g · ${fmtInt(item.kcal)} kcal`}
                  </label>
                ) : (
                  <>
                    {item.grams > 0 &&
                      (editable ? (
                        <button onClick={() => startEdit('grams')} className={`${box} min-h-11 min-w-11`} aria-label={`Escrever as gramas de ${item.name}`}>
                          {fmtInt(item.grams)} g
                        </button>
                      ) : (
                        <span>{fmtInt(item.grams)} g ·</span>
                      ))}
                    {editable && item.kcal > 0 ? (
                      <button onClick={() => startEdit('kcal')} className={`${box} min-h-11 min-w-11`} aria-label={`Escrever as kcal de ${item.name}`}>
                        {fmtInt(item.kcal)} kcal
                      </button>
                    ) : (
                      <span>{fmtInt(item.kcal)} kcal</span>
                    )}
                    {item.confidence === 'baixa' && <span className="text-attn">confirma a porção</span>}
                  </>
                )}
              </span>
            </div>
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
