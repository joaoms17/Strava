import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { postApi } from '../lib/api'
import { useSheet } from '../lib/sheet'
import { useDataVersion } from '../lib/events'
import { useReadyProfile } from '../lib/profile'
import { nutritionalDay, shiftDate } from '../lib/day'
import { fmtKcal, weekdayShort } from '../lib/format'
import { workoutTitle } from '../lib/workout-actions'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { bikeSuggestion, nextBikeTarget } from '../../api/_lib/rules/progressao-bike'
import { fmtSleep, hasSleep, poorNight, type NightSleep } from '../../api/_lib/rules/sono'
import type { ExerciseLogRow, Favorite, Workout, WorkoutImport } from '../lib/types'
import Icon from '../components/ui/Icon'
import BikeHrChart from '../components/BikeHrChart'
import LoadChart from '../components/LoadChart'
import { useAutoSync } from '../lib/intervals'
import { useLocation } from 'wouter'
import WorkoutLogOptions from '../components/WorkoutLogOptions'
import PlanoTreinoCard from '../components/PlanoTreinoCard'
import QualFoi from '../components/QualFoi'
import PendingInfo from '../components/PendingInfo'
import { duplicatePairs, mergeSessions, possibleDuplicates, zoneMinutes } from '../../api/_lib/rules/sessoes'
import Duplicado from '../components/Duplicado'
import { useGymQueue } from '../lib/ginasio-fila'
import { workoutOrigin } from '../lib/treino-origem'
import { usesBikePower, wattsChoices } from '../lib/bicicleta'
import { OLDER_PAGE, WORKOUT_LIST_COLUMNS, fromListRows } from '../lib/treino-lista'


interface TreinoData {
  workouts: Workout[]
  favorites: Favorite[]
  pending: WorkoutImport[]
  logs: ExerciseLogRow[]
  sleep: NightSleep | null
}

// Treino: o plano da semana, registar (um print do relógio ou de outra app, ou
// dizer/escrever o que fizeste) e ver o que gastou e como progride. Os treinos
// do relógio chegam sozinhos (Definições › Ligações).
export default function Treino() {
  const version = useDataVersion()
  const sheet = useSheet()
  const profile = useReadyProfile()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  const [data, setData] = useState<TreinoData | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Treinos com mais de 12 semanas (histórico importado): só a pedido, de
  // 100 em 100 (P5; antes vinham até 500 completos de uma vez e mais nada).
  const [older, setOlder] = useState<Workout[] | null>(null)
  const [olderMore, setOlderMore] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [, navigate] = useLocation()
  // Os treinos não se leram (sem rede): diz-se, em vez de «Ainda sem treinos» (T11).
  const [failed, setFailed] = useState(false)
  const gymQueue = useGymQueue()
  useAutoSync()

  const load = useCallback(async () => {
    const [{ data: workouts, error }, { data: favorites }, { data: pending }, { data: logs }, { data: health }] = await Promise.all([
      supabase
        .from('workouts_active')
        // Só as colunas usadas, sem os JSON em bruto (P5).
        .select(WORKOUT_LIST_COLUMNS)
        .gte('date', shiftDate(today, -83))
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('favorites')
        .select('*')
        .eq('kind', 'workout')
        .eq('archived', false)
        .order('use_count', { ascending: false }),
      supabase
        .from('workout_imports')
        .select('*')
        .in('status', ['a_ler', 'por_confirmar', 'erro'])
        .order('created_at', { ascending: false })
        .limit(30),
      // As séries mais recentes (as mais antigas ficavam e as de agora saíam do gráfico).
      supabase
        .from('exercise_log')
        .select('workout_id,exercise,set_index,reps,load_kg,rpe,created_at')
        .order('created_at', { ascending: false })
        .limit(600),
      supabase.from('health_daily').select('*').eq('date', today).maybeSingle(),
    ])
    if (error) {
      setFailed(true)
      return
    }
    setFailed(false)
    setData({
      workouts: fromListRows(workouts),
      favorites: (favorites ?? []) as Favorite[],
      // Os prints lidos ficam até serem guardados ou descartados (nunca contam
      // sozinhos); os que estão a ler ou deram erro, só os da última semana.
      pending: ((pending ?? []) as WorkoutImport[]).filter(
        (row) => row.status === 'por_confirmar' || Date.now() - Date.parse(row.created_at) < 7 * 86_400_000,
      ),
      logs: ((logs ?? []) as ExerciseLogRow[]).reverse(),
      sleep: hasSleep(health as Partial<NightSleep> | null) ? (health as NightSleep) : null,
    })
  }, [today])

  useEffect(() => {
    void load()
  }, [load, version])

  // «A ler o print…» atualiza-se sozinho depois de fechar a folha (T20): de
  // 3 em 3 s enquanto houver um print a ler; uma leitura parada (a função
  // morreu) pede-se outra vez, uma vez só, como na folha.
  const reading = data?.pending.filter((r) => r.status === 'a_ler') ?? []
  const kicked = useRef(new Set<string>())
  useEffect(() => {
    if (reading.length === 0) return
    for (const row of reading) {
      const stale =
        Date.now() - Date.parse(row.created_at) > 20_000 &&
        (row.analysis_started_at == null || Date.now() - Date.parse(row.analysis_started_at) > 90_000)
      if (stale && !kicked.current.has(row.id)) {
        kicked.current.add(row.id)
        void postApi('/api/workout/parse-shot', { import_id: row.id }).then(load, load)
      }
    }
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 3000)
    return () => clearInterval(timer)
  }, [reading.map((r) => r.id).join(','), load])

  const queueBanner = gymQueue.queued.length > 0 && (
    <section className="space-y-2" aria-label="Por enviar">
      {gymQueue.queued.map((q) => (
        <div key={q.client_id} className="space-y-2 rounded-[18px] border border-attn/50 bg-attn/10 p-4">
          <p className="text-[16px]">
            <span className="font-semibold">{q.label}</span>
            {q.error ? `: não foi aceite (${q.error})` : ': por enviar, vai sozinho quando houver rede.'}
          </p>
          {q.error && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => gymQueue.retry(q)} className="min-h-12 rounded-xl border border-line text-[15px]">
                Tentar outra vez
              </button>
              <button onClick={() => gymQueue.discard(q)} className="min-h-12 rounded-xl border border-line text-[15px] text-pain">
                Descartar
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )

  if (failed && !data) {
    return (
      <div className="space-y-4 pt-1">
        {queueBanner}
        <div className="space-y-3 rounded-[18px] border border-line bg-surface p-4">
          <p className="text-[16px]">
            <span className="block font-semibold">Não consegui ler os teus treinos.</span>
            <span className="text-dim">Sem rede? Podes registar na mesma; aparecem quando houver rede.</span>
          </p>
          <button onClick={() => void load()} className="min-h-12 w-full rounded-xl border border-line text-[15px]">
            Tentar outra vez
          </button>
        </div>
        <WorkoutLogOptions />
      </div>
    )
  }
  if (!data) return <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>

  const { workouts, favorites, pending } = data
  const monday = mondayOf(today)
  // Um treino que o relógio partiu em dois (parou e recomeçou) conta como um.
  const sessions = mergeSessions(workouts)
  const week = sessions.filter((w) => w.date >= monday && w.date <= today)
  const weekMinutes = week.reduce((a, w) => a + (w.minutes ?? 0), 0)
  const weekKcal = week.reduce((a, w) => a + (w.kcal_est ?? 0), 0)
  // Minutos em zona 2 (ritmo leve) esta semana, quando o relógio manda o tempo por zona.
  const weekZone2 = zoneMinutes(week.flatMap((w) => w.parts), 2)
  // O mesmo treino registado duas vezes (ex.: «Já fiz» e o do relógio).
  const duplicates = possibleDuplicates(sessions)
  // Os das últimas 2 semanas perguntam «Juntar os dois» (os mais antigos só
  // ficam marcados no histórico).
  const pairs = duplicatePairs(sessions.filter((w) => w.date >= shiftDate(today, -13))).reverse().slice(0, 3)

  const openWorkout = (w: Workout & { parts?: Workout[] }) =>
    w.type === 'strength' && data.logs.some((l) => l.workout_id === w.id)
      ? navigate(`/treino/ginasio?id=${w.id}`)
      : sheet.open('confirmar-treino', {
          id: w.id,
          ...((w.parts?.length ?? 0) > 1 ? { partes: w.parts!.map((p) => p.id).join(',') } : {}),
        })


  const bikes = sessions.filter((w) => w.type === 'bike')
  // As potências das Definições ou das últimas sessões, nunca números fixos (T15).
  const wattsOptions = wattsChoices(
    profile.bike_watts_options,
    bikes
      .filter((w) => w.watts_source !== 'prefill')
      .map((w) => w.watts)
      .reverse(),
  )
  const target = nextBikeTarget(
    bikes.map((w) => ({
      watts: w.watts,
      minutes: w.minutes,
      avg_hr: w.avg_hr,
      max_hr: w.max_hr,
      status: w.status,
      watts_source: w.watts_source ?? null,
      rpe: w.rpe ?? null,
      date: w.date,
    })),
    wattsOptions,
    { avgHr: profile.bike_hr_avg_cap, maxHr: profile.bike_hr_max_cap },
    today,
  )
  const suggestion = bikeSuggestion(target)
  // A sugestão da bicicleta só para quem anda de bicicleta com potência: uma
  // volta de estrada do relógio (sem watts) não chega (T15).
  const ridesBike =
    wattsOptions.length > 0 &&
    usesBikePower({
      profileOptions: profile.bike_watts_options,
      bikeFavorites: favorites.filter((f) => f.workout?.type === 'bike').length,
      bikes,
    })

  const history = [...sessions.slice().reverse(), ...mergeSessions(older ?? []).reverse()]
  async function loadOlder() {
    const from = older?.length ?? 0
    setOlderBusy(true)
    const { data: rows, error } = await supabase
      .from('workouts_active')
      .select(WORKOUT_LIST_COLUMNS)
      .lt('date', shiftDate(today, -83))
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + OLDER_PAGE - 1)
    setOlderBusy(false)
    if (error) return
    const page = fromListRows(rows)
    setOlder([...(older ?? []), ...page])
    setOlderMore(page.length === OLDER_PAGE)
    setShowAll(true)
  }
  const shown = showAll ? history : history.slice(0, 8)


  return (
    <div className="space-y-4 pt-1">
      {queueBanner}
      {failed && (
        <p className="rounded-xl bg-attn/15 px-3 py-2 text-[15px] text-attn">
          Sem rede: estes são os treinos da última vez que li.
        </p>
      )}
      {pending.map((row) => (
        <button
          key={row.id}
          onClick={() => sheet.open('confirmar-treino', { import: row.id })}
          className="flex w-full items-center gap-3 rounded-[18px] border border-burn/50 bg-burn/10 p-4 text-left"
        >
          <Icon name="watch" />
          <span className="flex-1 text-[16px]">
            {row.status === 'a_ler'
              ? 'A ler o print do relógio…'
              : row.status === 'erro'
                ? 'Não consegui ler um print. Toca para ver.'
                : 'Print lido · falta confirmar'}
          </span>
          <Icon name="chevron" size={20} />
        </button>
      ))}

      {/* Os treinos que já se leram servem ao «Qual foi?» (sem outra consulta; P5). */}
      <QualFoi today={today} workouts={workouts} />

      {pairs.map(([a, b]) => (
        <Duplicado key={`${a.id}+${b.id}`} a={a} b={b} />
      ))}

      {week.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Sessões', String(week.length), ''],
            ['Minutos', String(weekMinutes), ''],
            ['Kcal do treino', `+${fmtKcal(weekKcal)}`, 'text-burn'],
          ].map(([label, value, tone]) => (
            // O número em baixo nos três: «Kcal do treino» pode ocupar 2 linhas.
            <div key={label} className="flex flex-col justify-between gap-1 rounded-2xl border border-line bg-surface p-3">
              <p className="label text-[12px]">{label}</p>
              <p className={`num text-[34px] leading-none font-extrabold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
      )}
      {weekZone2 != null && weekZone2 > 0 && (
        <p className="-mt-2 text-[14px] text-dim">{weekZone2} min em zona 2 (ritmo leve, aeróbio) esta semana.</p>
      )}

      <WorkoutLogOptions />

      <PlanoTreinoCard />

      <PendingInfo workouts={workouts} today={today} />

      {ridesBike && (
      <div className="rounded-[18px] border border-line bg-surface p-4">
        <p className="font-display text-[12px] font-bold tracking-[0.16em] text-burn uppercase">Próxima bicicleta</p>
        <p className="mt-1 text-[17px] font-medium">{suggestion}</p>
        {data.sleep && poorNight(data.sleep) && (
          <p className="mt-2 text-[15px] text-attn">
            Dormiste mal esta noite
            {data.sleep.sleep_score != null
              ? ` (sono ${data.sleep.sleep_score})`
              : data.sleep.sleep_minutes != null
                ? ` (${fmtSleep(data.sleep.sleep_minutes)})`
                : ''}
            . Hoje não subas: repete os watts da última vez ou faz menos tempo.
          </p>
        )}
      </div>
      )}


      {/* Sem treinos (a Joana): o que fazer, em vez de um ecrã que parece por carregar. */}
      {workouts.length === 0 && (
        <p className="rounded-[18px] border border-line bg-surface p-4 text-[15px] text-dim">
          <span className="block font-semibold text-ink">Ainda sem treinos.</span>
          Uma caminhada ou uma aula registam-se com «Dizer» ou «À mão».
          {!profile.integration_status?.intervals?.connected &&
            ' Os do relógio chegam sozinhos se ligares o intervals.icu nas Definições.'}
        </p>
      )}

      {workouts.length > 0 && (
        <section>
          <p className="label mb-1">Histórico</p>
          <div className="divide-y divide-line/60">
            {shown.map((w) => (
              <button
                key={w.id}
                onClick={() => openWorkout(w)}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <span className="flex w-11 shrink-0 flex-col items-center">
                  <span className="font-display text-[12px] font-semibold tracking-[0.1em] text-dim uppercase">
                    {weekdayShort(w.date)}
                  </span>
                  <span className="num text-[24px] leading-none font-extrabold">{Number(w.date.slice(8))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[16px] font-semibold">
                    {workoutTitle(w)}
                    {duplicates.has(w.id) && (
                      <span className="rounded bg-attn/15 px-1.5 text-[12px] font-normal text-attn">possível duplicado</span>
                    )}
                  </span>
                  <span className="block truncate text-[14px] text-dim">
                    {[
                      w.minutes != null ? `${w.minutes} min` : null,
                      w.distance_km != null ? `${String(w.distance_km).replace('.', ',')} km` : null,
                      w.watts != null ? `${w.watts_source === 'prefill' ? '≈' : ''}${w.watts} W` : null,
                      w.avg_hr != null ? `${w.avg_hr} bpm` : null,
                      workoutOrigin(w),
                      w.parts.length > 1 ? `${w.parts.length} partes juntas` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {/* «≈» numa estimativa (ex.: o ginásio sem calorias do relógio, ao teu ritmo). */}
                <span className="num shrink-0 text-[22px] text-burn">
                  {w.kcal_estimated ? '≈ ' : ''}+{fmtKcal(w.kcal_est ?? 0)}
                </span>
              </button>
            ))}
          </div>
          {history.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-[15px] text-dim">
              Ver mais ({history.length - shown.length})
            </button>
          )}
          {history.length <= shown.length && (older == null || olderMore) && (
            <button
              onClick={() => void loadOlder()}
              disabled={olderBusy}
              className="mt-2 min-h-11 text-[15px] text-dim disabled:opacity-60"
            >
              {olderBusy ? 'A carregar…' : older == null ? 'Ver treinos mais antigos' : 'Mais'}
            </button>
          )}
          {older != null && older.length === 0 && (
            <p className="mt-2 text-[14px] text-dim">Não há treinos com mais de 12 semanas.</p>
          )}
        </section>
      )}

      {bikes.some((w) => w.avg_hr != null) && (
        <section className="space-y-2">
          <p className="label">Progressão na bicicleta</p>
          <BikeHrChart workouts={workouts} />
        </section>
      )}

      {data.logs.length > 0 && (
        <section className="space-y-2">
          <p className="label">Cargas no ginásio</p>
          <LoadChart logs={data.logs} workoutDates={new Map(workouts.map((w) => [w.id, w.date]))} />
        </section>
      )}
    </div>
  )
}
