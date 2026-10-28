import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import { supabase } from '../lib/supabase'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { useSheet } from '../lib/sheet'
import { BusyButton } from '../lib/busy'
import { loadExpenditure, type ExpenditureContext } from '../lib/expenditure'
import { shareWeekReport } from '../lib/week-report'
import ProteinaRefeicao from '../components/ProteinaRefeicao'
import { useDataVersion } from '../lib/events'
import { nutritionalDay, shiftDate } from '../lib/day'
import { NBSP, fmt1, fmtInt, fmtKcal, fmtRange, weekdayShort } from '../lib/format'
import { scopedKey } from '../lib/scoped'
import { useBalancoLongo, useProteinBySlot } from '../lib/balanco'
import { weekAgo } from '../lib/projecao'
import { daysEarlier, moveNote, project, projectionLine } from '../../api/_lib/rules/projecao'
import { dayResult, weekAction, weekFacts } from '../../api/_lib/rules/balanco-graficos'
import SemanaChart from '../components/balanco/SemanaChart'
import SemanaASemana from '../components/balanco/SemanaASemana'
import ParaEstaSemana from '../components/balanco/ParaEstaSemana'
import CalendarioMes from '../components/balanco/CalendarioMes'
import { isDayComplete } from '../../api/_lib/rules/day-close'
import { waterWeekDuring } from '../../api/_lib/rules/ciclo'
import { mondayOf, isMaintenanceWeek, maintenanceTarget } from '../../api/_lib/rules/manutencao'
import { storedExerciseKcal } from '../../api/_lib/rules/targets'
import { MIN_COMPLETE_DAYS } from '../../api/_lib/rules/adaptativo'
import {
  COHERENCE_TEXT,
  baseSuggestion,
  coherence,
  kcalOut,
  measuredVsFormula,
  persistentGap,
  round10,
  weekSentence,
} from '../../api/_lib/rules/gasto'
import { weeklyRateAsOf } from '../../api/_lib/rules/weight'
import { belowFloor, countedDays, leftOutDates, weekAverages, type BalanceDay } from '../../api/_lib/rules/balanco'
import type { Meal, Workout } from '../lib/types'
import BalancoMes from '../components/BalancoMes'
import { previousMonth } from '../../api/_lib/rules/mes'
import ContaGordura from '../components/ContaGordura'
import { mergeSessions } from '../../api/_lib/rules/sessoes'
import { SEGMENT_TRACK, segment } from '../components/ui/Chips'

// O lugar de um cartão que ainda vem a caminho, com a altura final (sem saltos).
function CardSkeleton({ height }: { height: number }) {
  return <div className="animate-pulse rounded-[18px] border border-line bg-surface" style={{ height }} aria-hidden />
}

interface WeekData {
  monday: string // a semana destes dados (ao mudar de semana, os antigos não ficam por baixo)
  days: (BalanceDay & { out: number; missing: boolean })[]
  workouts: Workout[]
  rate: number | null
  completeDays: number
  steps: number | null
  sleep: number | null
  sleepScore: number | null
  expenditure: ExpenditureContext
  firstDate: string | null
  review: string | null
  lastWeekReview: string | null
  weeklyGaps: number[]
  avg7: number | null
}

// Semana ou Mês: a escolha fica neste telemóvel, para cada pessoa.
const VIEW_KEY = 'regresso.balanco.vista'
function savedView(): 'semana' | 'mes' {
  try {
    return localStorage.getItem(scopedKey(VIEW_KEY)) === 'mes' ? 'mes' : 'semana'
  } catch {
    return 'semana'
  }
}
function saveView(view: 'semana' | 'mes') {
  try {
    localStorage.setItem(scopedKey(VIEW_KEY), view)
  } catch {
    // sem armazenamento: fica só nesta visita
  }
}

// «Estou a comer menos do que gasto, e o peso confirma?» — a frase com o
// selo, o gráfico da semana (tocar num dia mostra os números), uma ação para
// esta semana, a proteína por refeição e as últimas 12 semanas lado a lado.
export default function Balanco() {
  const profile = useReadyProfile()
  const [, navigate] = useLocation()
  const version = useDataVersion()
  const today = nutritionalDay(new Date(), profile.nutrition_day_cutoff_hour)
  // Aberto pela notificação «Resumo da semana pronto»: ?semana=<segunda>.
  const asked = new URLSearchParams(useSearch()).get('semana')
  const askedMonday = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? mondayOf(asked) : null
  const [monday, setMonday] = useState(() => askedMonday ?? mondayOf(today))
  useEffect(() => {
    if (askedMonday) setMonday(askedMonday)
  }, [askedMonday])
  const [data, setData] = useState<WeekData | null>(null)
  const [details, setDetails] = useState(false)
  const [view, setViewState] = useState<'semana' | 'mes'>(() => (askedMonday ? 'semana' : savedView()))
  const setView = (v: 'semana' | 'mes') => {
    setViewState(v)
    saveView(v)
  }
  const [birthYear, setBirthYear] = useState('')
  const { update } = useProfile()
  const toast = useToast()
  const sheet = useSheet()
  const sunday = shiftDate(monday, 6)
  // O que não muda com a semana vista: lido uma vez para a página.
  const { data: longo, failed: longoFailed } = useBalancoLongo(profile, today, version)
  const { rows: protein, failed: proteinFailed } = useProteinBySlot(sunday < today ? shiftDate(sunday, 1) : today, version)
  const openDay = (date: string) => navigate(date === today ? '/hoje' : `/hoje/${date}`)
  // Só a resposta do último pedido conta (‹ › seguidos).
  const loads = useRef(0)

  const load = useCallback(async () => {
    const request = ++loads.current
    const [
      { data: meals },
      { data: uncounted },
      { data: workouts },
      { data: dayRows },
      { data: weights },
      { count: completeCount },
      { data: health },
      { data: first },
      { data: reviews },
      { data: history },
      expenditure,
      { data: lastComplete },
    ] = await Promise.all([
      supabase
        .from('meals_counted')
        .select('date,kcal,protein,carbs,fat')
        .gte('date', monday)
        .lte('date', sunday),
      // Fotos ainda sem números: o dia não conta (regra 5), como no fecho do dia.
      supabase
        .from('meals')
        .select('date')
        .gte('date', monday)
        .lte('date', sunday)
        .is('deleted_at', null)
        .in('status', ['a_analisar', 'sem_analise', 'erro']),
      supabase.from('workouts_active').select('*').gte('date', monday).lte('date', sunday),
      // Tudo (`*`): o plano base de cada dia (base_kcal) só existe com a migração 20261018140000.
      supabase.from('days').select('*').gte('date', monday).lte('date', sunday),
      supabase
        .from('weights')
        .select('date,kg')
        .gte('date', shiftDate(sunday, -40))
        .lte('date', sunday)
        .order('date'),
      // Dias completos até ao fim desta semana (numa semana passada, os de então).
      supabase.from('days').select('date', { count: 'exact', head: true }).eq('is_complete', true).lte('date', sunday),
      supabase.from('health_daily').select('*').gte('date', monday).lte('date', sunday),
      // Primeira refeição (o histórico importado do relógio cria dias sem comida).
      supabase.from('meals_counted').select('date').order('date').limit(1),
      // O resumo desta semana e o da anterior (a cron escreve-o na segunda-feira).
      supabase
        .from('weekly_reviews')
        .select('week_start,text')
        .in('week_start', [monday, shiftDate(monday, -7)])
        .eq('kind', 'neutro'),
      // Para o gasto medido contra a fórmula nas últimas 3 semanas.
      supabase
        .from('days')
        .select('date,tdee_est,formula_base,kcal_exercise,is_complete')
        .gte('date', shiftDate(monday, -35))
        .lt('date', monday)
        .order('date'),
      loadExpenditure(profile, monday),
      // Média do que se comeu nos últimos 7 dias completos (até ao fim desta semana, sem hoje).
      supabase
        .from('days')
        .select('kcal_in')
        .eq('is_complete', true)
        .lte('date', sunday < today ? sunday : shiftDate(today, -1))
        .order('date', { ascending: false })
        .limit(7),
    ])
    if (request !== loads.current) return
    const workoutRows = (workouts ?? []) as Workout[]
    type StoredDay = {
      date: string
      flags: string[] | null
      kcal_out_est: number | null
      tdee_est: number | null
      base_kcal?: number | null
    }
    const rowByDate = new Map(((dayRows ?? []) as StoredDay[]).map((d) => [d.date, d]))
    const uncountedByDate = new Map<string, number>()
    for (const m of (uncounted ?? []) as { date: string }[]) uncountedByDate.set(m.date, (uncountedByDate.get(m.date) ?? 0) + 1)
    const hist = (history ?? []) as { date: string; tdee_est: number | null; formula_base: number | null; kcal_exercise: number | null; is_complete: boolean }[]
    // A meta de um dia de pausa: o último gasto medido antes desse dia (como o fecho do dia).
    const tdees = [...hist, ...((dayRows ?? []) as StoredDay[])]
      .filter((d) => d.tdee_est != null)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    const tdeeBefore = (date: string) => {
      const found = [...tdees].reverse().find((d) => d.date < date)
      return found ? Number(found.tdee_est) : null
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = shiftDate(monday, i)
      const ofDay = ((meals ?? []) as Pick<Meal, 'date' | 'kcal' | 'protein' | 'carbs' | 'fat'>[]).filter(
        (m) => m.date === date,
      )
      const exercise = storedExerciseKcal(
        workoutRows
          .filter((w) => w.date === date)
          .map((w) => ({
            type: w.type,
            minutes: w.minutes,
            watts: w.watts,
            deviceCalories: w.raw?.calories ?? null,
            kcal_est: w.kcal_est,
          })),
      )
      const maintenance =
        profile.maintenance_enabled !== false &&
        profile.maintenance_anchor != null &&
        isMaintenanceWeek(profile.maintenance_anchor, date)
      const sum = (pick: (m: (typeof ofDay)[number]) => number) => ofDay.reduce((a, m) => a + Number(pick(m)), 0)
      const row = rowByDate.get(date)
      const flags = row?.flags ?? []
      const eaten = sum((m) => m.kcal)
      // O plano base desse dia (o guardado no fecho); hoje e sem migração, o de hoje.
      const base = date < today && row?.base_kcal != null ? Number(row.base_kcal) : profile.base_kcal
      return {
        date,
        eaten,
        protein: sum((m) => m.protein),
        carbs: sum((m) => m.carbs),
        fat: sum((m) => m.fat),
        meals: ofDay.length,
        // Marcado «faltou algo»: o dia tocado diz porquê e deixa voltar atrás.
        missing: flags.includes('faltou_algo'),
        plan: maintenance ? maintenanceTarget(tdeeBefore(date)) : base + exercise,
        complete: isDayComplete({
          mealCount: ofDay.length,
          kcalIn: eaten,
          manuallyClosed: flags.includes('dia_fechado'),
          missingSomething: flags.includes('faltou_algo'),
          uncountedMeals: uncountedByDate.get(date) ?? 0,
        }),
        // Gasto do dia: o guardado pelo fecho do dia ou, na semana em curso, o mesmo cálculo aqui.
        out: row?.kcal_out_est ?? kcalOut(expenditure.base, exercise),
      }
    })
    // Gasto medido contra a fórmula, visto em cada uma das últimas 3 segundas-feiras.
    const weeklyGaps: number[] = []
    for (const back of [14, 7, 0]) {
      const cut = shiftDate(monday, -back)
      const before = hist.filter((d) => d.date < cut)
      const tdee = [...before].reverse().find((d) => d.tdee_est != null)?.tdee_est
      const formula = [...before].reverse().find((d) => d.formula_base != null)?.formula_base
      const trainings = before.filter((d) => d.is_complete).slice(-14).map((d) => Number(d.kcal_exercise ?? 0))
      if (tdee != null && formula != null) {
        const avg = trainings.length ? trainings.reduce((a, b) => a + b, 0) / trainings.length : 0
        weeklyGaps.push(measuredVsFormula(Number(tdee), Number(formula), avg))
      }
    }
    const healthRows = health ?? []
    const avgOf = (values: (number | null)[]) => {
      const known = values.filter((v): v is number => v != null)
      return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
    }
    const reviewOf = (week: string) =>
      ((reviews ?? []) as { week_start: string; text: string | null }[]).find((r) => r.week_start === week)?.text ?? null
    setData({
      monday,
      days,
      workouts: workoutRows,
      // O ritmo só com uma pesagem recente (até 4 dias antes do fim da semana ou de hoje).
      rate: weeklyRateAsOf(
        ((weights ?? []) as { date: string; kg: number }[]).map((w) => ({ date: w.date, value: Number(w.kg) })),
        sunday < today ? sunday : today,
      ),
      completeDays: completeCount ?? 0,
      steps: avgOf(healthRows.map((h) => h.steps as number | null)),
      sleep: avgOf(healthRows.map((h) => h.sleep_minutes as number | null)),
      sleepScore: avgOf(healthRows.map((h) => (h.sleep_score as number | null | undefined) ?? null)),
      expenditure,
      firstDate: (first?.[0]?.date as string | undefined) ?? null,
      review: reviewOf(monday),
      lastWeekReview: reviewOf(shiftDate(monday, -7)),
      weeklyGaps,
      avg7: avgOf((lastComplete ?? []).map((d) => Number(d.kcal_in))),
    })
  }, [monday, sunday, today, profile])

  useEffect(() => {
    void load()
  }, [load, version])

  const toggle = (
    <div className={`grid grid-cols-2 ${SEGMENT_TRACK} font-display text-[15px] font-bold tracking-[0.08em] uppercase`}>
      {(
        [
          ['semana', 'Semana'],
          ['mes', 'Mês'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setView(id)}
          className={`min-h-10 rounded-lg ${segment(view === id)}`}
          aria-pressed={view === id}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const header = (
    <div className="flex items-center justify-between">
      <button onClick={() => setMonday(shiftDate(monday, -7))} className="h-11 w-11 text-xl text-dim" aria-label="Semana anterior">
        ‹
      </button>
      <p className="text-[17px] font-semibold tabular-nums">{fmtRange(monday, sunday)}</p>
      <button
        disabled={shiftDate(monday, 7) > today}
        onClick={() => setMonday(shiftDate(monday, 7))}
        className="h-11 w-11 text-xl text-dim disabled:opacity-30"
        aria-label="Semana seguinte"
      >
        ›
      </button>
    </div>
  )

  if (view === 'mes') {
    return (
      <div className="space-y-4 pt-1">
        {toggle}
        <ContaGordura today={today} />
        {longo ? <CalendarioMes data={longo} today={today} onOpenDay={openDay} /> : !longoFailed && <CardSkeleton height={520} />}
        <BalancoMes today={today} days={longo?.days ?? (longoFailed ? [] : null)} />
        <button
          onClick={() => sheet.open('mes', { mes: today.slice(8, 10) <= '03' ? previousMonth(today) : today.slice(0, 7) })}
          className="min-h-12 w-full rounded-2xl border border-line bg-surface text-[15px] font-semibold"
        >
          O teu mês (imagem)
        </button>
      </div>
    )
  }

  // Ao mudar de semana, os números da anterior não ficam por baixo das datas novas.
  if (!data || data.monday !== monday) {
    return (
      <div className="space-y-4 pt-1">
        {toggle}
        {header}
        <p className="pt-6 text-center text-[15px] text-dim">A carregar…</p>
      </div>
    )
  }

  const thisWeek = monday === mondayOf(today)
  const averages = weekAverages(data.days, today)
  const counted = countedDays(data.days, today)
  // Os dias que ficaram de fora abrem-se no Hoje, onde se responde «Foi tudo neste dia?».
  const leftOutList = leftOutDates(data.days, today)
  const leftOut = leftOutList.length
  const avgOut = counted.length ? counted.reduce((a, d) => a + d.out, 0) / counted.length : null
  const hasAny = data.days.some((d) => d.meals > 0)
  const rate = data.rate
  const exp = data.expenditure
  const sessions = mergeSessions(data.workouts).length
  const minutes = data.workouts.reduce((a, w) => a + (w.minutes ?? 0), 0)
  const trainingKcal = data.workouts.reduce((a, w) => a + (w.kcal_est ?? 0), 0)
  const missingComplete = Math.max(0, MIN_COMPLETE_DAYS - data.completeDays)
  // Dias completos que cheguem, mas o gasto não se mede sem pesagens.
  const noWeighings = exp.learning && missingComplete === 0 && exp.weighings < 2
  // Na semana de água do ciclo, o peso sobe sem ser gordura.
  const waterWeek = waterWeekDuring(profile, monday, sunday < today ? sunday : today)
  // Até haver 3 dias que contem nesta semana, mostra o resumo da semana passada.
  const lastWeek = thisWeek && (averages?.days ?? 0) < 3 ? data.lastWeekReview : null
  // A partir da 3.ª semana com dados, a coerência usa o gasto medido até antes da semana.
  const thirdWeek = data.firstDate != null && data.firstDate <= shiftDate(monday, -14)
  const coherent =
    thirdWeek && averages && exp.tdeeFrozen != null && rate != null ? coherence(averages.eaten, exp.tdeeFrozen, rate) : null
  // A sugestão muda o plano de hoje: só na semana em curso.
  const suggestion =
    thisWeek && exp.tdeeFrozen != null && !exp.learning
      ? baseSuggestion(exp.tdeeFrozen, exp.avgTraining, profile.base_kcal, profile.sex)
      : null
  const gapNote = persistentGap(data.weeklyGaps)
  const facts = weekFacts(counted.length, averages?.eaten ?? null, sessions)
  // «Para esta semana»: uma ação, com a projeção (e a de há uma semana), a
  // proteína por refeição, os dias de fora e as pesagens.
  const action = (() => {
    if (!thisWeek || !longo || !protein) return null
    const input = longo.projection.input
    const p = project(input)
    const basis = p.status !== 'insuficiente' ? p.basis : null
    const since = shiftDate(today, -6)
    return weekAction({
      // Os dias acabados desta semana acima do gasto (o mesmo veredicto das barras).
      aboveSpent: data.days
        .filter((d) => d.date < today && dayResult(d, today) === 'acima_gasto')
        .map((d) => ({ date: d.date, over: d.eaten - d.out })),
      leftOut: leftOutList,
      note: moveNote(p, weekAgo(longo.projection)),
      weekday: basis?.weekday ?? null,
      weekend: basis?.weekend ?? null,
      fdsDaysEarlier: daysEarlier(input, 'fds'),
      targetKg: input.targetKg,
      protein,
      perMeal: profile.protein_per_meal_g,
      weighings7: new Set(longo.weights.filter((w) => w.date >= since).map((w) => w.date)).size,
      projection: projectionLine(p, input.targetKg, null, today),
    })
  })()
  const reviewLines = (text: string) =>
    text.split('\n').map((line, i) => (
      <p key={i} className="text-[15px]">
        {line}
      </p>
    ))
  const lastWeekCard = lastWeek && (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="label">A semana passada</p>
        <button onClick={() => setMonday(shiftDate(monday, -7))} className="min-h-10 text-[15px] text-eat">
          Ver a semana ›
        </button>
      </div>
      {reviewLines(lastWeek)}
    </section>
  )
  const reviewCard = data.review && (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4">
      <p className="label">Resumo da semana</p>
      {reviewLines(data.review)}
    </section>
  )
  // O que falta para medir o gasto pelo peso (no topo e nos detalhes).
  const learningText = noWeighings
    ? 'para o medir pelo peso, preciso que te peses 2 ou 3 vezes por semana.'
    : missingComplete > 0
      ? `mais ${missingComplete} ${missingComplete === 1 ? 'dia completo' : 'dias completos'} e passo a medir o teu gasto pelo peso.`
      : 'já há dias completos suficientes; a medição pelo peso começa na próxima semana.'

  async function applyBase(value: number) {
    const previous = profile.base_kcal
    if (!(await update({ base_kcal: value }))) {
      toast('Não consegui guardar. Tenta outra vez.')
      return
    }
    toast(`Plano base: ${fmtInt(value)}`, [{ label: 'Anular', run: async () => void (await update({ base_kcal: previous })) }])
  }

  return (
    <div className="space-y-4 pt-1">
      {toggle}
      {header}

      {!hasAny ? (
        <>
          <div className="space-y-2 rounded-2xl border border-line p-5 text-center text-[15px] text-dim">
            <p>
              {data.firstDate == null
                ? 'Regista alguns dias e aqui aparece a tua semana.'
                : thisWeek
                  ? 'A semana começou agora. Regista o que comes e aqui aparece a tua semana.'
                  : 'Nada registado nesta semana.'}
            </p>
            {thisWeek && data.firstDate != null && !lastWeekCard && (
              <button onClick={() => setMonday(shiftDate(monday, -7))} className="min-h-10 text-eat">
                Ver a semana passada ›
              </button>
            )}
          </div>
          {lastWeekCard}
          {reviewCard}
        </>
      ) : (
        <>
          <section className="space-y-2 rounded-[18px] border border-line bg-surface p-5">
            {averages && avgOut != null ? (
              <p className="text-[20px] leading-snug font-semibold">{weekSentence(averages.eaten, avgOut, rate)}</p>
            ) : leftOut > 0 ? (
              <p className="text-[17px] text-dim">
                {thisWeek ? 'Ainda não há dias completos esta semana.' : 'Nenhum dia completo nesta semana.'}
              </p>
            ) : (
              <p className="text-[17px] text-dim">A semana começou agora. A média aparece amanhã.</p>
            )}
            {facts && <p className="text-[14px] text-dim tabular-nums">{facts}</p>}
            {coherent === 'bate_certo' && (
              <p>
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-burn px-3 text-[15px] font-semibold text-burn">
                  <span aria-hidden>✓</span> {COHERENCE_TEXT.bate_certo.replace(/\.$/, '')}
                </span>
              </p>
            )}
            {coherent === 'ainda_nao' && <p className="text-[16px] text-dim">{COHERENCE_TEXT.ainda_nao}</p>}
            {waterWeek && rate != null && (
              <p className="text-[14px] text-dim">Semana de água do ciclo: o peso pode subir sem ser gordura.</p>
            )}
            {leftOut > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14px] text-dim">
                <span>
                  {leftOut === 1
                    ? `1 dia ficou de fora (incompleto ou com «faltou${NBSP}algo»):`
                    : `${leftOut} dias ficaram de fora (incompletos ou com «faltou${NBSP}algo»):`}
                </span>
                {leftOutList.map((date) => (
                  <button
                    key={date}
                    onClick={() => openDay(date)}
                    className="min-h-9 rounded-full border border-line px-3 whitespace-nowrap text-eat"
                  >
                    {weekdayShort(date)} {Number(date.slice(8))} ›
                  </button>
                ))}
              </div>
            )}
            {exp.learning && (
              <p className="text-[14px] text-dim">Gasto (a aprender): {learningText} Até lá uso uma fórmula.</p>
            )}
            {noWeighings && (
              <button onClick={() => sheet.open('peso')} className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta">
                Pesar
              </button>
            )}
          </section>

          {lastWeekCard}

          {belowFloor(averages, profile.kcal_floor_week) && (
            <p className="rounded-2xl border border-attn/40 bg-attn/10 px-4 py-3 text-[15px] text-attn">
              Esta semana comeste menos de {fmtInt(profile.kcal_floor_week)} por dia em média. Come um pouco mais:
              perder devagar protege o músculo.
            </p>
          )}

          <SemanaChart days={data.days} today={today} avg7={data.avg7} learning={exp.learning} note={exp.note} onOpenDay={openDay} />

          {/* Na semana em curso, «Para esta semana» (o espaço fica reservado
              enquanto chega, para nada mudar debaixo do dedo); o resumo
              guardado só quando não deu para a calcular. */}
          {!thisWeek ? reviewCard : action ? <ParaEstaSemana action={action} onOpenDay={openDay} /> : longoFailed || proteinFailed ? reviewCard : <CardSkeleton height={150} />}

          {/* Os 14 dias até ao fim da semana vista (numa semana passada, os de então). */}
          <ProteinaRefeicao rows={protein} perMeal={profile.protein_per_meal_g} />

          {longo ? <SemanaASemana data={longo} today={today} waterDay={longo.projection.input.waterDay} /> : !longoFailed && <CardSkeleton height={430} />}

          <button
            onClick={() =>
              void shareWeekReport({
                range: fmtRange(monday, sunday),
                sentence: averages && avgOut != null ? weekSentence(averages.eaten, avgOut, rate) : null,
                eaten: averages?.eaten ?? null,
                plan: averages?.plan ?? null,
                out: avgOut,
                protein: averages?.protein ?? null,
                proteinTarget: profile.protein_g,
                sessions,
                minutes,
                rateKgWeek: rate,
                completeDays: counted.length,
              })
                .then((how) => {
                  if (how === 'downloaded') toast('Imagem guardada.')
                })
                .catch(() => toast('Não consegui criar a imagem.'))
            }
            className="min-h-12 w-full rounded-2xl border border-line bg-surface text-[15px] font-semibold"
          >
            Partilhar a semana (imagem)
          </button>

          <button onClick={() => setDetails(!details)} className="text-[15px] text-dim">
            {details ? 'Esconder detalhes' : 'Ver detalhes ›'}
          </button>

          {details && (
            <section className="space-y-3 rounded-[18px] border border-line bg-surface p-5 text-[15px]">
              {averages && (
                <>
                  <p>Proteína média {fmtInt(averages.protein)} g por dia (meta {fmtInt(profile.protein_g)} g)</p>
                  <p className="text-dim">
                    Hidratos {fmtInt(averages.carbs)} g · Gordura {fmtInt(averages.fat)} g por dia (média)
                  </p>
                </>
              )}
              <p>
                Treino: {sessions} {sessions === 1 ? 'sessão' : 'sessões'} · {fmtInt(minutes)} min
                {trainingKcal > 0 && <span className="text-burn"> · +{fmtKcal(trainingKcal)} kcal do treino</span>}
              </p>
              {exp.tdeeFrozen != null && !exp.learning ? (
                <p>
                  Gasto medido pelo teu peso: cerca de {fmtKcal(exp.tdeeFrozen)} por dia. A fórmula dizia{' '}
                  {fmtKcal(exp.formula + exp.avgTraining)}.
                  {exp.tdeeMeasured != null && Math.abs(exp.tdeeMeasured - exp.tdeeFrozen) >= 100 && (
                    <span className="text-dim">
                      {' '}
                      Só pelo peso dava {fmtKcal(round10(exp.tdeeMeasured))}
                      {exp.tdeeMeasured > exp.tdeeFrozen
                        ? ': no início, ou depois de uma pausa, o peso desce depressa com água.'
                        : ': a água e o sal às vezes escondem a descida do peso.'}{' '}
                      O gasto muda devagar (no máximo 100 kcal por semana) e não conta as 2 primeiras semanas da dieta nem as de depois de uma pausa.
                    </span>
                  )}
                  {exp.note && <span className="block pt-1 text-[14px] text-dim">{exp.note}</span>}
                </p>
              ) : (
                <p className="text-dim">
                  Gasto (a aprender): {learningText} Até lá uso uma fórmula ({fmtKcal(exp.formula)} por dia sem treino).
                </p>
              )}
              {gapNote && (
                <p className="text-dim">
                  Pode ser porções maiores do que as fotos mostram, ou um gasto mais baixo do que o normal. A app já usa o
                  valor medido, por isso o plano continua certo.
                </p>
              )}
              {suggestion != null && (
                <div className="space-y-2 rounded-xl bg-surface2 p-3">
                  {suggestion.atMinimum ? (
                    <p>
                      O plano base podia ser {fmtInt(suggestion.base)} (hoje é {fmtInt(profile.base_kcal)}), o mínimo
                      seguro.{' '}
                      {suggestion.pace <= -0.05
                        ? `Com ele perdes cerca de ${fmt1(-suggestion.pace)} kg por semana.`
                        : 'Com ele o peso fica cerca de igual.'}
                    </p>
                  ) : (
                    <p>
                      Para perderes cerca de 0,5 kg por semana, o plano base podia ser {fmtInt(suggestion.base)} (hoje é{' '}
                      {fmtInt(profile.base_kcal)}).
                    </p>
                  )}
                  <BusyButton
                    busy="A aplicar…"
                    onClick={() => applyBase(suggestion.base)}
                    className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta"
                  >
                    Aplicar
                  </BusyButton>
                </div>
              )}
              {profile.birth_year == null && (
                <label className="block space-y-1">
                  <span>Em que ano nasceste? (opcional, para a fórmula do gasto)</span>
                  <span className="flex gap-2">
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={birthYear}
                      onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ''))}
                      placeholder="1986"
                      className="h-11 w-28 rounded-xl border border-line bg-bg px-3 text-[17px] tabular-nums"
                    />
                    <BusyButton
                      busy="A guardar…"
                      disabled={birthYear.length !== 4 || Number(birthYear) < 1920 || Number(birthYear) > 2015}
                      onClick={async () => {
                        if (!(await update({ birth_year: Number(birthYear) }))) toast('Não consegui guardar. Tenta outra vez.')
                      }}
                      className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40"
                    >
                      Guardar
                    </BusyButton>
                  </span>
                </label>
              )}
              {(data.steps != null || data.sleep != null) && (
                <p className="text-dim">
                  {[
                    data.steps != null ? `Passos: ${fmtInt(data.steps)} por dia` : null,
                    data.sleep != null ? `Sono: ${fmt1(data.sleep / 60)} h` : null,
                    data.sleepScore != null ? `qualidade ${Math.round(data.sleepScore)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
