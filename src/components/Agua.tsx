import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useDataVersion } from '../lib/events'
import { GLASS_ML, waterGoalMl } from '../../api/_lib/rules/extras'

const liters = (ml: number) => (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2).replace(/0$/, '').replace('.', ',')

// Hoje › Água: um toque por copo (250 ml), meta de 35 ml por kg. Guarda em
// days.water_ml (migração 12); o fecho do dia não lhe mexe.
export default function Agua({ date }: { date: string }) {
  const toast = useToast()
  const [ml, setMl] = useState<number | null>(null)
  const [goal, setGoal] = useState(2000)
  // Os copos mudam logo no ecrã (vários toques seguidos contam todos) e a
  // gravação segue por ordem: a última a chegar é sempre a do último toque.
  const saving = useRef<Promise<void>>(Promise.resolve())
  // O que está gravado e quantos toques faltam gravar: uma falha só volta
  // atrás (para o gravado) quando já não há outro toque a caminho.
  const saved = useRef(0)
  const pending = useRef(0)
  // Cada toque conta: uma leitura que começou antes de um toque já não serve.
  const taps = useRef(0)
  // Copos juntados noutro sítio (a «Pergunta à app», Anular): volta a ler.
  const version = useDataVersion()

  useEffect(() => {
    // Com um toque a gravar, o que está no ecrã é o mais recente.
    if (pending.current > 0) return
    let alive = true
    const tapsAtStart = taps.current
    void Promise.all([
      supabase.from('days').select('water_ml').eq('date', date).maybeSingle(),
      supabase.from('weights').select('kg').lte('date', date).order('date', { ascending: false }).limit(1),
    ]).then(([day, weight]) => {
      if (!alive || taps.current !== tapsAtStart) return
      // Sem a migração 12 a coluna não existe: o cartão não aparece.
      if (day.error) return setMl(null)
      saved.current = Number(day.data?.water_ml ?? 0)
      setMl(saved.current)
      setGoal(waterGoalMl(weight.data?.[0]?.kg != null ? Number(weight.data[0].kg) : null))
    })
    return () => {
      alive = false
    }
  }, [date, version])

  async function change(delta: number) {
    if (ml == null) return
    const next = Math.max(0, ml + delta)
    setMl(next)
    taps.current += 1
    pending.current += 1
    let ok = false
    saving.current = saving.current
      .then(async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { error } = await supabase
          .from('days')
          .upsert({ user_id: user.id, date, water_ml: next }, { onConflict: 'user_id,date' })
        if (!error) {
          ok = true
          saved.current = next
        }
      })
      .catch(() => undefined)
      .then(() => {
        pending.current -= 1
        if (ok || pending.current > 0) return
        setMl(saved.current)
        toast('Não consegui guardar a água.')
      })
    await saving.current
  }

  if (ml == null) return null
  const pct = Math.min(100, (ml / goal) * 100)
  return (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4" aria-label="Água">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="label">Água</p>
          <p className="text-[17px] tabular-nums">
            {liters(ml)} <span className="text-dim">de {liters(goal)} L</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            disabled={ml === 0}
            onClick={() => void change(-GLASS_ML)}
            className="h-11 w-11 rounded-xl bg-surface2 text-[19px] disabled:opacity-40"
            aria-label="menos um copo"
          >
            −
          </button>
          <button onClick={() => void change(GLASS_ML)} className="h-11 rounded-xl bg-surface2 px-4 text-[15px]">
            + copo
          </button>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full bg-protein" style={{ width: `${pct}%` }} />
      </div>
    </section>
  )
}
