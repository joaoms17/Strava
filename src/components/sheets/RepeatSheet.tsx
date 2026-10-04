import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import WhenPicker from '../ui/WhenPicker'
import MealHistoryList from '../MealHistoryList'
import { useSheet } from '../../lib/sheet'
import { useToast } from '../../lib/toast'
import { useReadyProfile } from '../../lib/profile'
import { nutritionalDay } from '../../lib/day'
import { repeatMeal } from '../../lib/meal-actions'
import { needsSlot, whenApi, whenFromParams, whenLabel, type When } from '../../lib/when'
import { slotOf } from '../../../api/_lib/rules/momentos'

// Repetir uma refeição de qualquer dia (até 3 meses): fica no dia e
// refeição escolhidos.
export default function RepeatSheet() {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const toast = useToast()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [when, setWhen] = useState<When>(() => whenFromParams(sheet.params, today))
  const [askSlot, setAskSlot] = useState(false)
  const label = whenLabel(when, today)

  function pick(mealId: string) {
    if (needsSlot(when)) {
      setAskSlot(true)
      toast('Escolhe primeiro a refeição (pequeno-almoço, almoço…).')
      return
    }
    const api = whenApi(when, today)
    sheet.close()
    // «Agora»: fica na refeição desta hora.
    void repeatMeal(mealId, api.date ?? null, `Repetido · ${label}`, toast, api.slot ?? slotOf(new Date()))
  }

  return (
    <BottomSheet title="Repetir refeição" onClose={sheet.close}>
      <div className="space-y-4 pb-2">
        <div className="space-y-2">
          <p className="text-[13px] text-dim">
            Vai ficar em <span className="font-semibold text-ink">{label}</span>
          </p>
          <WhenPicker
            today={today}
            value={when}
            onChange={(next) => {
              setWhen(next)
              setAskSlot(false)
            }}
            highlight={askSlot}
          />
        </div>
        <MealHistoryList today={today} onPick={(meal) => pick(meal.id)} />
      </div>
    </BottomSheet>
  )
}
