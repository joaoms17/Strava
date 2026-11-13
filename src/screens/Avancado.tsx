import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getApi } from '../lib/api'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { useReadyProfile, useProfile } from '../lib/profile'
import { fmtInt } from '../lib/format'
import { USD_TO_EUR, kindLabel, nearMonthlyCap } from '../../api/_lib/rules/custos'
import { DEFERRED_MIGRATIONS } from '../../api/_lib/rules/esquema'
import type { CatalogExercise } from '../lib/types'
import AiCheck from '../components/AiCheck'
import AvisoNoite from '../components/AvisoNoite'

// Só os tipos de chamada que a app ainda faz (L4); um antigo que ainda esteja
// no mês conta em «outros pedidos».
const KIND_LABEL: Record<string, string> = {
  meal_photo: 'fotos',
  meal_text: 'refeições por texto',
  meal_correct: 'correções',
  meal_leftovers: 'fotos do que sobrou',
  label_read: 'rótulos',
  recipe: 'receitas',
  menu_pick: 'menus',
  workout_shot: 'prints do relógio',
  workout_said: 'treinos ditos',
  workout_said_audio: 'treinos ditos (áudio)',
  evolution: 'análises da evolução',
  ask: 'perguntas à app',
  ai_check: 'verificações',
  weekly_review: 'resumos',
}

// Pedidos de hoje (a casa conta-se no servidor: cada pessoa só lê os seus).
interface AiUsage {
  provider: 'gemini' | 'anthropic'
  sharedDaily: boolean
  monthlyEur: boolean
  today: { house: number; mine: number; housePhotos: number; minePhotos: number }
}

// As chamadas do mês, por páginas de 1 000 (o máximo que a API devolve por
// pedido; S3): sem `order` cada página seria arbitrária.
const CALLS_PAGE = 1000
async function monthCalls(from: string): Promise<{ kind: string; cost_usd: number | string }[]> {
  const all: { kind: string; cost_usd: number | string }[] = []
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('api_calls')
      .select('kind,cost_usd')
      .gte('created_at', from)
      .order('created_at')
      .order('id')
      .range(page * CALLS_PAGE, page * CALLS_PAGE + CALLS_PAGE - 1)
    if (error) break
    all.push(...((data ?? []) as { kind: string; cost_usd: number | string }[]))
    if ((data ?? []).length < CALLS_PAGE) break
  }
  return all
}

// A soma do mês na base de dados (S3; migração 20261113000022). Sem a
// função (ou sem sessão), null: fica a soma das páginas.
async function monthTotal(from: string): Promise<number | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  const { data, error } = await supabase.rpc('ai_cost_since', { p_user_id: session.user.id, p_from: from })
  return !error && data != null && Number.isFinite(Number(data)) ? Number(data) : null
}

// O que é técnico ou pode causar ansiedade fica aqui, longe da vista.
export default function Avancado() {
  const profile = useReadyProfile()
  const { update, pendingMigrations } = useProfile()
  const toast = useToast()
  const [costs, setCosts] = useState<{ eur: number; usd: number; byKind: Record<string, number> } | null>(null)
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
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
      const from = monthStart.toISOString()
      const [total, calls, { data: exercises }] = await Promise.all([
        monthTotal(from),
        monthCalls(from),
        supabase.from('exercise_catalog').select('*').order('name'),
      ])
      const byKind: Record<string, number> = {}
      let summed = 0
      for (const call of calls) {
        summed += Number(call.cost_usd)
        const label = KIND_LABEL[call.kind] ?? 'outros pedidos'
        byKind[label] = (byKind[label] ?? 0) + 1
      }
      const usd = total ?? summed
      setCosts({ eur: usd * USD_TO_EUR, usd, byKind })
      setCatalog((exercises ?? []) as CatalogExercise[])
    }
    void load()
    void getApi<AiUsage>('/api/day/ai-usage')
      .then(setUsage)
      .catch(() => setUsageFailed(true))
  }, [])
  // Com o Gemini (plano gratuito) não há euros: só o número de pedidos.
  const euros = usage ? usage.monthlyEur : usageFailed

  function change(id: string, patch: Partial<CatalogExercise>) {
    setCatalog((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
    setDirty((prev) => new Set(prev).add(id))
  }

  async function saveCatalog() {
    let failed = false
    for (const exercise of catalog.filter((e) => dirty.has(e.id))) {
      const { error } = await supabase
        .from('exercise_catalog')
        .update({ rep_min: exercise.rep_min, rep_max: exercise.rep_max })
        .eq('id', exercise.id)
      if (error) failed = true
    }
    setDirty(new Set())
    toast(failed ? 'Não consegui guardar tudo.' : 'Exercícios guardados.')
  }

  const field = 'h-11 w-12 rounded-lg border border-line bg-bg text-center tabular-nums focus:border-eat focus:outline-none'

  return (
    <div className="space-y-6 pt-1 pb-4">
      <AvisoNoite />
      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold">A IA está a funcionar?</h2>
        <p className="text-[0.875rem] text-dim">
          Faz uma chamada mínima a cada modelo com a chave que está no Vercel (menos de 0,1 cêntimo).
        </p>
        <AiCheck />
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold">{euros ? 'Custos da IA' : 'Uso da IA'}</h2>
        {usage && (
          <p className="text-[0.9375rem] tabular-nums">
            Pedidos à IA hoje:{' '}
            {usage.sharedDaily
              ? `casa ${fmtInt(usage.today.house)} (fotos ${fmtInt(usage.today.housePhotos)}) · tu ${fmtInt(usage.today.mine)} (fotos ${fmtInt(usage.today.minePhotos)})`
              : `${fmtInt(usage.today.mine)} (fotos ${fmtInt(usage.today.minePhotos)})`}
          </p>
        )}
        {usage?.sharedDaily && (
          <p className="text-[0.8125rem] text-dim">
            Com o Gemini (plano gratuito) a chave é uma só para a casa: não há custos, mas os pedidos de todos contam para
            o mesmo limite diário da Google. Quando o modelo das fotos chega ao limite, as fotos são lidas pelo de reserva
            e a refeição avisa.
          </p>
        )}
        {costs ? (
          <>
            {euros && (
              <p className="text-[0.9375rem] tabular-nums">
                Este mês: cerca de {costs.eur.toFixed(2).replace('.', ',')} €
              </p>
            )}
            <p className="text-[0.8125rem] text-dim">
              {euros ? '' : 'Este mês: '}
              {Object.entries(costs.byKind)
                .map(([label, n]) => `${fmtInt(n)} ${kindLabel(label, n)}`)
                .join(' · ') || 'Nenhuma chamada este mês.'}
            </p>
            {euros && nearMonthlyCap(costs.usd, Number(profile.ai_monthly_cap_eur ?? 10)) && (
              <p className="text-[0.8125rem] text-attn">Estás perto do limite mensal que definiste.</p>
            )}
          </>
        ) : (
          <p className="text-[0.9375rem] text-dim">A carregar…</p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold">Limites da IA</h2>
        <p className="text-[0.8125rem] text-dim">
          Ao chegar ao limite, as fotos ficam guardadas sem análise e podes analisá-las à mesma. Nunca pergunto antes de
          cada foto.
        </p>
        {euros && (
          <label className="flex items-center justify-between gap-3 text-[0.9375rem]">
            <span>Limite mensal (€)</span>
            <input
              inputMode="decimal"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
            />
          </label>
        )}
        <label className="flex items-center justify-between gap-3 text-[0.9375rem]">
          <span>{usage?.sharedDaily ? 'Análises de fotos por dia (a casa toda)' : 'Análises de fotos por dia'}</span>
          <input
            inputMode="numeric"
            value={visionCap}
            onChange={(e) => setVisionCap(e.target.value.replace(/\D/g, ''))}
            className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
          />
        </label>
        <BusyButton
          busy="A guardar…"
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
          className="min-h-11 w-full rounded-xl bg-cta font-semibold text-on-cta"
        >
          Guardar limites
        </BusyButton>
      </section>

      <section className="space-y-3 rounded-2xl bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold">Mínimo da semana</h2>
        <p className="text-[0.8125rem] text-dim">
          Se a média da semana ficar abaixo deste valor, o Balanço avisa para comeres um pouco mais.
        </p>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={floor}
            onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))}
            className="h-11 flex-1 rounded-xl border border-line bg-bg px-3 tabular-nums focus:border-eat focus:outline-none"
          />
          <BusyButton
            busy="A guardar…"
            onClick={async () => {
              const n = Number(floor)
              if (n < 1000 || n > 3000) {
                toast('Entre 1 000 e 3 000.')
                return
              }
              toast((await update({ kcal_floor_week: n })) ? 'Guardado.' : 'Não consegui guardar.')
            }}
            className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta"
          >
            Guardar
          </BusyButton>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[0.9375rem] font-semibold">Repetições por exercício</h2>
        <p className="text-[0.8125rem] text-dim">As repetições (mínimo e máximo) que o ginásio propõe nos teus exercícios.</p>
        {catalog.map((exercise) => (
          <div key={exercise.id} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
            <span className="min-w-0 flex-1 truncate text-[0.9375rem]">
              {exercise.name}
            </span>
            <input
              inputMode="numeric"
              value={exercise.rep_min ?? ''}
              onChange={(e) => change(exercise.id, { rep_min: e.target.value ? Number(e.target.value) : null })}
              className={field}
              aria-label="repetições mínimas"
            />
            <span className="text-[0.8125rem] text-dim">–</span>
            <input
              inputMode="numeric"
              value={exercise.rep_max ?? ''}
              onChange={(e) => change(exercise.id, { rep_max: e.target.value ? Number(e.target.value) : null })}
              className={field}
              aria-label="repetições máximas"
            />
          </div>
        ))}
        <BusyButton
          busy="A guardar…"
          disabled={dirty.size === 0}
          onClick={saveCatalog}
          className="min-h-12 w-full rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-40"
        >
          Guardar exercícios
        </BusyButton>
      </section>

      <section className="space-y-2 rounded-2xl bg-surface p-4 text-[0.8125rem] text-dim">
        <h2 className="text-[0.9375rem] font-semibold text-ink">Versão</h2>
        <p>Daily Track · 6 funções no Vercel</p>
        {/* Ideia 6: com a tabela schema_version, as migrações que faltam (não param a app). */}
        {pendingMigrations.length > 0 && (
          <div className="space-y-1">
            <p>Por correr no SQL Editor do Supabase, por esta ordem:</p>
            <ul className="space-y-1">
              {pendingMigrations.map((file) => (
                <li key={file}>
                  <code className="break-all text-ink">supabase/migrations/{file}</code>
                  {DEFERRED_MIGRATIONS[file] && <span> — {DEFERRED_MIGRATIONS[file]}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
