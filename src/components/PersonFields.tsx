import { chip } from './ui/Chips'
import { fmtInt } from '../lib/format'
import { startingTargets } from '../../api/_lib/rules/pessoas'

export interface PersonDraft {
  name: string
  sex: 'm' | 'f'
  height: string
  birthYear: string
  weight: string
  target: string
}

export const EMPTY_PERSON: PersonDraft = { name: '', sex: 'f', height: '', birthYear: '', weight: '', target: '' }

const num = (text: string) => {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() && Number.isFinite(n) ? n : null
}

// Os dados de uma pessoa nova, prontos para o servidor (ou null se faltar algo).
export function personPayload(d: PersonDraft) {
  const height = num(d.height)
  const year = num(d.birthYear)
  const weight = num(d.weight)
  const target = num(d.target) ?? weight
  if (!d.name.trim() || height == null || height < 120 || height > 230) return null
  if (target == null || target < 30 || target > 300) return null
  if (weight != null && (weight < 30 || weight > 300)) return null
  if (year != null && (year < 1920 || year > 2015)) return null
  return {
    name: d.name.trim(),
    sex: d.sex,
    height_cm: Math.round(height),
    birth_year: year != null ? Math.round(year) : null,
    weight_kg: weight,
    target_weight_kg: target,
  }
}

// Nome, sexo, altura, ano, peso e peso alvo; mostra os alvos de partida.
export default function PersonFields({ value, onChange }: { value: PersonDraft; onChange: (d: PersonDraft) => void }) {
  const set = (patch: Partial<PersonDraft>) => onChange({ ...value, ...patch })
  const field =
    'h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] tabular-nums placeholder:text-dim focus:border-eat focus:outline-none'
  const payload = personPayload(value)
  const targets = payload
    ? startingTargets(
        {
          sex: payload.sex,
          heightCm: payload.height_cm,
          birthYear: payload.birth_year,
          weightKg: payload.weight_kg,
          targetWeightKg: payload.target_weight_kg,
        },
        new Date().getFullYear(),
      )
    : null

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="label">Nome</span>
        <input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          maxLength={30}
          placeholder="ex.: Joana"
          autoComplete="off"
          className={field}
        />
      </label>
      <div className="flex gap-2">
        {(
          [
            ['f', 'Mulher'],
            ['m', 'Homem'],
          ] as const
        ).map(([sex, label]) => (
          <button key={sex} onClick={() => set({ sex })} aria-pressed={value.sex === sex} className={chip(value.sex === sex)}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="label">Altura (cm)</span>
          <input inputMode="numeric" value={value.height} onChange={(e) => set({ height: e.target.value })} placeholder="165" className={field} />
        </label>
        <label className="block space-y-1">
          <span className="label">Ano de nascimento</span>
          <input inputMode="numeric" value={value.birthYear} onChange={(e) => set({ birthYear: e.target.value })} placeholder="1990" className={field} />
        </label>
        <label className="block space-y-1">
          <span className="label">Peso hoje (kg)</span>
          <input inputMode="decimal" value={value.weight} onChange={(e) => set({ weight: e.target.value })} placeholder="64,5" className={field} />
        </label>
        <label className="block space-y-1">
          <span className="label">Peso alvo (kg)</span>
          <input inputMode="decimal" value={value.target} onChange={(e) => set({ target: e.target.value })} placeholder="60" className={field} />
        </label>
      </div>
      {targets && (
        <p className="rounded-xl bg-surface2 px-3 py-2 text-[14px] text-dim tabular-nums">
          Para começar: <span className="text-ink">{fmtInt(targets.base_kcal)} kcal</span> por dia e{' '}
          <span className="text-ink">{targets.protein_g} g</span> de proteína. Muda-se depois nas Definições.
        </p>
      )}
    </div>
  )
}
