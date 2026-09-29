import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { useReadyProfile, useProfile } from '../lib/profile'
import { fmtInt } from '../lib/format'
import { USD_TO_EUR, nearMonthlyCap } from '../../api/_lib/rules/custos'
import type { CatalogExercise } from '../lib/types'

const KIND_LABEL: Record<string, string> = {
  meal_parse_text: 'refeições por texto',
  meal_parse_photo: 'fotos',
  meal_photo: 'fotos',
  meal_text: 'refeições por texto',
  meal_correct: 'correções',
  plan_generate: 'planos',
  weekly_review: 'resumos',
}

// O que é técnico ou pode causar ansiedade fica aqui, longe da vista.
export default function Avancado() {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const [costs, setCosts] = useState<{ eur: number; usd: number; byKind: Record<string, number> } | null>(null)
  const [cap, setCap] = useState(String(profile.ai_monthly_cap_eur ?? 10))
  const [visionCap, setVisionCap] = useState(String(profile.ai_daily_vision_cap ?? 40))
  const [catalog, setCatalog] = useState<CatalogExercise[]>([])
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [floor, setFloor] = useState(String(profile.kcal_floor_week))

  useEffect(() => {
    async function load() {
      const monthStart = new Date()
      monthStart.setUTCDate(1)
      monthStart.setUTCHours(0, 0, 0, 0)
      const [{ data: calls }, { data: exercises }] = await Promise.all([
        supabase.from('api_calls').select('kind,cost_usd').gte('created_at', monthStart.toISOString()),
        supabase.from('exercise_catalog').select('*').order('knee_safe', { ascending: false }).order('name'),
      ])
      const byKind: Record<string, number> = {}
      let usd = 0
      for (const call of calls ?? []) {
        usd += Number(call.cost_usd)
        const label = KIND_LABEL[call.kind as string] ?? (call.kind as string)
        byKind[label] = (byKind[label] ?? 0) + 1
      }
      setCosts({ eur: usd * USD_TO_EUR, usd, byKind })
      setCatalog((exercises ?? []) as CatalogExercise[])
    }
    void load()
  }, [])

  function change(id: string, patch: Partial<CatalogExercise>) {
    setCatalog((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    setDirty((prev) => new Set(prev).add(id))
  }

  async function saveCatalog() {
    let failed = false
    for (const exercise of catalog.filter((e) => dirty.has(e.id))) {
      const { error } = await supabase
        .from('exercise_catalog')
        .update({ knee_safe: exercise.knee_safe, rep_min: exercise.rep_min, rep_max: exercise.rep_max })
        .eq('id', exercise.id)
      if (error) failed = true
    }
    setDirty(new Set())
    toast(failed ? 'Não consegui guardar tudo.' : 'Exercícios guardados.')
  }

  const field = 'h-10 w-12 rounded-lg border border-line bg-bg text-center tabular-nums focus:border-eat focus:outline-none'

  return (
    <div className="space-y-6 pt-1 pb-4">
      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Custos da IA</h2>
        {costs ? (
          <>
            <p className="text-[15px] tabular-nums">
              Este mês cerca de {costs.eur.toFixed(2).replace('.', ',')} € (aprox.)
            </p>
            <p className="text-[13px] text-dim">
              {Object.entries(costs.byKind)
                .map(([label, n]) => `${fmtInt(n)} ${label}`)
                .join(' · ') || 'Nenhuma chamada este mês.'}
            </p>
            {nearMonthlyCap(costs.usd, Number(profile.ai_monthly_cap_eur ?? 10)) && (
              <p className="text-[13px] text-attn">Estás perto do limite mensal que definiste.</p>
            )}
          </>
        ) : (
          <p className="text-[15px] text-dim">A carregar…</p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Limites da IA</h2>
        <p className="text-[13px] text-dim">
          Ao chegar ao limite, as fotos ficam guardadas sem análise e podes analisá-las à mesma. Nunca pergunto antes de
          cada foto.
        </p>
        <label className="flex items-center justify-between gap-3 text-[15px]">
          <span>Limite mensal (€)</span>
          <input
            inputMode="decimal"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-[15px]">
          <span>Análises de fotos por dia</span>
          <input
            inputMode="numeric"
            value={visionCap}
            onChange={(e) => setVisionCap(e.target.value.replace(/\D/g, ''))}
            className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
          />
        </label>
        <button
          onClick={async () => {
            const eur = Number(cap.replace(',', '.'))
            const perDay = Number(visionCap)
            if (!Number.isFinite(eur) || eur < 0 || eur > 500 || !Number.isInteger(perDay) || perDay < 1 || perDay > 500) {
              toast('Limites fora do normal. Confirma os valores.')
              return
            }
            toast(
              (await update({ ai_monthly_cap_eur: eur, ai_daily_vision_cap: perDay })) ? 'Guardado.' : 'Não consegui guardar.',
            )
          }}
          className="min-h-11 w-full rounded-xl bg-eat font-semibold text-bg"
        >
          Guardar limites
        </button>
      </section>

      <section className="space-y-3 rounded-2xl bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Mínimo da semana</h2>
        <p className="text-[13px] text-dim">
          Se a média da semana ficar abaixo deste valor, o Balanço avisa para comeres um pouco mais.
        </p>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={floor}
            onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))}
            className="h-11 flex-1 rounded-xl border border-line bg-bg px-3 tabular-nums focus:border-eat focus:outline-none"
          />
          <button
            onClick={async () => {
              const n = Number(floor)
              if (n < 1000 || n > 3000) {
                toast('Entre 1 000 e 3 000.')
                return
              }
              toast((await update({ kcal_floor_week: n })) ? 'Guardado.' : 'Não consegui guardar.')
            }}
            className="min-h-11 rounded-xl bg-eat px-4 font-semibold text-bg"
          >
            Guardar
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[15px] font-semibold">Exercícios seguros para o joelho</h2>
        <p className="text-[13px] text-dim">
          Só os marcados entram no plano de ginásio. Confirma com o fisioterapeuta quando puderes.
        </p>
        {catalog.map((exercise) => (
          <div key={exercise.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
            <input
              type="checkbox"
              checked={exercise.knee_safe}
              onChange={(e) => change(exercise.id, { knee_safe: e.target.checked })}
              className="h-5 w-5 shrink-0 accent-[var(--color-eat)]"
              aria-label={`${exercise.name} seguro para o joelho`}
            />
            <span className={`min-w-0 flex-1 truncate text-[15px] ${exercise.knee_safe ? '' : 'text-dim line-through'}`}>
              {exercise.name}
            </span>
            <input
              inputMode="numeric"
              value={exercise.rep_min ?? ''}
              onChange={(e) => change(exercise.id, { rep_min: e.target.value ? Number(e.target.value) : null })}
              className={field}
              aria-label="repetições mínimas"
            />
            <span className="text-[13px] text-dim">–</span>
            <input
              inputMode="numeric"
              value={exercise.rep_max ?? ''}
              onChange={(e) => change(exercise.id, { rep_max: e.target.value ? Number(e.target.value) : null })}
              className={field}
              aria-label="repetições máximas"
            />
          </div>
        ))}
        <button
          disabled={dirty.size === 0}
          onClick={() => void saveCatalog()}
          className="min-h-12 w-full rounded-xl bg-eat font-semibold text-bg disabled:opacity-40"
        >
          Guardar exercícios
        </button>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4 text-[13px] text-dim">
        <h2 className="text-[15px] font-semibold text-ink">Calendário (.ics)</h2>
        <p>
          O plano de 4 semanas saiu da app e o calendário deixou de existir. Se o subscreveste no iPhone, remove-o
          em Definições › Calendário › Contas › Calendários subscritos.
        </p>
        <h2 className="pt-2 text-[15px] font-semibold text-ink">Versão</h2>
        <p>Regresso · redesenho fase 5 · 5 funções no Vercel</p>
      </section>
    </div>
  )
}
