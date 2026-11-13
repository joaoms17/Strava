import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { supabase } from '../lib/supabase'
import { shiftDate } from '../lib/day'
import { fmtInt, fmtKcal } from '../lib/format'
import type { LongDay } from '../lib/balanco'
import type { HealthRow } from '../lib/balanco-semana'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { intakeLinks, type IntakeLink } from '../../api/_lib/rules/extras'
import type { MealItem } from '../lib/types'

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Balanço › Mês: o que se comeu depois de noites más ou com poucos passos
// e os 10 alimentos que mais se repetem. Os passos e o sono de cada semana
// estão no Corpo › Recuperação e no Hoje (B17: apareciam em 3 sítios). Os
// dias e o relógio vêm do Balanço (lidos uma vez para a página, P1b); aqui
// só se lêem os itens das refeições. O comido contra o gasto de
// cada semana está em «Semana a semana», por cima (B17: era a mesma conta
// desenhada duas vezes).
export default function BalancoMes({ today, days, health }: { today: string; days: LongDay[]; health: HealthRow[] }) {
  const [foods, setFoods] = useState<{ name: string; count: number; kcal: number }[]>([])
  const [, navigate] = useLocation()

  const first = shiftDate(mondayOf(today), -28)
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
      {linkLines.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4 text-[0.9375rem]">
          <p className="label">O que comes, o sono e os passos</p>
          {linkLines.map((line) => (
            <p key={line} className="text-dim">
              {line}
            </p>
          ))}
          <button onClick={() => navigate('/corpo?ver=recuperacao')} className="min-h-11 text-eat">
            Passos e sono de cada dia: Corpo › Recuperação ›
          </button>
        </section>
      )}

      {foods.length > 0 && (
        <section className="space-y-1 rounded-[18px] border border-line bg-surface p-4">
          <p className="label">Os 10 alimentos mais frequentes (30 dias)</p>
          <ol className="divide-y divide-line/60">
            {foods.map((f, i) => (
              <li key={f.name} className="flex items-center gap-3 py-2 text-[0.9375rem]">
                <span className="num w-6 text-dim">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-[0.875rem] text-dim tabular-nums">
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
