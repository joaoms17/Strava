import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDataVersion } from '../lib/events'
import { shiftDate } from '../lib/day'
import { proteinBySlot } from '../../api/_lib/rules/extras'
import { SLOTS, SLOT_LABEL, type Slot } from '../../api/_lib/rules/momentos'

// Balanço › Semana › «Proteína por refeição»: média dos últimos 14 dias em
// cada refeição, contra a proteína por refeição do perfil; destaca onde falta.
export default function ProteinaRefeicao({ today, perMeal }: { today: string; perMeal: number }) {
  const version = useDataVersion()
  const [rows, setRows] = useState<{ slot: Slot; avg: number; days: number }[] | null>(null)

  useEffect(() => {
    let alive = true
    void supabase
      .from('meals_counted')
      .select('date,slot,protein')
      .gte('date', shiftDate(today, -14))
      .lt('date', today)
      .then(({ data }) => {
        if (alive) setRows(proteinBySlot((data ?? []) as { date: string; slot: Slot | null; protein: number | null }[]))
      })
    return () => {
      alive = false
    }
  }, [today, version])

  if (!rows || rows.length === 0) return null
  const ordered = SLOTS.map((s) => rows.find((r) => r.slot === s)).filter((r): r is NonNullable<typeof r> => r != null)
  const main = ordered.filter((r) => r.slot !== 'ceia' && r.slot !== 'lanche')
  const weakest = main.length ? main.reduce((a, b) => (b.avg < a.avg ? b : a)) : null
  const max = Math.max(perMeal, ...ordered.map((r) => r.avg))

  return (
    <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4" aria-label="Proteína por refeição">
      <div className="flex items-baseline justify-between">
        <p className="label">Proteína por refeição</p>
        <p className="text-[13px] text-dim">média de 14 dias</p>
      </div>
      <div className="space-y-2">
        {ordered.map((r) => (
          <div key={r.slot} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-[14px]">
            <span className={r === weakest && r.avg < perMeal ? 'font-semibold text-attn' : ''}>{SLOT_LABEL[r.slot]}</span>
            <div className="relative h-2 rounded-full bg-surface2">
              <div
                className={`h-full rounded-full ${r.avg >= perMeal ? 'bg-protein' : 'bg-protein/50'}`}
                style={{ width: `${(r.avg / max) * 100}%` }}
              />
              <div className="absolute top-[-3px] h-[14px] w-0.5 bg-ink/60" style={{ left: `${(perMeal / max) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums">{r.avg} g</span>
          </div>
        ))}
      </div>
      {weakest && weakest.avg < perMeal && (
        <p className="text-[14px] text-dim">
          É no {SLOT_LABEL[weakest.slot].toLowerCase()} que falta: {weakest.avg} g em média, o alvo é {perMeal} g por refeição.
        </p>
      )}
    </section>
  )
}
