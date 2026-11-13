import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useSheet } from '../../lib/sheet'
import { fmtDayShort, fmtKcal, timeOf } from '../../lib/format'
import { workoutTitle } from '../../lib/workout-actions'
import type { Workout } from '../../lib/types'
import BottomSheet from '../ui/BottomSheet'
import Icon from '../ui/Icon'
import { mergeSessions } from '../../../api/_lib/rules/sessoes'

// Um treino que o relógio partiu em dois (?partes=): os totais e as partes.
// Separada da ConfirmWorkoutSheet (T17).
export default function MergedDetail({ ids }: { ids: string[] }) {
  const sheet = useSheet()
  const [rows, setRows] = useState<Workout[] | null>(null)
  useEffect(() => {
    void supabase
      .from('workouts_active')
      .select('*')
      .in('id', ids)
      .then(({ data }) => setRows((data ?? []) as Workout[]))
  }, [ids.join(',')])

  if (!rows) {
    return (
      <BottomSheet onClose={sheet.close}>
        <p className="py-8 text-center text-[15px] text-dim">A carregar…</p>
      </BottomSheet>
    )
  }
  const session = mergeSessions(rows)[0]
  if (!session) {
    return (
      <BottomSheet title="Treino" onClose={sheet.close}>
        <p className="py-6 text-center text-[15px] text-dim">Este treino já não existe.</p>
      </BottomSheet>
    )
  }
  const parts = session.parts
  const comma = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d).replace('.', ',')
  const withKm = parts.filter((p) => (p.distance_km ?? 0) > 0)
  const kmSeconds = withKm.reduce((a, p) => a + (p.moving_s ?? (p.minutes ?? 0) * 60), 0)
  const km = withKm.reduce((a, p) => a + (p.distance_km ?? 0), 0)
  const last = parts[parts.length - 1]!
  const end = last.started_at
    ? new Date(Date.parse(last.started_at) + (last.elapsed_s ?? (last.minutes ?? 0) * 60) * 1000).toISOString()
    : null
  const tiles: [string, string][] = [
    ['Duração', `${session.minutes ?? 0} min`],
    ...(km > 0 ? ([['Distância', `${comma(km, 2)} km`]] as [string, string][]) : []),
    ...(km > 0 && kmSeconds > 0 ? ([['Velocidade', `${comma(km / (kmSeconds / 3600))} km/h`]] as [string, string][]) : []),
    ...(session.watts != null ? ([['Potência', `${session.watts} W`]] as [string, string][]) : []),
    ...(session.avg_hr != null ? ([['Batimentos médios', `${session.avg_hr} bpm`]] as [string, string][]) : []),
    ...(session.max_hr != null ? ([['Batimentos máximos', `${session.max_hr} bpm`]] as [string, string][]) : []),
    ...(session.kcal_device != null ? ([['Calorias do relógio', `${fmtKcal(session.kcal_device)} kcal`]] as [string, string][]) : []),
  ]

  return (
    <BottomSheet title={workoutTitle(session)} onClose={sheet.close}>
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-[15px] text-dim">
            {fmtDayShort(session.date)}
            {session.started_at ? ` · ${timeOf(session.started_at)}${end ? `–${timeOf(end)}` : ''}` : ''}
          </p>
          <p className="text-[14px] text-dim">
            {parts.length} partes juntas: o relógio dividiu o treino (parou e recomeçou).
          </p>
        </div>
        <p className="num text-[34px] leading-none font-extrabold text-burn">+{fmtKcal(session.kcal_est ?? 0)}</p>
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-3">
              <p className="label text-[12px]">{label}</p>
              <p className="num text-[22px] leading-tight font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <p className="label">As partes</p>
          <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-surface">
            {parts.map((p, i) => (
              <li key={p.id}>
                <button
                  onClick={() => sheet.open('confirmar-treino', { id: p.id })}
                  className="flex min-h-14 w-full items-center gap-3 px-3 text-left"
                >
                  <span className="w-14 shrink-0 text-[15px] text-dim tabular-nums">
                    {p.started_at ? timeOf(p.started_at) : `Parte ${i + 1}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] tabular-nums">
                    {[
                      p.minutes != null ? `${p.minutes} min` : null,
                      p.distance_km != null ? `${comma(p.distance_km, 2)} km` : null,
                      p.watts != null ? `${p.watts} W` : null,
                      p.avg_hr != null ? `${p.avg_hr} bpm` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="num shrink-0 text-[18px] text-burn">+{fmtKcal(p.kcal_est ?? 0)}</span>
                  <Icon name="chevron" size={18} className="shrink-0 text-dim" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-dim">Para corrigir ou apagar, abre a parte.</p>
        </div>
      </div>
    </BottomSheet>
  )
}
