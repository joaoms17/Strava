import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { DayChips, SlotChips } from '../ui/Chips'
import { postApi } from '../../lib/api'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { emitDataChanged } from '../../lib/events'
import { nutritionalDay } from '../../lib/day'
import { parseDecimal } from '../../lib/format'
import { slotOf } from '../../../api/_lib/rules/momentos'
import type { Meal, Slot } from '../../lib/types'

// Só números: quando já sabes os valores (rótulo, restaurante com tabela).
export default function QuickSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const initialDate = sheet.params.get('data')
  const [values, setValues] = useState({ kcal: '', protein: '', carbs: '', fat: '', name: '' })
  const [date, setDate] = useState(initialDate && initialDate <= today ? initialDate : today)
  const [slot, setSlot] = useState<Slot>(slotOf(new Date()))
  const [busy, setBusy] = useState(false)
  const kcal = parseDecimal(values.kcal)
  const protein = parseDecimal(values.protein)
  const valid = Number.isFinite(kcal) && kcal > 0 && Number.isFinite(protein) && protein >= 0

  async function save() {
    setBusy(true)
    try {
      const carbs = parseDecimal(values.carbs)
      const fat = parseDecimal(values.fat)
      const { meal } = await postApi<{ meal: Meal }>('/api/meal/quick', {
        client_id: crypto.randomUUID(),
        kcal,
        protein,
        ...(Number.isFinite(carbs) ? { carbs } : {}),
        ...(Number.isFinite(fat) ? { fat } : {}),
        ...(values.name.trim() ? { name: values.name.trim() } : {}),
        date,
        slot,
      })
      emitDataChanged()
      sheet.close()
      toast('Registado', [
        {
          label: 'Anular',
          run: async () => {
            await postApi('/api/meal/delete', { meal_id: meal.id })
            emitDataChanged()
          },
        },
      ])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui guardar.')
    } finally {
      setBusy(false)
    }
  }

  const field = (key: keyof typeof values, label: string, required = false) => (
    <label className="block space-y-1">
      <span className="text-[13px] text-dim">
        {label}
        {!required && ' (opcional)'}
      </span>
      <input
        inputMode={key === 'name' ? 'text' : 'decimal'}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        className="h-12 w-full rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums focus:border-eat focus:outline-none"
      />
    </label>
  )

  return (
    <BottomSheet
      title="Só números"
      onClose={sheet.close}
      footer={
        <button
          disabled={busy || !valid}
          onClick={() => void save()}
          className="min-h-14 w-full rounded-2xl bg-eat text-[17px] font-semibold text-bg disabled:opacity-40"
        >
          Guardar
        </button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-2 gap-3">
          {field('kcal', 'Kcal', true)}
          {field('protein', 'Proteína g', true)}
          {field('carbs', 'Hidratos g')}
          {field('fat', 'Gordura g')}
        </div>
        {field('name', 'Nome')}
        <DayChips today={today} value={date} onChange={setDate} />
        <SlotChips value={slot} onChange={(s) => setSlot(s as Slot)} />
      </div>
    </BottomSheet>
  )
}
