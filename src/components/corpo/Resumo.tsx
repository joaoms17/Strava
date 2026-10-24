import { useSheet } from '../../lib/sheet'
import { useReadyProfile } from '../../lib/profile'
import { shiftDate } from '../../lib/day'
import { fmt1, fmtDayMonth, fmtDayShort } from '../../lib/format'
import type { CorpoData } from '../../lib/corpo'
import { FAST_LOSS_KG_WEEK, MIN_WEIGHINGS_FOR_TREND, trend7, weeklyRate } from '../../../api/_lib/rules/weight'
import { inWaterPhase } from '../../../api/_lib/rules/manutencao'
import { composition, sameWaistSite } from '../../../api/_lib/rules/composicao'
import { signed1, sinceStart } from '../../../api/_lib/rules/leituras'
import Projecao from '../Projecao'

function rateText(rate: number): string {
  const abs = fmt1(Math.abs(rate))
  if (Math.abs(rate) < 0.05) return 'estável'
  return rate < 0 ? `a descer ${abs} kg por semana` : `a subir ${abs} kg por semana`
}

// Corpo › o topo: o peso de hoje (ou o peso médio, no modo calmo), o ritmo da
// semana, «Desde o início» (kg, cintura e %G do primeiro registo a agora, a
// verde quando vão para o lado do alvo) e a linha da projeção.
export default function Resumo({ data, today }: { data: CorpoData; today: string }) {
  const profile = useReadyProfile()
  const sheet = useSheet()
  const weights = data.weights
  const series = weights.map((w) => ({ date: w.date, value: w.kg }))
  const trend = trend7(series)
  const rate = weeklyRate(series)
  const last = trend[trend.length - 1]
  const threeWeeksAgo = last ? trend.find((p) => p.date >= shiftDate(last.date, -21)) : undefined
  const stable =
    last != null &&
    threeWeeksAgo != null &&
    threeWeeksAgo.date <= shiftDate(last.date, -18) &&
    Math.abs(last.value - threeWeeksAgo.value) < 0.3
  const waterPhase = inWaterPhase(profile.maintenance_anchor, today, profile.maintenance_enabled !== false)
  const latest = weights[weights.length - 1]
  const previous = weights[weights.length - 2]
  const enough = weights.length >= MIN_WEIGHINGS_FOR_TREND
  const when = (date: string) => (date === today ? 'hoje' : date === shiftDate(today, -1) ? 'ontem' : fmtDayShort(date))
  const diff = latest && previous ? Math.round((latest.kg - previous.kg) * 10) / 10 : null

  // «Desde o início»: a cintura e a %G só com medições no mesmo sítio da última.
  const height = Number(profile.height_cm ?? 183)
  const lastWaist = [...data.measurements].reverse().find((m) => m.waist_cm != null)
  const comparable = lastWaist ? data.measurements.filter((m) => m.waist_cm != null && sameWaistSite(m, lastWaist)) : []
  const fat = comparable
    .map((m) => {
      if (m.neck_cm == null) return null
      const c = composition(
        height,
        { neck_cm: Number(m.neck_cm), waist_cm: Number(m.waist_cm), hips_cm: m.hips_cm != null ? Number(m.hips_cm) : null, weight_used_kg: Number(m.weight_used_kg) },
        profile.sex,
      )
      return c ? { date: m.date, value: c.pct } : null
    })
    .filter((x): x is { date: string; value: number } => x != null)
  const since = sinceStart({
    firstWeighings: data.firstWeighings,
    trend,
    waist: comparable.map((m) => ({ date: m.date, value: Number(m.waist_cm) })),
    fat,
    targetKg: Number(profile.target_weight_kg) > 0 ? Number(profile.target_weight_kg) : null,
    waterDay: data.projection.input.waterDay,
  })
  // Cada número diz de quando conta, quando não é da primeira pesagem (a
  // primeira cintura no mesmo sítio pode ser semanas depois).
  const from = (date: string | null) => (since && date && date !== since.since ? ` · desde ${fmtDayMonth(date)}` : '')
  const tiles = since
    ? [
        since.kg != null ? { value: `${signed1(since.kg)} kg`, label: 'peso médio', good: since.kgGood } : null,
        since.cm != null ? { value: `${signed1(since.cm)} cm`, label: `cintura${from(since.cmSince)}`, good: since.cmGood } : null,
        since.fat != null ? { value: `${signed1(since.fat)}`, label: `pontos de %G${from(since.fatSince)}`, good: since.fatGood } : null,
      ].filter((t): t is { value: string; label: string; good: boolean } => t != null)
    : []

  return (
    <section id="resumo" className="space-y-4 rounded-3xl bg-surface p-5" aria-label="Resumo">
      {!latest ? (
        <p className="text-[15px] text-dim">Pesa-te de manhã, antes de comer.</p>
      ) : profile.calm_mode && enough && last ? (
        // Modo calmo: sem o peso de cada dia, só a média da semana.
        <div className="space-y-1">
          <p className="label">Peso médio</p>
          <p className="text-[64px] leading-none font-extrabold text-body font-display">
            {fmt1(last.value)} <span className="text-[22px] font-semibold">kg</span>
          </p>
          {rate != null && <p className="text-[15px]">{rateText(rate)}</p>}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="label">Último peso · {when(latest.date)}</p>
          <p className="text-[64px] leading-none font-extrabold text-body font-display">
            {fmt1(latest.kg)} <span className="text-[22px] font-semibold">kg</span>
          </p>
          {diff != null && previous && (
            <p className="text-[15px] tabular-nums">
              {diff === 0
                ? `Igual a ${when(previous.date)}`
                : `${diff < 0 ? '−' : '+'}${fmt1(Math.abs(diff))} kg desde ${when(previous.date)}`}
              {rate != null && <span className="text-dim"> · {rateText(rate)}</span>}
            </p>
          )}
        </div>
      )}

      {rate != null &&
        rate < -FAST_LOSS_KG_WEEK &&
        (waterPhase ? (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">
            A descer depressa, mas é normal agora: nas primeiras semanas (da dieta ou depois da manutenção) sai sobretudo
            água.
          </p>
        ) : (
          <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-attn">
            Estás a perder depressa (mais de 0,85 kg por semana). Come um pouco mais para proteger o músculo.
          </p>
        ))}
      {stable && rate != null && Math.abs(rate) < 0.1 && (
        <p className="rounded-xl bg-surface2 px-3 py-2 text-[15px] text-dim">Peso estável há 3 semanas. A app ajusta o gasto sozinha.</p>
      )}

      {since && tiles.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="label">Desde o início · {fmtDayMonth(since.since)}</p>
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl bg-surface2 px-2.5 py-2">
                <p className={`font-display text-[24px] leading-tight font-bold ${t.good ? 'text-ok' : 'text-ink'}`}>
                  {t.value}
                  {t.good && <span className="sr-only"> (a melhorar)</span>}
                </p>
                <p className="text-[12px] leading-tight text-dim">{t.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-line pt-3">
        <Projecao today={today} data={data.projection} embedded />
      </div>

      <button onClick={() => sheet.open('peso')} className="min-h-12 w-full rounded-2xl bg-surface2 text-[15px] font-semibold">
        Pesar
      </button>
    </section>
  )
}
