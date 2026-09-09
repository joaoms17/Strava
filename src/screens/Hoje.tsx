import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localCalendarDate, nutritionalDay, shiftDate } from '../lib/day'
import type { DayRow, Meal, Profile } from '../lib/types'

interface HojeData {
  profile: Profile
  meals: Meal[]
  day: DayRow | null
  yesterday: DayRow | null
  date: string
}

export default function Hoje() {
  const [data, setData] = useState<HojeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [weight, setWeight] = useState('')
  const [weightBusy, setWeightBusy] = useState(false)
  const [weightSaved, setWeightSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const { data: profile, error: profileError } = await supabase
      .from('profile')
      .select('*')
      .single()
    if (profileError || !profile) {
      setError('Perfil não encontrado — corre os seeds no Supabase.')
      return
    }
    const date = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
    const [{ data: meals }, { data: day }, { data: yesterday }] = await Promise.all([
      supabase.from('meals').select('*').eq('date', date).order('logged_at'),
      supabase.from('days').select('*').eq('date', date).maybeSingle(),
      supabase.from('days').select('*').eq('date', shiftDate(date, -1)).maybeSingle(),
    ])
    setData({
      profile: profile as Profile,
      meals: (meals ?? []) as Meal[],
      day: (day ?? null) as DayRow | null,
      yesterday: (yesterday ?? null) as DayRow | null,
      date,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveWeight() {
    const kg = Number(weight.replace(',', '.'))
    if (!Number.isFinite(kg) || kg < 30 || kg > 200) return
    setWeightBusy(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { error: upsertError } = await supabase
        .from('weights')
        .upsert(
          { user_id: user.id, date: localCalendarDate(), kg, source: 'manual' },
          { onConflict: 'user_id,date' },
        )
      if (!upsertError) {
        setWeight('')
        setWeightSaved(true)
        setTimeout(() => setWeightSaved(false), 2500)
      }
    }
    setWeightBusy(false)
  }

  async function toggleDayClosed() {
    if (!data) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const flags = new Set(data.day?.flags ?? [])
    const closing = !flags.has('dia_fechado')
    if (closing) flags.add('dia_fechado')
    else flags.delete('dia_fechado')
    // Só a marca muda aqui; a cron das 04:30 recalcula o resto do dia.
    await supabase.from('days').upsert(
      {
        user_id: user.id,
        date: data.date,
        flags: [...flags],
        is_complete: closing,
      },
      { onConflict: 'user_id,date' },
    )
    await load()
  }

  if (error) {
    return <p className="pt-8 text-center text-sm text-warn">{error}</p>
  }
  if (!data) {
    return <p className="pt-8 text-center text-sm text-dim">A carregar…</p>
  }

  const { profile, meals, day, yesterday } = data
  const dayClosed = day?.flags?.includes('dia_fechado') ?? false
  const kcalIn = meals.reduce((acc, m) => acc + Number(m.kcal), 0)
  const proteinIn = meals.reduce((acc, m) => acc + Number(m.protein), 0)
  const kcalTarget = day ? day.kcal_target : profile.base_kcal
  const kcalLeft = Math.round(kcalTarget - kcalIn)
  const proteinLeft = Math.round(profile.protein_g - proteinIn)
  const estimatedCount = meals.filter((m) => m.is_estimate).length

  return (
    <div className="mx-auto max-w-md space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-edge bg-card p-4 text-center">
          <p className={`text-4xl font-bold ${kcalLeft < 0 ? 'text-warn' : 'text-ink'}`}>
            {Math.abs(kcalLeft)}
          </p>
          <p className="mt-1 text-xs text-dim">
            {kcalLeft >= 0 ? 'kcal em falta' : 'kcal acima da meta'}
          </p>
        </div>
        <div className="rounded-2xl border border-edge bg-card p-4 text-center">
          <p className={`text-4xl font-bold ${proteinLeft <= 0 ? 'text-ok' : 'text-ink'}`}>
            {Math.max(0, proteinLeft)}
          </p>
          <p className="mt-1 text-xs text-dim">g de proteína em falta</p>
        </div>
      </div>

      {day && day.kcal_exercise > 0 && (
        <p className="text-center text-xs text-dim">
          meta de hoje: {kcalTarget} kcal ({profile.base_kcal} + {day.kcal_exercise} de treino)
        </p>
      )}

      {yesterday?.flags?.includes('chao') && (
        <p className="rounded-xl border border-warn/40 bg-card px-4 py-3 text-sm text-warn">
          A média dos últimos 7 dias completos está abaixo do chão ({profile.kcal_floor_week} kcal).
          Come um pouco mais.
        </p>
      )}
      {yesterday && !yesterday.is_complete && (
        <p className="rounded-xl border border-edge bg-card px-4 py-3 text-sm text-dim">
          Ontem ficou incompleto (menos de 2 refeições ou &lt; 800 kcal) — não conta para as médias.
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-dim">Refeições</h2>
        {meals.length === 0 && <p className="text-sm text-dim">Ainda nada registado hoje.</p>}
        {meals.map((meal) => {
          const proteinOk = Number(meal.protein) >= profile.protein_per_meal_g
          const time = new Date(meal.logged_at).toLocaleTimeString('pt-PT', {
            timeZone: 'Europe/Lisbon',
            hour: '2-digit',
            minute: '2-digit',
          })
          return (
            <div
              key={meal.id}
              className="flex items-center justify-between rounded-xl border border-edge bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm">
                  {meal.items.map((i) => i.name).join(', ') || meal.raw_text || 'Refeição'}
                </p>
                <p className="text-xs text-dim">
                  {time}
                  {meal.is_estimate && ' · estimada'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">{Math.round(Number(meal.kcal))} kcal</p>
                <p className={`text-xs ${proteinOk ? 'text-ok' : 'text-dim'}`}>
                  {Math.round(Number(meal.protein))} g prot.
                </p>
              </div>
            </div>
          )
        })}
        {estimatedCount > 0 && (
          <p className="text-xs text-dim">
            {estimatedCount} de {meals.length} refeições estimadas
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-edge bg-card p-4">
        <h2 className="text-sm font-semibold text-dim">Peso de hoje</h2>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            placeholder="kg"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-edge bg-bg px-3 py-2 text-ink placeholder:text-dim focus:border-accent focus:outline-none"
          />
          <button
            disabled={weightBusy || !weight.trim()}
            onClick={() => void saveWeight()}
            className="rounded-xl bg-accent px-4 py-2 font-semibold text-bg disabled:opacity-50"
          >
            {weightSaved ? '✓' : 'Guardar'}
          </button>
        </div>
      </div>

      <button
        onClick={() => void toggleDayClosed()}
        className={`w-full rounded-2xl border py-3 text-sm font-semibold ${
          dayClosed ? 'border-ok/50 text-ok' : 'border-edge text-dim'
        }`}
      >
        {dayClosed ? 'Dia fechado ✓ (tocar para reabrir)' : 'Fechar o dia'}
      </button>

      <button className="w-full py-2 text-center text-xs text-dim" onClick={() => void load()}>
        Atualizar
      </button>
    </div>
  )
}
