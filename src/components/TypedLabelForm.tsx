import { useState } from 'react'
import { postApi } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { cleanDecimalText, decimalFromText } from '../lib/campo-numero'
import { fmtInt } from '../lib/format'
import { typedFood, type TypedLabel } from '../../api/_lib/rules/off'
import type { Food } from '../lib/types'

const BAD_VALUES = 'Esses valores não batem certo. Confirma as kcal e a proteína por 100 g.'

// O rótulo escrito à mão (a foto não deu, ou não há código): nome, kcal e
// macros por 100 g e as gramas comidas. O alimento fica guardado (com o
// código, se veio de um código não encontrado) e aparece nos mais usados.
export default function TypedLabelForm({
  ean,
  onSaved,
  onCancel,
}: {
  ean: string | null
  onSaved: (food: Food, grams: number) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [text, setText] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', grams: '100' })
  const set = (key: keyof typeof text) => (value: string) =>
    setText({ ...text, [key]: key === 'name' ? value : cleanDecimalText(value, 1) })

  const optional = (t: string) => (t.trim() ? decimalFromText(t, 0, 100) : null)
  const label: TypedLabel | null = (() => {
    const kcal = decimalFromText(text.kcal, 0, 900)
    const protein = decimalFromText(text.protein, 0, 100)
    if (!text.name.trim() || kcal == null || protein == null) return null
    return { name: text.name, kcal_100g: kcal, protein_100g: protein, carbs_100g: optional(text.carbs), fat_100g: optional(text.fat) }
  })()
  const grams = decimalFromText(text.grams, 1, 5000)
  const ready = label != null && grams != null

  async function save() {
    if (!label || grams == null) return
    try {
      let food: Food
      if (ean) {
        ;({ food } = await postApi<{ food: Food }>('/api/meal/label', { ean, values: label }))
      } else {
        const values = typedFood(label)
        if (!values) throw new Error(BAD_VALUES)
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Sessão expirada. Volta a entrar.')
        const { data, error } = await supabase
          .from('foods')
          .insert({ ...values, user_id: user.id, source: 'user', use_count: 0 })
          .select()
          .single()
        if (error || !data) throw new Error('Não consegui guardar o alimento. Tenta outra vez.')
        food = data as Food
      }
      onSaved(food, Math.round(grams))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar o alimento.')
    }
  }

  const field = (key: keyof typeof text, title: string, opts: { decimal?: boolean; placeholder?: string } = {}) => (
    <label className="block space-y-1">
      <span className="text-[0.8125rem] text-dim">{title}</span>
      <input
        value={text[key]}
        onChange={(e) => set(key)(e.target.value)}
        inputMode={opts.decimal ? 'decimal' : 'text'}
        placeholder={opts.placeholder}
        maxLength={key === 'name' ? 120 : 7}
        className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[1.0625rem] placeholder:text-dim focus:border-eat focus:outline-none"
      />
    </label>
  )

  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <p className="text-[1.0625rem] font-semibold">Escrever do rótulo</p>
      {field('name', 'Nome', { placeholder: 'Ex.: Wrap integral Continente' })}
      <p className="text-[0.8125rem] text-dim">Por 100 g, como na tabela do rótulo:</p>
      <div className="grid grid-cols-2 gap-2">
        {field('kcal', 'Kcal', { decimal: true })}
        {field('protein', 'Proteína (g)', { decimal: true })}
        {field('carbs', 'Hidratos (g) · opcional', { decimal: true })}
        {field('fat', 'Gordura (g) · opcional', { decimal: true })}
      </div>
      {field('grams', 'Quanto comeste (g)', { decimal: true })}
      {label && grams != null && (
        <p className="text-[0.9375rem] text-dim tabular-nums">
          {fmtInt((label.kcal_100g * grams) / 100)} kcal ·{' '}
          <span className="text-protein">Proteína {fmtInt((label.protein_100g * grams) / 100)} g</span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="min-h-12 rounded-xl bg-surface2 text-[0.9375rem]">
          Voltar
        </button>
        <BusyButton
          busy="A guardar…"
          onClick={save}
          disabled={!ready}
          className="min-h-12 rounded-xl bg-eat font-semibold text-bg disabled:opacity-40"
        >
          Usar
        </BusyButton>
      </div>
    </div>
  )
}
