import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useThemeColors } from '../lib/colors'
import { fmtDayShort } from '../lib/format'
import { MIN_EFFICIENCY_MINUTES, bikeEfficiency, type EfficiencyPoint } from '../../api/_lib/rules/plano'
import type { Workout } from '../lib/types'

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const comma = (n: number, digits = 2) => n.toFixed(digits).replace('.', ',')

// Treino › Progressão na bicicleta: só o que se pode comparar entre sessões —
// watts por batimento (com potência) ou metros por batimento (com distância,
// rolo com rolo, estrada com estrada), em sessões de 20 min ou mais. Os
// batimentos sozinhos não se comparam: cada sessão teve o seu ritmo.
export default function BikeHrChart({ workouts }: { workouts: Workout[] }) {
  const colors = useThemeColors()
  const { metric, points, left_out } = bikeEfficiency(workouts)
  const anyBike = workouts.some((w) => w.type === 'bike')
  if (!anyBike) return null

  if (!metric) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 text-[15px]">
        <p className="font-semibold">Eficiência na bicicleta</p>
        <p className="mt-1 text-dim">
          Para comparar sessões é preciso saber o esforço de cada uma: a potência (watts) ou a distância. Os batimentos
          sozinhos não chegam, porque cada sessão teve o seu ritmo. Com um sensor de potência ou de velocidade na
          bicicleta (ou o print da consola com os watts), em 2 sessões de {MIN_EFFICIENCY_MINUTES} min ou mais o gráfico
          aparece aqui.
        </p>
      </div>
    )
  }

  const unit = metric === 'watts' ? 'W por batimento' : 'm por batimento'
  const first = points[0]!
  const last = points[points.length - 1]!
  const change = Math.round(((last.value - first.value) / first.value) * 100)

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-[15px] font-semibold">
        {metric === 'watts' ? 'Watts por batimento' : 'Metros por batimento'}
      </p>
      <p className="text-[13px] text-dim">
        Se sobe, fazes o mesmo esforço com menos batimentos.{' '}
        {points.length >= 2 &&
          `Desde ${dm(first.date)}: ${change > 0 ? '+' : ''}${change} %.`}
      </p>
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={colors.line} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={dm}
              tick={{ fill: colors.dim, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => comma(v)}
              tick={{ fill: colors.dim, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: colors.line }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as EfficiencyPoint | undefined
                if (!active || !p) return null
                return (
                  <div
                    className="rounded-xl px-3 py-2 text-[13px] tabular-nums shadow"
                    style={{ background: colors.surface, border: `1px solid ${colors.line}`, color: colors.ink }}
                  >
                    <p style={{ color: colors.dim }}>{fmtDayShort(p.date)}</p>
                    <p>
                      {comma(p.value)} {unit}
                    </p>
                    <p style={{ color: colors.dim }}>
                      {[
                        `${p.minutes} min`,
                        p.watts != null ? `${p.watts} W` : null,
                        p.speed_kmh != null ? `${comma(p.speed_kmh, 1)} km/h` : null,
                        `FC ${p.avg_hr}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                )
              }}
            />
            <Line
              isAnimationActive={false}
              dataKey="value"
              stroke={colors['chart-bike']}
              strokeWidth={2}
              dot={{ r: 4, fill: colors['chart-bike'], stroke: colors.surface, strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: colors.surface, strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {left_out > 0 && (
        <p className="mt-1 text-[13px] text-dim">
          {left_out === 1 ? '1 sessão não entra' : `${left_out} sessões não entram`} (menos de {MIN_EFFICIENCY_MINUTES} min
          ou sem {metric === 'watts' ? 'potência' : 'distância'}): não dá para comparar.
        </p>
      )}
    </div>
  )
}
