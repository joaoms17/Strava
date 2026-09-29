import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import { fmt1, fmtDayMonth } from '../lib/format'
import { composition } from '../../api/_lib/rules/composicao'
import type { BodyMeasurement } from '../lib/types'

function delta(now: number | null, before: number | null): string {
  if (now == null || before == null) return ''
  const d = Math.round((now - before) * 10) / 10
  if (d === 0) return ' (igual)'
  return ` (${fmt1(Math.abs(d))} a ${d < 0 ? 'menos' : 'mais'})`
}

// Histórico de medidas: ver, corrigir e apagar medições antigas.
export default function MedidasHistorico() {
  const sheet = useSheet()
  const version = useDataVersion()
  const profile = useReadyProfile()
  const [rows, setRows] = useState<BodyMeasurement[] | null>(null)
  const height = Number(profile.height_cm ?? 183)

  const load = useCallback(async () => {
    const { data } = await supabase.from('body_measurements').select('*').order('date', { ascending: false })
    setRows((data ?? []) as BodyMeasurement[])
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  if (!rows) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>
  if (rows.length === 0) {
    return (
      <div className="space-y-4 rounded-2xl border border-line p-5 text-center">
        <p className="text-[15px] text-dim">Ainda não há medições.</p>
        <button onClick={() => sheet.open('medidas')} className="min-h-12 w-full rounded-xl bg-cta font-semibold text-on-cta">
          Medir agora
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 pt-1">
      {rows.map((m, i) => {
        const before = rows[i + 1]
        const c =
          m.neck_cm != null && m.waist_cm != null
            ? composition(height, {
                neck_cm: Number(m.neck_cm),
                waist_cm: Number(m.waist_cm),
                weight_used_kg: Number(m.weight_used_kg),
              })
            : null
        return (
          <button
            key={m.id}
            onClick={() => sheet.open('medidas', { id: m.id })}
            className="block w-full rounded-2xl border border-line bg-surface p-4 text-left"
          >
            <p className="num text-[22px] leading-tight">{fmtDayMonth(m.date)}</p>
            <p className="text-[15px]">
              Cintura {fmt1(Number(m.waist_cm))} cm
              {delta(m.waist_cm != null ? Number(m.waist_cm) : null, before?.waist_cm != null ? Number(before.waist_cm) : null)} ·
              Pescoço {fmt1(Number(m.neck_cm))} cm
            </p>
            {c && (
              <p className="text-[14px] text-dim">
                Gordura cerca de {fmt1(c.shown.fatKg)} kg ({c.shown.pct} %) · Massa magra {fmt1(c.shown.leanKg)} kg · peso{' '}
                {fmt1(Number(m.weight_used_kg))} kg
              </p>
            )}
            {m.flags.length > 0 && <p className="text-[13px] text-attn">com aviso</p>}
          </button>
        )
      })}
    </div>
  )
}
