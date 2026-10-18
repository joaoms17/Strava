import { useState } from 'react'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { runBusy } from '../lib/busy'
import { fmtDayMonth } from '../lib/format'
import { PHASE_LABEL, cleanStarts, cycleInfo, cycleOptions } from '../../api/_lib/rules/ciclo'

// Corpo › Ciclo (só para mulheres, opcional): marca o primeiro dia do
// período; a app mostra a fase e avisa da semana em que o peso sobe com
// água (não é gordura). Guarda as datas em profile.goals.ciclo.
export default function Ciclo({ today }: { today: string }) {
  const profile = useReadyProfile()
  const { update } = useProfile()
  const toast = useToast()
  const [other, setOther] = useState(false)
  const [date, setDate] = useState(today)
  const starts = cleanStarts(profile.goals?.ciclo)
  const options = cycleOptions(profile.goals)
  const info = cycleInfo(starts, today, options)

  async function setOptions(pill: boolean, days: number) {
    const ok = await update({ goals: { ...(profile.goals ?? {}), ciclo_pilula: pill, ciclo_dias: days } })
    if (!ok) toast('Não consegui guardar.')
  }

  async function save(next: string[], message: string, previous: string[]) {
    const ok = await update({ goals: { ...(profile.goals ?? {}), ciclo: next } })
    if (!ok) {
      toast('Não consegui guardar.')
      return
    }
    toast(message, [{ label: 'Anular', run: async () => void (await update({ goals: { ...(profile.goals ?? {}), ciclo: previous } })) }])
  }

  const add = (d: string) => {
    if (d > today) return
    setOther(false)
    void runBusy('A guardar…', () =>
      save(cleanStarts([...starts, d]), d === today ? 'Marcado: começou hoje.' : `Marcado: começou a ${fmtDayMonth(d)}.`, starts),
    )
  }

  return (
    <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4" aria-label="Ciclo">
      <p className="label">Ciclo</p>
      {info ? (
        <>
          <p className="text-[17px]">
            Dia {info.dayOfCycle}
            {options.pill && info.phase === 'pilula' ? ` de ~${info.length}` : ''} ·{' '}
            {info.overdue ? 'atrasado' : PHASE_LABEL[info.phase]}
            {!info.overdue && (
              <span className="text-dim">
                {' '}
                · próximo {info.daysToNext <= 0 ? 'a qualquer momento' : `por volta de ${fmtDayMonth(info.nextStart)}`}
              </span>
            )}
          </p>
          {info.overdue ? (
            // Mais de uma semana depois da data prevista: já não se desculpa o peso com água.
            <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px]">
              Passaram {info.daysLate} dias da data prevista. Já começou? Marca o dia em que começou.
            </p>
          ) : info.waterWeek ? (
            <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px]">
              Semana de água: é normal o peso subir 0,5–2 kg agora. Não é gordura e desce depois do período.
            </p>
          ) : (
            <p className="text-[14px] text-dim">
              {options.pill ? 'Período' : 'Ciclo'} a cada cerca de {info.length} dias
              {starts.length < 3 ? ' (ainda a aprender)' : ''}.
            </p>
          )}
        </>
      ) : (
        <p className="text-[15px] text-dim">
          Opcional: marca o primeiro dia do período e a app avisa na semana em que o peso sobe com água.
        </p>
      )}

      {other ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-line bg-bg px-3 text-[15px] focus:border-eat focus:outline-none"
          />
          <button onClick={() => add(date)} className="min-h-11 rounded-xl bg-surface2 px-4 text-[15px]">
            Marcar
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={starts.includes(today)}
            onClick={() => add(today)}
            className="min-h-11 rounded-xl bg-surface2 text-[15px] disabled:opacity-40"
          >
            Começou hoje
          </button>
          <button onClick={() => setOther(true)} className="min-h-11 rounded-xl text-[15px] text-eat">
            Outro dia
          </button>
        </div>
      )}

      <div className="space-y-2 border-t border-line/60 pt-3">
        <label className="flex items-center justify-between gap-3 text-[15px]">
          Tomo a pílula
          <input
            type="checkbox"
            checked={options.pill === true}
            onChange={(e) => void runBusy('A guardar…', () => setOptions(e.target.checked, e.target.checked ? 91 : 28))}
            className="h-5 w-5 accent-current"
          />
        </label>
        {options.pill && (
          <div className="grid grid-cols-2 gap-2 text-[14px]">
            {(
              [
                [28, 'Todos os meses'],
                [91, 'De 3 em 3 meses'],
              ] as const
            ).map(([days, text]) => (
              <button
                key={days}
                onClick={() => void runBusy('A guardar…', () => setOptions(true, days))}
                className={`min-h-10 rounded-xl ${options.defaultLength === days ? 'bg-cta text-on-cta' : 'bg-surface2'}`}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {options.pill && (
          <p className="text-[13px] text-dim">Com a pílula não há ovulação nem fases; conta só a semana de água antes da pausa.</p>
        )}
      </div>

      {starts.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[13px] text-dim">
          {starts.slice(-4).reverse().map((d) => (
            <button
              key={d}
              onClick={() => void runBusy('A guardar…', () => save(starts.filter((s) => s !== d), `Tirado: ${fmtDayMonth(d)}.`, starts))}
              className="rounded-full border border-line px-2.5 py-1"
              aria-label={`tirar ${fmtDayMonth(d)}`}
            >
              {fmtDayMonth(d)} ×
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
