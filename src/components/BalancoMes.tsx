import { useCallback, useEffect, useState } from 'react'
import { Bar as RBar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../lib/day'
import { fmtDayMonth, fmtInt, fmtKcal } from '../lib/format'
import type { LongDay } from '../lib/balanco'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { intakeLinks, type IntakeLink } from '../../api/_lib/rules/extras'
import { niceScale } from '../../api/_lib/rules/graficos'
import { fmtSleep } from '../../api/_lib/rules/sono'
import { weeklyBalance } from '../../api/_lib/rules/balanco-graficos'
import { int } from '../../api/_lib/rules/leituras'
import type { MealItem } from '../lib/types'
import { ChartCard, Key, Legend, TICK, TipBox, axisInt, tooltipBase, useChartColors } from './charts/kit'

interface Week {
  monday: string
  eaten: number | null
  out: number | null
  tdee: number | null
  steps: number | null
  sleep: number | null
  sleepScore: number | null
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Balanço › Mês: as últimas 5 semanas (comeu contra gasto, só dias
// completos), o gasto medido ao longo do tempo, passos e sono (e o que se
// comeu depois de noites más ou com poucos passos), e os 10 alimentos que
// mais se repetem. Os dias vêm do Balanço (lidos uma vez para a página); o
// comido e o gasto de cada semana são os de «Semana a semana»
// (rules/balanco-graficos.ts › weeklyBalance: os mesmos dias completos até
// ontem), para a mesma semana não ter dois défices.
export default function BalancoMes({ today, days: given }: { today: string; days: LongDay[] | null }) {
  const colors = useChartColors()
  const [weeks, setWeeks] = useState<Week[] | null>(null)
  const [foods, setFoods] = useState<{ name: string; count: number; kcal: number }[]>([])
  const [links, setLinks] = useState<ReturnType<typeof intakeLinks> | null>(null)

  const load = useCallback(async () => {
    if (!given) return
    const first = shiftDate(mondayOf(today), -28)
    const days = given.filter((d) => d.date >= first && d.date <= today)
    const [{ data: health }, { data: meals }] = await Promise.all([
      supabase.from('health_daily').select('*').gte('date', first).lte('date', today),
      supabase.from('meals_counted').select('items').gte('date', shiftDate(today, -30)).lte('date', today),
    ])
    const mondays = Array.from({ length: 5 }, (_, i) => shiftDate(first, i * 7))
    const balance = weeklyBalance(days, [], mondays, today)
    const list: Week[] = []
    for (const [i, monday] of mondays.entries()) {
      const sunday = shiftDate(monday, 6)
      const inWeek = (days ?? []).filter((d) => d.date >= monday && d.date <= sunday)
      const h = (health ?? []).filter((x) => x.date >= monday && x.date <= sunday)
      const tdees = inWeek.filter((d) => d.tdee_est != null).map((d) => Number(d.tdee_est))
      list.push({
        monday,
        eaten: balance[i]!.eaten,
        out: balance[i]!.out,
        tdee: tdees.length ? tdees[tdees.length - 1]! : null,
        steps: mean(h.filter((x) => x.steps != null).map((x) => Number(x.steps))),
        sleep: mean(h.filter((x) => x.sleep_minutes != null).map((x) => Number(x.sleep_minutes))),
        sleepScore: mean(h.filter((x) => x.sleep_score != null).map((x) => Number(x.sleep_score))),
      })
    }
    setWeeks(list)
    setLinks(
      intakeLinks(
        (days ?? [])
          .filter((d) => d.is_complete && !((d.flags as string[] | null) ?? []).includes('faltou_algo'))
          .map((d) => ({ date: d.date as string, kcal_in: Number(d.kcal_in) })),
        (health ?? []) as Parameters<typeof intakeLinks>[1],
      ),
    )

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
  }, [today, given])

  // `given` muda quando os dados mudam (a versão já está nele): um pedido só.
  useEffect(() => {
    void load()
  }, [load])

  if (!weeks) return <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
  const both = weeks.filter((w) => w.eaten != null && w.out != null)
  const gap = both.length ? both.reduce((a, w) => a + w.eaten! - w.out!, 0) / both.length : null
  const reading =
    gap == null
      ? 'Ainda sem semanas com dias completos'
      : Math.abs(gap) < 50
        ? `Em ${both.length} semanas comeste cerca do que gastaste`
        : `Em ${both.length} semanas comeste em média ${int(Math.round(Math.abs(gap) / 10) * 10)} kcal por dia ${gap < 0 ? 'menos' : 'mais'} do que gastaste`
  const scale = niceScale(0, Math.max(1000, ...weeks.flatMap((w) => [w.eaten ?? 0, w.out ?? 0, w.tdee ?? 0])), 4)
  const chart = weeks.map((w) => ({
    label: fmtDayMonth(w.monday),
    eaten: w.eaten != null ? Math.round(w.eaten) : null,
    out: w.out != null ? Math.round(w.out) : null,
    tdee: w.tdee,
  }))
  const withSteps = weeks.filter((w) => w.steps != null || w.sleep != null)
  const compared = (link: IntakeLink) =>
    Math.abs(link.diff) < 100
      ? 'comeste mais ou menos o mesmo que nos outros dias'
      : `comeste em média ${fmtInt(Math.abs(link.diff))} kcal ${link.diff > 0 ? 'a mais' : 'a menos'} do que nos outros dias`
  const linkLines = [
    links?.sleep ? `Depois de noites más (menos de 6 h ou sono fraco), ${compared(links.sleep)}.` : null,
    links?.steps ? `Nos dias com menos de ${fmtInt(links.steps.below)} passos, ${compared(links.steps)}.` : null,
  ].filter((l): l is string => l != null)

  return (
    <div className="space-y-4">
      {weeks.every((w) => w.eaten == null) ? (
        <p className="rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
          Com alguns dias completos, aqui aparecem as tuas semanas lado a lado.
        </p>
      ) : (
        <ChartCard
          kicker="Por semana (dias completos)"
          reading={reading}
          legend={
            <Legend>
              <Key shape="bar" color={colors.eat} label="comeste (média)" />
              <Key shape="line" color={colors.burn} label="gasto (média)" />
              <Key shape="dash" color={colors.dim} label="gasto medido pelo peso" />
            </Legend>
          }
        >
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
                <CartesianGrid stroke={colors.grid} vertical={false} />
                <XAxis dataKey="label" tick={TICK(colors)} axisLine={{ stroke: colors.grid }} tickLine={false} />
                <YAxis domain={scale.domain} ticks={scale.ticks} tick={TICK(colors)} tickFormatter={axisInt} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  {...tooltipBase(colors)}
                  content={({ active, payload }) => {
                    const w = payload?.[0]?.payload as (typeof chart)[number] | undefined
                    if (!active || !w) return null
                    return (
                      <TipBox
                        title={`Semana de ${w.label}`}
                        rows={[
                          { label: 'comeste', value: w.eaten != null ? fmtInt(w.eaten) : '—' },
                          { label: 'gasto', value: w.out != null ? fmtInt(w.out) : '—', color: colors.burn },
                          { label: 'gasto medido', value: w.tdee != null ? fmtInt(w.tdee) : '—', color: colors.dim, dash: true },
                        ]}
                        colors={colors}
                      />
                    )
                  }}
                />
                <RBar dataKey="eaten" fill={colors.eat} radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false} />
                <Line dataKey="out" stroke={colors.burn} strokeWidth={1.5} dot={{ r: 2.5, fill: colors.burn, stroke: 'none' }} connectNulls isAnimationActive={false} />
                <Line dataKey="tdee" stroke={colors.dim} strokeDasharray="3 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {withSteps.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4 text-[15px]">
          <div className="flex items-baseline justify-between">
            <p className="label">Passos e sono</p>
            <p className="text-[13px] text-dim">média de cada semana</p>
          </div>
          {withSteps.map((w) => (
            <p key={w.monday} className="flex justify-between gap-3 tabular-nums">
              <span className="shrink-0 text-dim">{fmtDayMonth(w.monday)}</span>
              <span className="text-right">
                {w.steps != null ? `${fmtInt(w.steps)} passos` : ''}
                {w.steps != null && w.sleep != null ? ' · ' : ''}
                {w.sleep != null ? `${fmtSleep(Math.round(w.sleep))} de sono` : ''}
                {w.sleepScore != null ? ` · nota ${Math.round(w.sleepScore)}` : ''}
              </span>
            </p>
          ))}
          {linkLines.length > 0 && (
            <div className="space-y-1 border-t border-line pt-2 text-[14px] text-dim">
              {linkLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
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
