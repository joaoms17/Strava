import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../lib/day'
import { fmtDayMonth, fmtInt, fmtKcal } from '../lib/format'
import type { LongDay } from '../lib/balanco'
import type { HealthRow } from '../lib/balanco-semana'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { intakeLinks, type IntakeLink } from '../../api/_lib/rules/extras'
import { fmtSleep } from '../../api/_lib/rules/sono'
import type { MealItem } from '../lib/types'

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Balanço › Mês: passos e sono das últimas 5 semanas (e o que se comeu
// depois de noites más ou com poucos passos) e os 10 alimentos que mais se
// repetem. Os dias e o relógio vêm do Balanço (lidos uma vez para a página,
// P1b); aqui só se lêem os itens das refeições. O comido contra o gasto de
// cada semana está em «Semana a semana», por cima (B17: era a mesma conta
// desenhada duas vezes).
export default function BalancoMes({ today, days, health }: { today: string; days: LongDay[]; health: HealthRow[] }) {
  const [foods, setFoods] = useState<{ name: string; count: number; kcal: number }[]>([])

  const first = shiftDate(mondayOf(today), -28)
  const weeks = useMemo(() => {
    const mondays = Array.from({ length: 5 }, (_, i) => shiftDate(first, i * 7))
    return mondays.map((monday) => {
      const sunday = shiftDate(monday, 6)
      const h = health.filter((x) => x.date >= monday && x.date <= sunday)
      return {
        monday,
        steps: mean(h.filter((x) => x.steps != null).map((x) => Number(x.steps))),
        sleep: mean(h.filter((x) => x.sleep_minutes != null).map((x) => Number(x.sleep_minutes))),
        sleepScore: mean(h.filter((x) => x.sleep_score != null).map((x) => Number(x.sleep_score))),
      }
    })
  }, [health, first])
  const links = useMemo(
    () =>
      intakeLinks(
        days
          .filter((d) => d.date >= first && d.date <= today && d.is_complete && !d.flags.includes('faltou_algo'))
          .map((d) => ({ date: d.date, kcal_in: Number(d.kcal_in) })),
        health.filter((h) => h.date >= first) as Parameters<typeof intakeLinks>[1],
      ),
    [days, health, first, today],
  )

  // `days` muda quando os dados mudam (a versão já está nele): um pedido só.
  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('items')
      .gte('date', shiftDate(today, -30))
      .lte('date', today)
      .then(({ data: meals, error }) => {
        if (!alive || error) return
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
      })
    return () => {
      alive = false
    }
  }, [today, days])

  const withSteps = weeks.filter((w) => w.steps != null || w.sleep != null)
  const compared = (link: IntakeLink) =>
    Math.abs(link.diff) < 100
      ? 'comeste mais ou menos o mesmo que nos outros dias'
      : `comeste em média ${fmtInt(Math.abs(link.diff))} kcal ${link.diff > 0 ? 'a mais' : 'a menos'} do que nos outros dias`
  const linkLines = [
    links.sleep ? `Depois de noites más (menos de 6 h ou sono fraco), ${compared(links.sleep)}.` : null,
    links.steps ? `Nos dias com menos de ${fmtInt(links.steps.below)} passos, ${compared(links.steps)}.` : null,
  ].filter((l): l is string => l != null)

  return (
    <div className="space-y-4">
      {withSteps.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4 text-[15px]">
          <div className="flex items-baseline justify-between">
            <p className="label">Passos e sono</p>
            <p className="text-[13px] text-dim">média de cada semana</p>
          </div>
          {withSteps.map((w) => (
            <p key={w.monday} className="flex justify-between gap-3 tabular-nums">
              <span className="shrink-0 text-dim">
                {fmtDayMonth(w.monday)}
                {w.monday === mondayOf(today) ? ' (a meio)' : ''}
              </span>
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
