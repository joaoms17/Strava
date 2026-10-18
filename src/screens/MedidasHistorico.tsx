import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import { fmt1, fmtDayMonth } from '../lib/format'
import {
  FLAG_TEXT,
  ZONE_LABEL,
  ZONE_ORDER,
  measurementComposition,
  wrongWaistSite,
  zoneDelta,
  zoneTrends,
  zoneValue,
  type MeasureFlag,
  type Zone,
} from '../../api/_lib/rules/composicao'
import type { BodyMeasurement } from '../lib/types'
import Sparkline from '../components/ui/Sparkline'

function delta(d: number | null): string {
  if (d == null) return ''
  if (d === 0) return ' (igual)'
  return ` (${fmt1(Math.abs(d))} a ${d < 0 ? 'menos' : 'mais'})`
}

// Histórico de medidas: como mudou cada zona e as medições, para ver,
// corrigir e apagar.
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

  // Da mais antiga para a mais recente, para as mudanças.
  const asc = [...rows].reverse()
  const trends = zoneTrends(asc)
  // «Cintura (umbigo) 80,0 cm (1,0 a menos)»: as medições antigas das mulheres
  // foram no umbigo e não se comparam com as novas.
  const zoneText = (m: BodyMeasurement, index: number, zone: Zone) => {
    const site = zone === 'waist' && profile.sex === 'f' && wrongWaistSite(m, profile.sex) ? ' (umbigo)' : ''
    return `${ZONE_LABEL[zone]}${site} ${fmt1(zoneValue(m, zone)!)} cm${delta(zoneDelta(asc, index, zone))}`
  }

  return (
    <div className="space-y-2 pt-1">
      {trends.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label="Zonas">
          <p className="label">Zonas</p>
          {trends.map((t) => (
            <div key={t.zone} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[15px]">
                  {ZONE_LABEL[t.zone]} {fmt1(t.last)} cm
                </p>
                <p className="text-[13px] text-dim">
                  {t.change === 0
                    ? `igual desde ${fmtDayMonth(t.firstDate)}`
                    : `${fmt1(Math.abs(t.change))} cm a ${t.change < 0 ? 'menos' : 'mais'} desde ${fmtDayMonth(t.firstDate)}`}
                </p>
              </div>
              <Sparkline values={t.values} width={96} />
            </div>
          ))}
        </section>
      )}
      {rows.map((m, i) => {
        const index = asc.length - 1 - i
        const c = measurementComposition(height, m, profile.sex)
        return (
          <button
            key={m.id}
            onClick={() => sheet.open('medidas', { id: m.id })}
            className="block w-full rounded-2xl border border-line bg-surface p-4 text-left"
          >
            <p className="num text-[22px] leading-tight">{fmtDayMonth(m.date)}</p>
            <p className="text-[15px]">
              {ZONE_ORDER.filter((z) => zoneValue(m, z) != null)
                .map((z) => zoneText(m, index, z))
                .join(' · ')}
            </p>
            {c && (
              <p className="text-[14px] text-dim">
                Gordura cerca de {fmt1(c.shown.fatKg)} kg ({c.shown.pct} %) · Massa magra {fmt1(c.shown.leanKg)} kg · peso{' '}
                {fmt1(Number(m.weight_used_kg))} kg
              </p>
            )}
            {m.flags.map((f) => (
              <p key={f} className="text-[13px] text-attn">
                {FLAG_TEXT[f as MeasureFlag] ?? f}
              </p>
            ))}
          </button>
        )
      })}
    </div>
  )
}
