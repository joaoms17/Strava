import { useEffect, useMemo, useState } from 'react'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { useDataVersion } from '../lib/events'
import { BusyButton } from '../lib/busy'
import { parseDecimal } from '../lib/format'
import { loadProjection, weekNote, type ProjectionData } from '../lib/projecao'
import { project, projectionLine, rangeText } from '../../api/_lib/rules/projecao'

export function useProjectionData(today: string, enabled = true): ProjectionData | null | 'erro' {
  const profile = useReadyProfile()
  const version = useDataVersion()
  const [data, setData] = useState<ProjectionData | null | 'erro'>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadProjection(profile, today)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData('erro'))
    return () => {
      alive = false
    }
  }, [profile, today, version, enabled])
  return data
}

// Peso alvo por definir (ou para mudar), no próprio cartão.
export function TargetInput({ onDone }: { onDone?: () => void }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const current = Number(profile.target_weight_kg)
  const [value, setValue] = useState(current > 0 ? String(current).replace('.', ',') : '')
  const kg = parseDecimal(value)
  const valid = Number.isFinite(kg) && kg >= 35 && kg <= 250
  return (
    <div className="flex gap-2">
      <input
        inputMode="decimal"
        aria-label="Peso alvo em kg"
        placeholder="Peso alvo (kg)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 text-[17px] tabular-nums"
      />
      <BusyButton
        busy="A guardar…"
        disabled={!valid}
        onClick={async () => {
          const ok = await update({ target_weight_kg: Math.round(kg * 10) / 10 })
          if (!ok) toast('Não consegui guardar.')
          else onDone?.()
        }}
        className="min-h-12 rounded-xl bg-cta px-4 font-semibold text-on-cta disabled:opacity-40"
      >
        Guardar
      </BusyButton>
    </div>
  )
}

// Corpo › Projeção: a data a este ritmo, numa linha, e a mudança da semana.
// O detalhe e o «E se…» abrem-se na folha. No resumo do Corpo vem dentro do
// cartão (`embedded`) com os dados já lidos pela página (`data`).
export default function Projecao({
  today,
  data: given,
  embedded = false,
}: {
  today: string
  data?: ProjectionData
  embedded?: boolean
}) {
  const sheet = useSheet()
  const fetched = useProjectionData(today, given === undefined)
  const data = given ?? fetched
  const result = useMemo(() => {
    if (!data || data === 'erro') return null
    const p = project(data.input)
    return { p, note: weekNote(data, p), data }
  }, [data])

  if (!result) return null
  const { p, note } = result
  const { targetKg, targetWaistCm } = result.data.input

  return (
    <section className={embedded ? 'space-y-2' : 'space-y-2 rounded-[18px] border border-line bg-surface p-4'} aria-label="Projeção">
      <p className="label">Projeção</p>
      {p.status === 'insuficiente' ? (
        <>
          <p className="text-[15px]">Dados insuficientes para uma data honesta.</p>
          <p className="text-[13px] text-dim">
            Precisa de 14 dias completos e de pesagens ao longo de 14 dias (nas últimas 4 semanas). {p.missing}
          </p>
        </>
      ) : p.status === 'sem_alvo' ? (
        <>
          <p className="text-[15px]">Define o peso alvo para ver quando lá chegas a este ritmo.</p>
          <TargetInput />
        </>
      ) : (
        <button onClick={() => sheet.open('projecao')} className="block w-full space-y-1 text-left">
          <p className="text-[17px] font-semibold">{projectionLine(p, targetKg, targetWaistCm, today)}</p>
          {rangeText(p.weight, today) && <p className="text-[13px] text-dim">Peso {rangeText(p.weight, today)}</p>}
          {note && (
            <p className={`text-[13px] ${note.days > 0 ? 'text-attn' : 'text-dim'}`}>
              Desde a semana passada: {note.text}.
            </p>
          )}
          <p className="pt-1 text-[15px] font-semibold text-eat">E se…? ›</p>
        </button>
      )}
    </section>
  )
}
