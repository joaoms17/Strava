import { useState } from 'react'
import { useSheet } from '../lib/sheet'
import { useReadyProfile } from '../lib/profile'
import { localCalendarDate } from '../lib/day'
import { fmt1, fmtDayMonth } from '../lib/format'
import {
  DETECTABLE_CHANGE_PP,
  changeSentence,
  compareCompositions,
  composition,
  confirmationSentence,
  daysSinceMeasure,
  earlyDietWeeks,
  lossSentence,
  sameWaistSite,
  scaleFatAverage,
  wrongWaistSite,
} from '../../api/_lib/rules/composicao'
import { lossQuality } from '../../api/_lib/rules/gasto'
import type { BodyMeasurement } from '../lib/types'
import Icon from './ui/Icon'
import FatScale from './FatScale'

// Corpo › Medidas › Gordura e massa magra (Fase 4). Os pontos são só as
// datas medidas: nunca se projeta a %G para o peso de cada dia. As medições
// e a %G da balança (as 60 mais recentes, da mais antiga para a mais nova)
// vêm da página (lidas uma vez); a cintura tem o seu gráfico (CinturaChart).
export default function CompositionCards({ rows, scale }: { rows: BodyMeasurement[]; scale: number[] }) {
  const sheet = useSheet()
  const profile = useReadyProfile()
  const [details, setDetails] = useState(false)
  const height = Number(profile.height_cm ?? 183)
  const today = localCalendarDate()
  const female = profile.sex === 'f'

  if (rows.length === 0) {
    return (
      <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4">
        <p className="label">Gordura e massa magra</p>
        <p className="text-[15px]">
          Mede {female ? 'a cintura, a anca e o pescoço' : 'a cintura e o pescoço'}: 2 minutos com uma fita métrica chegam
          para estimar a gordura e a massa magra.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => sheet.open('medidas')} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta">
            Medir agora
          </button>
          <button onClick={() => sheet.open('como-medir')} className="min-h-12 rounded-xl border border-line text-[15px]">
            Como medir
          </button>
        </div>
      </section>
    )
  }

  const withComp = rows
    .map((m) => ({
      m,
      c:
        m.neck_cm != null && m.waist_cm != null
          ? composition(
              height,
              {
                neck_cm: Number(m.neck_cm),
                waist_cm: Number(m.waist_cm),
                hips_cm: m.hips_cm != null ? Number(m.hips_cm) : null,
                weight_used_kg: Number(m.weight_used_kg),
              },
              profile.sex,
            )
          : null,
    }))
    .filter((x) => x.c != null) as { m: BodyMeasurement; c: NonNullable<ReturnType<typeof composition>> }[]
  const last = withComp[withComp.length - 1]
  // Só se compara com medições com a cintura no mesmo sítio (as antigas das
  // mulheres foram no umbigo: davam uma descida que não houve).
  const comparable = last ? withComp.filter((x) => sameWaistSite(x.m, last.m)) : []
  const firstOne = comparable[0]
  const change = last && firstOne && firstOne !== last ? compareCompositions(firstOne.c, last.c) : null
  const days = last ? daysSinceMeasure(last.m.date, today) : null
  const scaleAvg = scaleFatAverage(scale)
  const bmi = last ? Number(last.m.weight_used_kg) / (height / 100) ** 2 : null
  // Que parte do peso perdido foi gordura (3 medições ou mais, 3 kg ou mais).
  const quality = lossQuality(comparable.map((x) => ({ weight_used_kg: Number(x.m.weight_used_kg), fatKg: x.c.fatKg })))
  // Com a qualidade da perda, a mudança e a parte que foi gordura numa frase só
  // (eram duas seguidas com a mesma descida); sem ela, como antes (decisão 112).
  const merged = quality ? lossSentence(quality) : null

  if (!last) return null
  return (
    <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <p className="label">Gordura e massa magra</p>
        <p className="text-[13px] text-dim">{days === 0 ? 'medido hoje' : `medido há ${days} ${days === 1 ? 'dia' : 'dias'}`}</p>
      </div>
      <div className="flex h-4 overflow-hidden rounded-md" role="img" aria-label="massa magra e gordura">
        <div className="bg-ink/80" style={{ width: `${100 - last.c.pct}%` }} />
        <div className="bg-body" style={{ width: `${last.c.pct}%` }} />
      </div>
      <FatScale pct={last.c.pct} sex={profile.sex} />
      {female && wrongWaistSite(last.m, profile.sex) && (
        <p className="rounded-xl bg-attn/15 px-3 py-2 text-[14px] text-attn">
          Esta medição tem a cintura no umbigo, o que dá gordura a mais. Nas mulheres mede-se na parte mais estreita:
          mede outra vez (vê «Como medir»).
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="num text-[34px] leading-none font-extrabold text-body">{fmt1(last.c.shown.fatKg)} kg</p>
          <p className="text-[14px] text-dim">gordura · cerca de {last.c.shown.pct}&nbsp;%</p>
        </div>
        <div>
          <p className="num text-[34px] leading-none font-extrabold">{fmt1(last.c.shown.leanKg)} kg</p>
          <p className="text-[14px] text-dim">massa magra (músculo, água, osso, órgãos)</p>
        </div>
      </div>
      {change && firstOne ? (
        <p className="text-[15px]">
          Desde {fmtDayMonth(firstOne.m.date)}: {merged ?? changeSentence(change)} ·{' '}
          <span className={change.confirmed ? '' : 'text-dim'}>{confirmationSentence(change)}</span>
        </p>
      ) : (
        <p className="text-[14px] text-dim">Na próxima medição mostro o que mudou.</p>
      )}
      {quality && quality.weightKg < 0 && firstOne && !merged && (
        <p className="text-[15px]">
          Dos {fmt1(Math.abs(quality.weightKg))}&nbsp;kg que perdeste desde {fmtDayMonth(firstOne.m.date)}, cerca de{' '}
          {Math.max(0, Math.min(100, quality.fatShare))}&nbsp;% foram gordura.
        </p>
      )}
      {earlyDietWeeks(profile.maintenance_anchor ?? null, today) && (
        <p className="text-[14px] text-dim">Nas primeiras semanas perdes água e glicogénio, não músculo.</p>
      )}
      {profile.scale_has_bodyfat && scaleAvg != null && (
        <p className="text-[14px] text-dim">Balança: cerca de {Math.round(scaleAvg)}&nbsp;% (média) · outra forma de medir, não se mistura.</p>
      )}
      <button onClick={() => setDetails(!details)} className="flex items-center gap-1 text-[14px] text-dim">
        <Icon name="info" size={18} /> Como é calculado?
      </button>
      {details && (
        <div className="space-y-2 rounded-xl bg-surface2 p-3 text-[14px]">
          <p>
            Método da fita (Marinha dos EUA): pescoço,{' '}
            {female ? 'cintura na parte mais estreita, anca' : 'cintura no umbigo'} e a tua altura ({height} cm), com o
            peso médio desse dia ({fmt1(Number(last.m.weight_used_kg))} kg).
          </p>
          <p>
            Intervalo provável: {last.c.range.pct[0]}–{last.c.range.pct[1]}&nbsp;% de gordura ({fmt1(last.c.range.fatKg[0])}–
            {fmt1(last.c.range.fatKg[1])} kg). A fita erra cerca de ±4 pontos, mas acerta na direção ao longo de semanas.
          </p>
          <p>
            Entre medições, uma mudança de {fmt1(DETECTABLE_CHANGE_PP)} pontos ou mais já é real; abaixo disso ainda pode ser
            a fita.
          </p>
          {bmi != null && <p className="text-dim">IMC {fmt1(bmi)} (não mede a composição; não é meta).</p>}
        </div>
      )}
    </section>
  )
}
