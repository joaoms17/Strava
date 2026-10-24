import { useMemo, useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import { chip } from '../ui/Chips'
import { useSheet } from '../../lib/sheet'
import { localCalendarDate } from '../../lib/day'
import { fmt1, fmtInt } from '../../lib/format'
import { TargetInput, useProjectionData } from '../Projecao'
import { weekNote } from '../../lib/projecao'
import {
  SCENARIO_LABEL,
  fmtDayMon,
  project,
  projectionLine,
  rangeText,
  scenarioDelta,
  scenariosDelta,
  type Scenario,
} from '../../../api/_lib/rules/projecao'

const KCAL: Scenario[] = ['menos100', 'menos200', 'menos300']
const OTHER: Scenario[] = ['treino', 'fds']

const perWeek = (kgDay: number) => {
  const w = kgDay * 7
  return Math.abs(w) < 0.05 ? 'estável' : `${w < 0 ? '−' : '+'}${fmt1(Math.abs(w))} kg/semana`
}

// A folha da projeção: o porquê da data (as contas e o peso) e o «E se…»,
// que refaz a data no telemóvel a cada toque.
export default function ProjecaoSheet() {
  const sheet = useSheet()
  const today = localCalendarDate()
  const data = useProjectionData(today)
  const [chosen, setChosen] = useState<Scenario[]>([])
  const [editTarget, setEditTarget] = useState(false)

  const base = useMemo(() => (data && data !== 'erro' ? project(data.input) : null), [data])
  const note = useMemo(() => (data && data !== 'erro' && base ? weekNote(data, base) : null), [data, base])
  const sim = useMemo(() => {
    if (!data || data === 'erro' || !base || base.status === 'insuficiente') return null
    const delta = scenariosDelta(base.basis, chosen)
    return { delta, p: project(data.input, delta) }
  }, [data, base, chosen])

  function toggle(s: Scenario) {
    setChosen((list) => {
      if (list.includes(s)) return list.filter((x) => x !== s)
      // Só um dos de kcal de cada vez.
      const rest = KCAL.includes(s) ? list.filter((x) => !KCAL.includes(x)) : list
      return [...rest, s]
    })
  }

  let body
  if (data === null) body = <p className="py-6 text-center text-[15px] text-dim">A carregar…</p>
  else if (data === 'erro' || !base) body = <p className="py-6 text-center text-[15px] text-dim">Não consegui ler os dados.</p>
  else if (base.status === 'insuficiente') {
    body = (
      <div className="space-y-2 pb-2">
        <p className="text-[15px]">Dados insuficientes. {base.missing}</p>
        <p className="text-[13px] text-dim">
          A data sai do que comes (dias completos), do gasto medido pelo peso e do peso médio. Com menos de 14 dias,
          a água e o sal pesam mais do que a gordura.
        </p>
      </div>
    )
  } else {
    const b = base.basis
    const { targetKg, targetWaistCm } = data.input
    const p = sim?.p ?? base
    const changed = chosen.length > 0 && sim != null
    const before = base.status === 'ok' && base.weight.kind === 'date' ? base.weight.date : null
    const after = p.status === 'ok' && p.weight.kind === 'date' ? p.weight.date : null
    const gain = before && after ? Math.round((Date.parse(before) - Date.parse(after)) / 86_400_000) : null
    body = (
      <div className="space-y-4 pb-2">
        {base.status === 'sem_alvo' || editTarget ? (
          <div className="space-y-2">
            <p className="text-[15px]">Peso alvo</p>
            <TargetInput onDone={() => setEditTarget(false)} />
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[19px] font-semibold">{projectionLine(p, targetKg, targetWaistCm, today)}</p>
            {p.status === 'ok' && rangeText(p.weight, today) && (
              <p className="text-[15px] text-dim">Peso {rangeText(p.weight, today)}</p>
            )}
            {changed && gain != null && gain !== 0 && (
              <p className="text-[15px] font-semibold text-eat">
                {gain > 0 ? `${gain} dias mais cedo` : `${-gain} dias mais tarde`} ({fmtInt(Math.abs(sim!.delta))} kcal/dia)
              </p>
            )}
            {changed && before == null && after && <p className="text-[15px] font-semibold text-eat">Assim já chegas lá.</p>}
            {!changed && note && <p className="text-[13px] text-dim">Desde a semana passada: {note.text}.</p>}
            <button onClick={() => setEditTarget(true)} className="min-h-10 text-[13px] text-dim underline">
              Mudar o peso alvo
            </button>
          </div>
        )}

        <div className="space-y-2">
          <p className="label">E se…</p>
          <div className="flex flex-wrap gap-2">
            {[...KCAL, ...OTHER].map((s) => {
              const delta = scenarioDelta(b, s)
              if (delta == null) return null
              const label =
                s === 'treino'
                  ? `+1 treino/semana (${fmtInt(b.workoutKcal!)} kcal)`
                  : s === 'fds'
                    ? `Fins de semana como a semana (−${fmtInt(b.weekend! - b.weekday!)} kcal nesses dias)`
                    : SCENARIO_LABEL[s]
              return (
                <button key={s} aria-pressed={chosen.includes(s)} onClick={() => toggle(s)} className={chip(chosen.includes(s))}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1 rounded-2xl bg-surface2 p-3 text-[15px] tabular-nums">
          <p className="label pb-1">De onde vem a data (últimas 4 semanas)</p>
          <p>Comes {fmtInt(b.intake)} kcal/dia ({b.countedDays} dias completos)</p>
          {b.weekday != null && b.weekend != null && (
            <p className="text-dim">
              durante a semana {fmtInt(b.weekday)} · ao fim de semana {fmtInt(b.weekend)}
            </p>
          )}
          <p>Gasto medido {fmtInt(b.tdee)} kcal/dia</p>
          <p className="text-dim">
            pelas contas {perWeek(b.energyKgDay)} · pelo peso médio {perWeek(b.observedKgDay)}
          </p>
          <p>Peso médio hoje {fmt1(b.currentKg)} kg</p>
          {b.waistCm != null && b.waistDate && (
            <p>
              Cintura {fmt1(b.waistCm)} cm a {fmtDayMon(b.waistDate, today)}
              {targetWaistCm != null ? ` · alvo ${targetWaistCm} cm` : ''}
            </p>
          )}
          <p>
            Treinos {fmt1(b.workoutsPerWeek)}/semana
            {b.workoutKcal != null ? ` · ${fmtInt(b.workoutKcal)} kcal cada` : ''}
          </p>
        </div>
        <p className="text-[13px] text-dim">
          A data é a meio entre o ritmo das contas e o do peso médio; o intervalo é a distância entre os dois. Usa o
          peso médio, não a pesagem do dia{data.input.waterDay ? ', e não conta a semana de água do ciclo' : ''}.
        </p>
      </div>
    )
  }

  return (
    <BottomSheet title="Projeção" onClose={sheet.close}>
      {body}
    </BottomSheet>
  )
}
