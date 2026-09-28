import { useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import { supabase } from '../lib/supabase'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { toCsv, downloadCsv } from '../lib/csv'
import { clearPin, getPinMode, hasPin, setPinMode, type PinMode } from '../lib/pin'
import type { Profile } from '../lib/types'

interface Field {
  key: keyof Profile & string
  label: string
  help?: string
  unit?: string
  min: number
  max: number
}

const GOALS: Field[] = [
  { key: 'height_cm', label: 'Altura', unit: 'cm', min: 120, max: 230 },
  { key: 'birth_year', label: 'Ano de nascimento', min: 1920, max: 2015 },
  { key: 'target_weight_kg', label: 'Peso-meta', unit: 'kg', min: 40, max: 200 },
  {
    key: 'base_kcal',
    label: 'Plano base por dia, sem treino',
    unit: 'kcal',
    help: 'O que podes comer num dia sem treino. Cada treino soma o que gastou.',
    min: 1000,
    max: 4000,
  },
  { key: 'protein_g', label: 'Proteína por dia', unit: 'g', min: 40, max: 300 },
  { key: 'protein_per_meal_g', label: 'Proteína por refeição principal', unit: 'g', min: 10, max: 80 },
]

const BIKE: Field[] = [
  { key: 'bike_hr_avg_cap', label: 'Batimentos médios máximos', unit: 'bpm', min: 80, max: 200 },
  { key: 'bike_hr_max_cap', label: 'Batimentos máximos', unit: 'bpm', min: 90, max: 220 },
  { key: 'bike_min_cadence', label: 'Rotações mínimas', unit: 'rpm', min: 50, max: 130 },
]

const EXPORT_TABLES: [string, string][] = [
  ['meals', 'refeicoes'],
  ['favorites', 'favoritos'],
  ['days', 'dias'],
  ['weights', 'pesagens'],
  ['workouts', 'treinos'],
  ['exercise_log', 'series'],
  ['foods', 'alimentos'],
  ['health_daily', 'saude'],
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-[13px] font-semibold text-dim">{title}</h2>
      <div className="space-y-3 rounded-2xl bg-surface p-4">{children}</div>
    </section>
  )
}

function Toggle({ label, help, value, onChange }: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-[15px]">{label}</span>
        {help && <span className="block text-[13px] text-dim">{help}</span>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-eat)]" />
    </label>
  )
}

function Choice<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid rounded-xl bg-surface2 p-1 text-[15px]" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`min-h-10 rounded-lg ${value === id ? 'bg-surface font-semibold' : 'text-dim'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

// Perfil, metas, bicicleta, aparência e dados — com etiquetas simples.
export default function Definicoes() {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const initial = (fields: Field[]) =>
    Object.fromEntries(fields.map((f) => [f.key, profile[f.key] != null ? String(profile[f.key]) : '']))
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initial(GOALS), ...initial(BIKE) }))
  const [watts, setWatts] = useState((profile.bike_watts_options ?? []).join(' · '))
  const [pinMode, setPinModeState] = useState<PinMode>(getPinMode())
  const [busy, setBusy] = useState(false)

  async function saveFields(fields: Field[]) {
    const patch: Record<string, number | null | number[]> = {}
    for (const field of fields) {
      const raw = values[field.key]?.trim().replace(',', '.') ?? ''
      if (!raw && field.key === 'birth_year') {
        patch[field.key] = null
        continue
      }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < field.min || n > field.max) {
        toast(`${field.label}: ${raw || 'vazio'}? Parece fora do normal. Confirma.`)
        return
      }
      patch[field.key] = n
    }
    if (fields === BIKE) {
      const options = watts
        .split(/[^\d]+/)
        .map(Number)
        .filter((n) => n >= 30 && n <= 500)
      if (options.length === 0) {
        toast('Escreve pelo menos uma potência, por exemplo 130 · 140 · 150.')
        return
      }
      patch.bike_watts_options = [...new Set(options)].sort((a, b) => a - b)
    }
    setBusy(true)
    const ok = await update(patch as Partial<Profile>)
    setBusy(false)
    toast(ok ? 'Guardado.' : 'Não consegui guardar. Tenta outra vez.')
  }

  async function exportTable(table: string, filename: string) {
    setBusy(true)
    const { data, error } = await supabase.from(table).select('*').limit(20_000)
    setBusy(false)
    if (error || !data) {
      toast(`Não consegui exportar ${filename}.`)
      return
    }
    downloadCsv(`${filename}.csv`, toCsv(data as Record<string, unknown>[]))
  }

  function numberInput(field: Field) {
    return (
      <label key={field.key} className="block space-y-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[15px]">{field.label}</span>
          <span className="flex items-center gap-1.5">
            <input
              inputMode="decimal"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="h-11 w-24 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
            />
            {field.unit && <span className="w-8 text-[13px] text-dim">{field.unit}</span>}
          </span>
        </span>
        {field.help && <span className="block text-[13px] text-dim">{field.help}</span>}
      </label>
    )
  }

  const saveButton = (fields: Field[]) => (
    <button
      disabled={busy}
      onClick={() => void saveFields(fields)}
      className="min-h-12 w-full rounded-xl bg-eat font-semibold text-bg disabled:opacity-50"
    >
      Guardar
    </button>
  )

  return (
    <div className="space-y-6 pt-1 pb-4">
      <Section title="Perfil e metas">
        {GOALS.map(numberInput)}
        <Toggle
          label="Semana de pausa da dieta"
          help="A cada 6 semanas, uma semana a comer o que gastas, para o corpo descansar da dieta."
          value={profile.maintenance_enabled !== false}
          onChange={(v) => void update({ maintenance_enabled: v })}
        />
        {saveButton(GOALS)}
      </Section>

      <Section title="Bicicleta">
        <label className="block space-y-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[15px]">Potências que usas</span>
            <input
              value={watts}
              onChange={(e) => setWatts(e.target.value)}
              className="h-11 w-36 rounded-xl border border-line bg-bg px-2 text-right tabular-nums focus:border-eat focus:outline-none"
            />
          </span>
          <span className="block text-[13px] text-dim">Em watts, por exemplo 130 · 140 · 150.</span>
        </label>
        {BIKE.map(numberInput)}
        {saveButton(BIKE)}
      </Section>

      <Section title="Balança">
        <Toggle
          label="A minha balança mede gordura"
          help="Mostra um campo opcional na pesagem. É outra forma de medir; não se mistura com a fita."
          value={profile.scale_has_bodyfat}
          onChange={(v) => void update({ scale_has_bodyfat: v })}
        />
      </Section>

      <Section title="Aparência">
        <Choice
          options={[
            ['system', 'Sistema'],
            ['dark', 'Escuro'],
            ['light', 'Claro'],
          ]}
          value={profile.theme ?? 'system'}
          onChange={(v) => void update({ theme: v })}
        />
        <Toggle
          label="Modo calmo"
          help="Esconde o peso de cada dia; fica só o peso médio."
          value={profile.calm_mode}
          onChange={(v) => void update({ calm_mode: v })}
        />
      </Section>

      <Section title="Privacidade">
        <p className="text-[15px]">Pedir o PIN</p>
        <Choice
          options={[
            ['off', 'Nunca'],
            ['12h', 'Após 12 h'],
            ['always', 'Sempre'],
          ]}
          value={pinMode}
          onChange={(mode) => {
            setPinMode(mode)
            setPinModeState(mode)
            void update({ pin_mode: mode })
            if (mode !== 'off' && !hasPin()) window.location.reload()
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              clearPin()
              if (getPinMode() === 'off') setPinMode('12h')
              window.location.reload()
            }}
            className="min-h-12 rounded-xl bg-surface2 text-[15px]"
          >
            {hasPin() ? 'Trocar PIN' : 'Criar PIN'}
          </button>
          <button onClick={() => void supabase.auth.signOut()} className="min-h-12 rounded-xl bg-surface2 text-[15px] text-pain">
            Terminar sessão
          </button>
        </div>
      </Section>

      <Section title="Os meus dados">
        <p className="text-[13px] text-dim">Exportar em CSV (abre no Excel ou no Numbers).</p>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_TABLES.map(([table, filename]) => (
            <button
              key={table}
              disabled={busy}
              onClick={() => void exportTable(table, filename)}
              className="min-h-11 rounded-xl bg-surface2 text-[15px] capitalize disabled:opacity-50"
            >
              {filename}
            </button>
          ))}
        </div>
      </Section>

      <div className="divide-y divide-line rounded-2xl bg-surface">
        <Link href="/definicoes/avancado" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Avançado <span className="text-dim">›</span>
        </Link>
        <Link href="/definicoes/arquivo" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Arquivo <span className="text-dim">›</span>
        </Link>
      </div>
    </div>
  )
}
