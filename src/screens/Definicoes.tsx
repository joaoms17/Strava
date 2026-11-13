import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import { supabase } from '../lib/supabase'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { toCsv, downloadCsv } from '../lib/csv'
import type { Profile } from '../lib/types'
import IntervalsSettings from '../components/IntervalsSettings'
import NewPasswordForm from '../components/NewPasswordForm'
import PeopleSettings from '../components/PeopleSettings'
import AtalhoSaude from '../components/AtalhoSaude'
import Notificacoes from '../components/Notificacoes'
import { signOutCurrent } from '../lib/accounts'
import { SEGMENT_TRACK, segment } from '../components/ui/Chips'
import { campoMudou, lerPotencias, potenciasMudaram, usaBicicleta } from '../lib/definicoes'

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

const BODY: Field[] = [
  { key: 'measure_interval_days', label: 'Medir cintura e pescoço a cada', unit: 'dias', min: 7, max: 60 },
]

const BIKE: Field[] = [
  {
    key: 'bike_hr_avg_cap',
    label: 'Teto da FC média',
    unit: 'bpm',
    help: 'Com a média acima disto, a potência não sobe.',
    min: 80,
    max: 200,
  },
  {
    key: 'bike_hr_max_cap',
    label: 'Teto da FC máxima',
    unit: 'bpm',
    help: 'Com o pico acima disto, também não sobe.',
    min: 90,
    max: 220,
  },
]

const EXPORT_PAGE = 1000
const EXPORT_MAX_PAGES = 100
// As que têm dia: saem por dia (as outras pela chave).
const DATED_TABLES = new Set(['meals', 'days', 'weights', 'workouts', 'health_daily'])

// A tabela, o nome do ficheiro (sem acentos) e o que se lê no botão.
const EXPORT_TABLES: [string, string, string][] = [
  ['meals', 'refeicoes', 'Refeições'],
  ['favorites', 'favoritos', 'Favoritas'],
  ['days', 'dias', 'Dias'],
  ['weights', 'pesagens', 'Pesagens'],
  ['workouts', 'treinos', 'Treinos'],
  ['exercise_log', 'series', 'Séries'],
  ['foods', 'alimentos', 'Alimentos'],
  ['health_daily', 'saude', 'Saúde'],
]

// Mudar a palavra-passe com a sessão iniciada (sem email).
function ChangePassword() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    if (open) void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [open])
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="min-h-12 w-full rounded-xl bg-surface2 text-[15px]">
        Mudar palavra-passe
      </button>
    )
  }
  return (
    <div className="space-y-2">
      <NewPasswordForm
        email={email}
        submitLabel="Guardar palavra-passe"
        onDone={() => {
          setOpen(false)
          toast('Palavra-passe mudada.')
        }}
      />
      <button onClick={() => setOpen(false)} className="min-h-11 w-full text-[15px] text-dim">
        Cancelar
      </button>
    </div>
  )
}

// H14: terminar a sessão pede confirmação (um toque ao lado não tira ninguém).
function SignOut() {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="min-h-12 w-full rounded-xl bg-surface2 text-[15px] text-pain">
        Terminar sessão
      </button>
    )
  }
  return (
    <div role="alertdialog" aria-label="Terminar sessão" className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-[15px]">Terminar a sessão neste telemóvel? Para voltar a entrar precisas do email e da palavra-passe.</p>
      <div className="grid grid-cols-2 gap-2">
        <button autoFocus onClick={() => setConfirming(false)} className="min-h-12 rounded-xl bg-surface2 text-[15px]">
          Cancelar
        </button>
        <BusyButton busy="A sair…" onClick={signOutCurrent} className="min-h-12 rounded-xl bg-surface2 text-[15px] font-semibold text-pain">
          Terminar
        </BusyButton>
      </div>
    </div>
  )
}

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
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-cta" />
    </label>
  )
}

function Choice<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={`grid ${SEGMENT_TRACK} text-[15px]`} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} aria-pressed={value === id} className={`min-h-11 rounded-lg ${segment(value === id)}`}>
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
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initial(GOALS), ...initial(BIKE), ...initial(BODY) }))
  const [watts, setWatts] = useState((profile.bike_watts_options ?? []).join(' · '))
  // Nas mulheres a anca também se mede (decisões 178 e 192).
  const body =
    profile.sex === 'f'
      ? BODY.map((f) => (f.key === 'measure_interval_days' ? { ...f, label: 'Medir cintura, anca e pescoço a cada' } : f))
      : BODY
  // H14 e L2: a bicicleta, o Atalho e o Arquivo só para quem os usa. Até se
  // saber (ou se a consulta falhar), ficam em «Mais definições».
  const [uses, setUses] = useState<{ bike: boolean; shortcut: boolean; chapters: boolean }>({
    bike: (profile.bike_watts_options?.length ?? 0) > 0,
    shortcut: false,
    chapters: false,
  })
  const [showMore, setShowMore] = useState(false)
  useEffect(() => {
    let alive = true
    const count = async (run: () => PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      try {
        const { data, error } = await run()
        return error ? 0 : (data?.length ?? 0)
      } catch {
        return 0
      }
    }
    void Promise.all([
      count(() => supabase.from('workouts').select('id').eq('type', 'bike').limit(1)),
      count(() => supabase.from('health_daily').select('date').eq('source', 'shortcut').limit(1)),
      count(() => supabase.from('chapters').select('id').limit(1)),
    ]).then(([bikes, shortcut, chapters]) => {
      if (!alive) return
      setUses({
        bike: usaBicicleta({ potencias: profile.bike_watts_options, treinosBicicleta: bikes }),
        shortcut: shortcut > 0,
        chapters: chapters > 0,
      })
    })
    return () => {
      alive = false
    }
  }, [profile.bike_watts_options])
  const dirty = (fields: Field[]) => fields.some((f) => campoMudou(values[f.key], profile[f.key]))
  const bikeDirty = dirty(BIKE) || potenciasMudaram(watts, profile.bike_watts_options)

  // Os interruptores mudam logo; se não gravar, voltam atrás e avisa.
  const set = (patch: Partial<Profile>) =>
    void update(patch).then((ok) => {
      if (!ok) toast('Não consegui guardar. Tenta outra vez.')
    })

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
      const options = lerPotencias(watts)
      if (options.length === 0) {
        toast('Escreve pelo menos uma potência, por exemplo 130 · 140 · 150.')
        return
      }
      patch.bike_watts_options = options
    }
    const ok = await update(patch as Partial<Profile>)
    toast(ok ? 'Guardado.' : 'Não consegui guardar. Tenta outra vez.')
  }

  // Por páginas de 1 000 (o máximo que a API devolve por pedido, H3), por uma
  // ordem fixa: antes pedia 20 000, recebia as primeiras 1 000 por uma ordem
  // qualquer e o ficheiro parecia completo.
  async function exportTable(table: string, filename: string, label: string) {
    const rows: Record<string, unknown>[] = []
    for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
      let query = supabase.from(table).select('*')
      if (DATED_TABLES.has(table)) query = query.order('date')
      const { data, error } = await query.order('id').range(page * EXPORT_PAGE, (page + 1) * EXPORT_PAGE - 1)
      if (error || !data) {
        toast(`Não consegui exportar: ${label}.`)
        return
      }
      rows.push(...(data as Record<string, unknown>[]))
      if (data.length < EXPORT_PAGE) break
    }
    downloadCsv(`${filename}.csv`, toCsv(rows))
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

  // H14: os números só gravam com «Guardar» (os interruptores e as escolhas
  // gravam ao toque). Com algo por guardar diz-se; sem nada, o botão apaga-se.
  const saveButton = (fields: Field[], changed = dirty(fields)) => (
    <div className="space-y-1">
      {changed && (
        <p role="status" className="text-[13px] font-semibold text-attn">
          Tens alterações por guardar.
        </p>
      )}
      <BusyButton
        busy="A guardar…"
        disabled={!changed}
        onClick={() => saveFields(fields)}
        className="min-h-12 w-full rounded-xl bg-cta font-semibold text-on-cta disabled:opacity-40"
      >
        {changed ? 'Guardar' : 'Guardado'}
      </BusyButton>
    </div>
  )

  const bikeSection = (
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
      {saveButton(BIKE, bikeDirty)}
    </Section>
  )
  const shortcutSection = (
    <Section title="Ligações · Atalho do iPhone (Apple Watch)">
      <AtalhoSaude />
    </Section>
  )
  const hidden = !uses.bike || !uses.shortcut

  return (
    <div className="space-y-6 pt-1 pb-4">
      <Section title="Pessoas">
        <PeopleSettings />
      </Section>

      {/* Logo a seguir às pessoas: cada pessoa liga as suas neste telemóvel. */}
      <Section title="Notificações">
        <Notificacoes />
      </Section>

      <Section title="Perfil e metas">
        <div className="space-y-1">
          <p className="text-[15px]">Sexo</p>
          <Choice
            options={[
              ['m', 'Homem'],
              ['f', 'Mulher'],
            ]}
            value={profile.sex === 'f' ? 'f' : 'm'}
            onChange={(v) => set({ sex: v })}
          />
          <p className="text-[13px] text-dim">Muda a fórmula da gordura (as mulheres medem também a anca), o gasto e as categorias.</p>
        </div>
        {GOALS.map(numberInput)}
        <Toggle
          label="Semana de pausa da dieta"
          help="A cada 6 semanas, uma semana a comer o que gastas, para o corpo descansar da dieta."
          value={profile.maintenance_enabled !== false}
          onChange={(v) => set({ maintenance_enabled: v })}
        />
        {saveButton(GOALS)}
      </Section>

      {uses.bike && bikeSection}

      <Section title="Relógio">
        <Toggle
          label="Gravo os treinos num relógio (Garmin, Amazfit…)"
          help="O print do relógio junta os batimentos às sessões. Os treinos automáticos (intervals.icu) vêm mais tarde."
          value={profile.has_garmin_watch ?? false}
          onChange={(v) => set({ has_garmin_watch: v })}
        />
      </Section>

      {profile.has_garmin_watch && (
        <Section title="Ligações · treinos automáticos">
          <IntervalsSettings />
        </Section>
      )}

      {uses.shortcut && shortcutSection}

      <Section title="Corpo e balança">
        {body.map(numberInput)}
        {saveButton(body)}
        <Toggle
          label="A minha balança mede gordura"
          help="Mostra um campo opcional na pesagem. É outra forma de medir; não se mistura com a fita."
          value={profile.scale_has_bodyfat}
          onChange={(v) => set({ scale_has_bodyfat: v })}
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
          onChange={(v) => set({ theme: v })}
        />
        <Toggle
          label="Modo calmo"
          help="Esconde o peso de cada dia; no Corpo mostra só a média da semana."
          value={profile.calm_mode}
          onChange={(v) => set({ calm_mode: v })}
        />
      </Section>

      <Section title="Sessão">
        <p className="text-[13px] text-dim">A app fica sempre com a sessão iniciada neste telemóvel.</p>
        <ChangePassword />
        <SignOut />
      </Section>

      <Section title="Os meus dados">
        <p className="text-[13px] text-dim">Exportar em CSV (abre no Excel ou no Numbers).</p>
        <div className="grid grid-cols-2 gap-2">
          {EXPORT_TABLES.map(([table, filename, label]) => (
            <BusyButton
              key={table}
              busy="A exportar…"
              onClick={() => exportTable(table, filename, label)}
              className="min-h-11 rounded-xl bg-surface2 text-[15px] disabled:opacity-50"
            >
              {label}
            </BusyButton>
          ))}
        </div>
      </Section>

      <div className="divide-y divide-line rounded-2xl bg-surface">
        <Link href="/favoritos" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Favoritas e dieta <span className="text-dim">›</span>
        </Link>
        <Link href="/definicoes/avancado" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
          Avançado <span className="text-dim">›</span>
        </Link>
        {uses.chapters && (
          <Link href="/definicoes/arquivo" className="flex min-h-14 items-center justify-between px-4 text-[15px]">
            Arquivo <span className="text-dim">›</span>
          </Link>
        )}
      </div>

      {hidden &&
        (showMore ? (
          <>
            {!uses.bike && bikeSection}
            {!uses.shortcut && shortcutSection}
          </>
        ) : (
          <button onClick={() => setShowMore(true)} className="min-h-12 w-full rounded-xl border border-line text-[15px] text-dim">
            Mais definições ({[!uses.bike && 'bicicleta', !uses.shortcut && 'Atalho do iPhone'].filter(Boolean).join(', ')})
          </button>
        ))}
    </div>
  )
}
