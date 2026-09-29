import { useCallback, useEffect, useState } from 'react'
import { Bar as RBar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { useThemeColors } from '../lib/colors'
import { useDataVersion } from '../lib/events'
import { shiftDate } from '../lib/day'
import { fmt1, fmtDayMonth, fmtInt, fmtKcal } from '../lib/format'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import type { MealItem } from '../lib/types'

interface Week {
  monday: string
  eaten: number | null
  out: number | null
  tdee: number | null
  steps: number | null
  sleep: number | null
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Balanço › Mês: as últimas 5 semanas (comeu contra gasto, só dias
// completos), o gasto medido ao longo do tempo, passos e sono, e os 10
// alimentos que mais se repetem.
export default function BalancoMes({ today }: { today: string }) {
  const colors = useThemeColors()
  const version = useDataVersion()
  const [weeks, setWeeks] = useState<Week[] | null>(null)
  const [foods, setFoods] = useState<{ name: string; count: number; kcal: number }[]>([])

  const load = useCallback(async () => {
    const first = shiftDate(mondayOf(today), -28)
    const [{ data: days }, { data: health }, { data: meals }] = await Promise.all([
      supabase
        .from('days')
        .select('date,kcal_in,kcal_out_est,is_complete,tdee_est,flags')
        .gte('date', first)
        .lte('date', today)
        .order('date'),
      supabase.from('health_daily').select('date,steps,sleep_minutes').gte('date', first).lte('date', today),
      supabase.from('meals_counted').select('items').gte('date', shiftDate(today, -30)).lte('date', today),
    ])
    const list: Week[] = []
    for (let i = 0; i < 5; i++) {
      const monday = shiftDate(first, i * 7)
      const sunday = shiftDate(monday, 6)
      const inWeek = (days ?? []).filter((d) => d.date >= monday && d.date <= sunday)
      const complete = inWeek.filter((d) => d.is_complete && !((d.flags as string[] | null) ?? []).includes('faltou_algo'))
      const h = (health ?? []).filter((x) => x.date >= monday && x.date <= sunday)
      const tdees = inWeek.filter((d) => d.tdee_est != null).map((d) => Number(d.tdee_est))
      list.push({
        monday,
        eaten: mean(complete.map((d) => Number(d.kcal_in))),
        out: mean(complete.filter((d) => d.kcal_out_est != null).map((d) => Number(d.kcal_out_est))),
        tdee: tdees.length ? tdees[tdees.length - 1]! : null,
        steps: mean(h.filter((x) => x.steps != null).map((x) => Number(x.steps))),
        sleep: mean(h.filter((x) => x.sleep_minutes != null).map((x) => Number(x.sleep_minutes))),
      })
    }
    setWeeks(list)

    const counts = new Map<string, { name: string; count: number; kcal: number }>()
    for (const meal of (meals ?? []) as { items: MealItem[] }[]) {
      for (const item of meal.items ?? []) {
        if (!item.name || item.name === 'Registo rápido') continue
        const key = normalize(item.name)
        const entry = counts.get(key) ?? { name: item.name, count: 0, kcal: 0 }
        entry.count++
        entry.kcal += Number(item.kcal ?? 0)
        counts.set(key, entry)
      }
    }
    setFoods(
      [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((f) => ({ ...f, kcal: f.kcal / f.count })),
    )
  }, [today])

  useEffect(() => {
    void load()
  }, [load, version])

  if (!weeks) return <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
  const chart = weeks.map((w) => ({
    label: fmtDayMonth(w.monday),
    eaten: w.eaten != null ? Math.round(w.eaten) : null,
    out: w.out != null ? Math.round(w.out) : null,
    tdee: w.tdee,
  }))
  const withSteps = weeks.filter((w) => w.steps != null || w.sleep != null)

  return (
    <div className="space-y-4">
      {weeks.every((w) => w.eaten == null) ? (
        <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
          Com alguns dias completos, aqui aparecem as tuas semanas lado a lado.
        </p>
      ) : (
        <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
          <p className="label">Por semana (dias completos)</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.line} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: colors.dim, fontSize: 12 }} axisLine={{ stroke: colors.line }} tickLine={false} />
                <YAxis tick={{ fill: colors.dim, fontSize: 12 }} tickFormatter={(v: number) => fmtInt(v)} axisLine={false} tickLine={false} width={48} />
                <RBar dataKey="eaten" fill={colors.eat} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line dataKey="out" stroke={colors.burn} strokeWidth={2.5} dot={{ r: 3, fill: colors.burn, stroke: 'none' }} connectNulls isAnimationActive={false} />
                <Line dataKey="tdee" stroke={colors.dim} strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-dim">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-eat" /> comeste (média)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-burn" /> gasto (média)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-dim" /> gasto medido pelo peso
            </span>
          </div>
        </section>
      )}

      {withSteps.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4 text-[15px]">
          <p className="label">Passos e sono</p>
          {withSteps.map((w) => (
            <p key={w.monday} className="flex justify-between tabular-nums">
              <span className="text-dim">semana de {fmtDayMonth(w.monday)}</span>
              <span>
                {w.steps != null ? `${fmtInt(w.steps)} passos` : ''}
                {w.steps != null && w.sleep != null ? ' · ' : ''}
                {w.sleep != null ? `${fmt1(w.sleep / 60)} h de sono` : ''}
              </span>
            </p>
          ))}
        </section>
      )}

      {foods.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4">
          <p className="label">Os 10 alimentos mais frequentes (30 dias)</p>
          <ol className="divide-y divide-line/60">
            {foods.map((f, i) => (
              <li key={f.name} className="flex items-center gap-3 py-2 text-[15px]">
                <span className="num w-6 text-dim">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-[14px] text-dim tabular-nums">
                  {f.count}× · ≈ {fmtKcal(f.kcal)} kcal
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
