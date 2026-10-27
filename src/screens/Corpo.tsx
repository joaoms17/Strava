import { useState, type ReactNode } from 'react'
import { useReadyProfile } from '../lib/profile'
import { useDataVersion } from '../lib/events'
import { localCalendarDate } from '../lib/day'
import { savePeriod, savedPeriod, useCorpoData } from '../lib/corpo'
import { periodFrom, type Period } from '../../api/_lib/rules/graficos'
import Ciclo from '../components/Ciclo'
import CompositionCards from '../components/CompositionCards'
import EvolucaoIA from '../components/EvolucaoIA'
import Resumo from '../components/corpo/Resumo'
import Ancoras, { BAR_OFFSET, type Section } from '../components/corpo/Ancoras'
import PesoChart from '../components/corpo/PesoChart'
import CinturaChart from '../components/corpo/CinturaChart'
import GorduraChart from '../components/corpo/GorduraChart'
import TreinoCharts from '../components/corpo/TreinoCharts'
import Recuperacao from '../components/corpo/Recuperacao'

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="space-y-3" style={{ scrollMarginTop: BAR_OFFSET }}>
      <h2 id={`${id}-titulo`} className="pt-2 font-display text-[22px] leading-none font-extrabold uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

// Corpo: primeiro o resultado (o resumo: hoje, desde o início, a projeção),
// depois o peso e as medidas, a análise da IA, o treino e, no fim, os
// sinais do corpo (passos, sono, FC em repouso, HRV). Um só período (1M /
// 3M / Tudo) para todos os gráficos, guardado neste telemóvel; os dados lêem-
// se uma vez para a página toda (lib/corpo.ts).
export default function Corpo() {
  const profile = useReadyProfile()
  const version = useDataVersion()
  const today = localCalendarDate()
  const [period, setPeriod] = useState<Period>(savedPeriod)
  const { data, loading, error } = useCorpoData(profile, today, period, version)

  if (!data) {
    return (
      <p className="pt-8 text-center text-[15px] text-dim">{error ? 'Não consegui carregar o Corpo. Tenta outra vez daqui a pouco.' : 'A carregar…'}</p>
    )
  }

  // O período que os dados lidos cobrem de facto: enquanto o «Tudo» chega
  // (ou se falhou, sem rede), os gráficos são os dos últimos 3 meses — nunca
  // «o mais baixo de sempre» tirado de 5 meses.
  const shown: Period = data.scope === 'tudo' || period !== 'Tudo' ? period : '3M'
  const offlineTudo = error && period === 'Tudo' && data.scope !== 'tudo'
  // Cada secção começa no seu primeiro registo (o relógio pode ter histórico
  // de antes da primeira pesagem).
  const first = data.firstWeighings[0]?.date ?? data.measurements[0]?.date ?? null
  const from = periodFrom(shown, today, first)
  const earliest = (dates: (string | undefined)[]) => dates.filter((d): d is string => d != null).sort()[0] ?? null
  const trainingFrom = periodFrom(shown, today, earliest([data.workouts[0]?.date, data.health.find((h) => (h.ctl ?? 0) > 0)?.date]))
  const watchFrom = periodFrom(shown, today, data.health[0]?.date ?? null)
  const target = Number(profile.target_weight_kg) > 0 ? Number(profile.target_weight_kg) : null
  const scale = profile.scale_has_bodyfat
    ? data.weights
        .filter((w) => w.body_fat_pct != null)
        .slice(-60)
        .map((w) => Number(w.body_fat_pct))
    : []
  const hasTraining = data.workouts.some((w) => (w.minutes ?? 0) > 0) || data.health.some((h) => (h.ctl ?? 0) > 0)
  const hasWatch = data.health.some((h) => h.steps != null || h.sleep_minutes != null || h.resting_hr != null || h.hrv != null)
  const sections: Section[] = [
    { id: 'peso', label: 'Peso' },
    { id: 'medidas', label: 'Medidas' },
    ...(hasTraining ? [{ id: 'treino', label: 'Treino' }] : []),
    ...(hasWatch ? [{ id: 'recuperacao', label: 'Recuperação' }] : []),
  ]
  const dimmed = loading
  const hasCharts = data.weights.length >= 2 || data.measurements.length > 0 || hasTraining || hasWatch

  return (
    <div className="space-y-4 pt-1">
      <Resumo data={data} today={today} />

      <Ancoras
        sections={sections}
        track={['peso', 'medidas', 'evolucao', ...(hasTraining ? ['treino'] : []), ...(hasWatch ? ['recuperacao'] : [])]}
        alias={{ evolucao: 'medidas' }}
        period={hasCharts ? period : null}
        onPeriod={(p) => {
          setPeriod(p)
          savePeriod(p)
        }}
      />

      {offlineTudo && <p className="text-[14px] text-dim">Sem rede: a mostrar os últimos 3 meses.</p>}

      <div className={`space-y-6 transition-opacity ${dimmed ? 'opacity-60' : ''}`} aria-busy={dimmed}>
        <Block id="peso" title="Peso">
          <PesoChart data={data} period={shown} from={from} today={today} targetKg={target} calm={profile.calm_mode} />
          {profile.sex === 'f' && <Ciclo today={today} />}
        </Block>

        <Block id="medidas" title="Medidas">
          <CinturaChart rows={data.measurements} from={from} today={today} />
          <GorduraChart rows={data.measurements} from={from} today={today} />
          <CompositionCards rows={data.measurements} scale={scale} />
        </Block>

        <Block id="evolucao" title="Evolução">
          <EvolucaoIA today={today} />
        </Block>

        {hasTraining && (
          <Block id="treino" title="Treino">
            <TreinoCharts data={data} period={shown} from={trainingFrom} today={today} />
          </Block>
        )}

        {hasWatch && (
          <Block id="recuperacao" title="Recuperação">
            <Recuperacao data={data} period={shown} from={watchFrom} today={today} />
          </Block>
        )}
      </div>
    </div>
  )
}
