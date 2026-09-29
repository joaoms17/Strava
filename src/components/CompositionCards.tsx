import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'
import { supabase } from '../lib/supabase'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
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
  scaleFatAverage,
  targetWaist,
} from '../../api/_lib/rules/composicao'
import { lossQuality } from '../../api/_lib/rules/gasto'
import type { BodyMeasurement } from '../lib/types'
import { TARGET_BODY_FAT_PCT } from './sheets/MedidasSheet'
import Icon from './ui/Icon'

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const w = 120
  const h = 36
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="text-body">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={(i / (values.length - 1)) * w} cy={h - ((v - min) / (max - min)) * h} r="3" fill="currentColor" />
      ))}
    </svg>
  )
}

// Corpo › Gordura e massa magra e Cintura (Fase 4). Os pontos são só as
// datas medidas: nunca se projeta a %G para o peso de cada dia.
export default function CompositionCards() {
  const sheet = useSheet()
  const version = useDataVersion()
  const profile = useReadyProfile()
  const [rows, setRows] = useState<BodyMeasurement[] | null>(null)
  const [scale, setScale] = useState<number[]>([])
  const [details, setDetails] = useState(false)
  const height = Number(profile.height_cm ?? 183)
  const today = localCalendarDate()

  const load = useCallback(async () => {
    const [{ data }, { data: fat }] = await Promise.all([
      supabase.from('body_measurements').select('*').order('date'),
      profile.scale_has_bodyfat
        ? supabase.from('weights').select('body_fat_pct').not('body_fat_pct', 'is', null).order('date').limit(60)
        : Promise.resolve({ data: [] as { body_fat_pct: number }[] }),
    ])
    setRows((data ?? []) as BodyMeasurement[])
    setScale((fat ?? []).map((f) => Number(f.body_fat_pct)))
  }, [profile.scale_has_bodyfat])

  useEffect(() => {
    void load()
  }, [load, version])

  if (!rows) return null

  if (rows.length === 0) {
    return (
      <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4">
        <p className="label">Gordura e massa magra</p>
        <p className="text-[15px]">
          Mede a cintura e o pescoço: 2 minutos com uma fita métrica chegam para estimar a gordura e a massa magra.
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
          ? composition(height, {
              neck_cm: Number(m.neck_cm),
              waist_cm: Number(m.waist_cm),
              weight_used_kg: Number(m.weight_used_kg),
            })
          : null,
    }))
    .filter((x) => x.c != null) as { m: BodyMeasurement; c: NonNullable<ReturnType<typeof composition>> }[]
  const last = withComp[withComp.length - 1]
  const firstOne = withComp[0]
  const change = last && firstOne && firstOne !== last ? compareCompositions(firstOne.c, last.c) : null
  const days = last ? daysSinceMeasure(last.m.date, today) : null
  const scaleAvg = scaleFatAverage(scale)
  const lastWaist = rows[rows.length - 1]!
  const bmi = last ? Number(last.m.weight_used_kg) / (height / 100) ** 2 : null
  // Que parte do peso perdido foi gordura (3 medições ou mais, 3 kg ou mais).
  const quality = lossQuality(withComp.map((x) => ({ weight_used_kg: Number(x.m.weight_used_kg), fatKg: x.c.fatKg })))

  return (
    <>
      {last && (
        <section className="space-y-3 rounded-[18px] border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <p className="label">Gordura e massa magra</p>
            <p className="text-[13px] text-dim">{days === 0 ? 'medido hoje' : `medido há ${days} ${days === 1 ? 'dia' : 'dias'}`}</p>
          </div>
          <div className="flex h-4 overflow-hidden rounded-md" role="img" aria-label="massa magra e gordura">
            <div className="bg-ink/80" style={{ width: `${100 - last.c.pct}%` }} />
            <div className="bg-body" style={{ width: `${last.c.pct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="num text-[34px] leading-none font-extrabold text-body">{fmt1(last.c.shown.fatKg)} kg</p>
              <p className="text-[14px] text-dim">gordura · cerca de {last.c.shown.pct} %</p>
            </div>
            <div>
              <p className="num text-[34px] leading-none font-extrabold">{fmt1(last.c.shown.leanKg)} kg</p>
              <p className="text-[14px] text-dim">massa magra (músculo, água, osso, órgãos)</p>
            </div>
          </div>
          {change && firstOne ? (
            <p className="text-[15px]">
              Desde {fmtDayMonth(firstOne.m.date)}: {changeSentence(change)} ·{' '}
              <span className={change.confirmed ? '' : 'text-dim'}>{confirmationSentence(change)}</span>
            </p>
          ) : (
            <p className="text-[14px] text-dim">Na próxima medição mostro o que mudou.</p>
          )}
          {quality && quality.weightKg < 0 && firstOne && (
            <p className="text-[15px]">
              Dos {fmt1(Math.abs(quality.weightKg))} kg que perdeste desde {fmtDayMonth(firstOne.m.date)}, cerca de{' '}
              {Math.max(0, Math.min(100, quality.fatShare))} % foram gordura.
            </p>
          )}
          {earlyDietWeeks(profile.maintenance_anchor ?? null, today) && (
            <p className="text-[14px] text-dim">Nas primeiras semanas perdes água e glicogénio, não músculo.</p>
          )}
          {profile.scale_has_bodyfat && scaleAvg != null && (
            <p className="text-[14px] text-dim">Balança: cerca de {Math.round(scaleAvg)} % (média) · outra forma de medir, não se mistura.</p>
          )}
          <button onClick={() => setDetails(!details)} className="flex items-center gap-1 text-[14px] text-dim">
            <Icon name="info" size={18} /> Como é calculado?
          </button>
          {details && (
            <div className="space-y-2 rounded-xl bg-surface2 p-3 text-[14px]">
              <p>
                Método da fita (Marinha dos EUA): pescoço, cintura no umbigo e a tua altura ({height} cm), com o peso médio
                desse dia ({fmt1(Number(last.m.weight_used_kg))} kg).
              </p>
              <p>
                Intervalo provável: {last.c.range.pct[0]}–{last.c.range.pct[1]} % de gordura ({fmt1(last.c.range.fatKg[0])}–
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
      )}

      <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
        <p className="label">Cintura</p>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="num text-[34px] leading-none font-extrabold">{fmt1(Number(lastWaist.waist_cm))} cm</p>
            {lastWaist.neck_cm != null && (
              <p className="text-[14px] text-dim">
                alvo cerca de {Math.round(targetWaist(height, Number(lastWaist.neck_cm), TARGET_BODY_FAT_PCT))} cm
              </p>
            )}
          </div>
          <Sparkline values={rows.filter((r) => r.waist_cm != null).map((r) => Number(r.waist_cm))} />
        </div>
        <p className="text-[13px] text-dim">A cintura em cm é o número mais honesto: não passa por nenhum modelo.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => sheet.open('medidas')} className="min-h-12 rounded-xl bg-cta font-semibold text-on-cta">
            Medir
          </button>
          <Link href="/corpo/medidas" className="flex min-h-12 items-center justify-center rounded-xl border border-line text-[15px]">
            Histórico ›
          </Link>
        </div>
      </section>
    </>
  )
}
