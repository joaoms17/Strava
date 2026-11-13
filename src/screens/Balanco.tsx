import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import { useProfile, useReadyProfile } from '../lib/profile'
import { useToast } from '../lib/toast'
import { useSheet } from '../lib/sheet'
import { BusyButton } from '../lib/busy'
import { shareWeekReport } from '../lib/week-report'
import ProteinaRefeicao from '../components/ProteinaRefeicao'
import { useDataVersion } from '../lib/events'
import { nutritionalDay, shiftDate } from '../lib/day'
import { NBSP, fmt1, fmtInt, fmtKcal, fmtRange, weekdayShort } from '../lib/format'
import { scopedKey } from '../lib/scoped'
import { useBalanco } from '../lib/balanco'
import { capLabel, weekCoherence, weekFrom } from '../lib/balanco-semana'
import { weekAgo } from '../lib/projecao'
import { daysEarlier, moveNote, project, projectionLine } from '../../api/_lib/rules/projecao'
import { dayResult, isAbove, isOnTarget, weekAction, weekFacts } from '../../api/_lib/rules/balanco-graficos'
import SemanaChart from '../components/balanco/SemanaChart'
import SemanaASemana from '../components/balanco/SemanaASemana'
import ParaEstaSemana from '../components/balanco/ParaEstaSemana'
import CalendarioMes from '../components/balanco/CalendarioMes'
import { waterWeekDuring } from '../../api/_lib/rules/ciclo'
import { mondayOf } from '../../api/_lib/rules/manutencao'
import { MIN_COMPLETE_DAYS } from '../../api/_lib/rules/adaptativo'
import {
  COHERENCE_TEXT,
  baseSuggestion,
  measuredStateLabel,
  persistentGap,
  rawGapReason,
  round10,
  weekSentence,
} from '../../api/_lib/rules/gasto'
import { belowFloor, countedDays, leftOutDates, weekAverages } from '../../api/_lib/rules/balanco'
import BalancoMes from '../components/BalancoMes'
import { previousMonth } from '../../api/_lib/rules/mes'
import ContaGordura from '../components/ContaGordura'
import { mergeSessions } from '../../api/_lib/rules/sessoes'
import { SEGMENT_TRACK, segment } from '../components/ui/Chips'

// O lugar de um cartão que ainda vem a caminho, com a altura final (sem saltos).
function CardSkeleton({ height }: { height: number }) {
  return <div className="animate-pulse rounded-[18px] border border-line bg-surface" style={{ height }} aria-hidden />
}

// B8: sem rede (ou com a sessão expirada) diz-se que não deu para ler, com
// «Tentar outra vez», em vez de «Regista alguns dias».
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-2xl border border-line p-5 text-center text-[15px]" role="alert">
      <p>Não consegui ler o Balanço. Verifica a rede e tenta outra vez.</p>
      <button onClick={onRetry} className="min-h-11 rounded-xl border border-line px-4 font-semibold">
        Tentar outra vez
      </button>
    </div>
  )
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
// selo, logo a seguir a ação para esta semana (e a sugestão do plano base,
// quando a há), o gráfico da semana (tocar num dia mostra os números) e a
// proteína por refeição. No Mês: a Conta da gordura, o calendário, as
// últimas semanas lado a lado e o resto.
// P1b: as últimas 16 semanas lêem-se uma vez (lib/balanco.ts) e a semana
// vista sai delas em memória: ‹ › é instantâneo.
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
  const { rows, longo, failed, longoFailed, retry } = useBalanco(profile, today, version, monday)
  const data = useMemo(() => (rows ? weekFrom(profile, rows, monday, today) : null), [rows, profile, monday, today])
  const openDay = (date: string) => navigate(date === today ? '/hoje' : `/hoje/${date}`)

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
          className={`min-h-11 rounded-lg ${segment(view === id)}`}
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
        {longoFailed && <LoadError onRetry={retry} />}
        <ContaGordura today={today} />
        {longo ? <CalendarioMes data={longo} today={today} onOpenDay={openDay} /> : !longoFailed && <CardSkeleton height={520} />}
        {/* B17: «Semana a semana» e «Por semana» eram a mesma conta: um só gráfico, no Mês. */}
        {longo ? <SemanaASemana data={longo} today={today} waterDay={longo.projection.input.waterDay} /> : !longoFailed && <CardSkeleton height={430} />}
        {longo && <BalancoMes today={today} days={longo.days} health={longo.health} />}
        <button
          onClick={() => sheet.open('mes', { mes: today.slice(8, 10) <= '03' ? previousMonth(today) : today.slice(0, 7) })}
          className="min-h-12 w-full rounded-2xl border border-line bg-surface text-[15px] font-semibold"
        >
          O teu mês (imagem)
        </button>
      </div>
    )
  }

  // Ao mudar para uma semana ainda por ler (mais de 16 semanas para trás), o
  // lugar dos cartões fica reservado (B18: a página não encolhe).
  if (!data) {
    return (
      <div className="space-y-4 pt-1">
        {toggle}
        {header}
        {failed ? (
          <LoadError onRetry={retry} />
        ) : (
          <div className="space-y-4" aria-busy>
            <span className="sr-only">A carregar…</span>
            <CardSkeleton height={180} />
            <CardSkeleton height={300} />
          </div>
        )}
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
  // Dias completos que cheguem, mas o gasto não se mede sem pesagens (K1:
  // 4 dias de pesagem a cobrir 10 dias ou mais).
  const missingWeighings = exp.state.kind === 'a_aprender' ? exp.state.missingWeighings : 0
  const noWeighings = exp.learning && missingComplete === 0 && (exp.state.kind === 'formula' || missingWeighings > 0)
  // Na semana de água do ciclo, o peso sobe sem ser gordura.
  const waterWeek = waterWeekDuring(profile, monday, sunday < today ? sunday : today)
  // Até haver 3 dias que contem nesta semana, mostra o resumo da semana passada.
  const lastWeek = thisWeek && (averages?.days ?? 0) < 3 ? data.lastWeekReview : null
  // A partir da 3.ª semana com dados, a coerência usa o gasto medido até
  // antes da semana; K7: só com 3 dias completos ou mais nesta semana.
  const thirdWeek = data.firstDate != null && data.firstDate <= shiftDate(monday, -14)
  const coherent = weekCoherence({ averages, tdeeFrozen: exp.tdeeFrozen, rate, thirdWeek })
  // A sugestão muda o plano de hoje: só na semana em curso.
  const suggestion =
    thisWeek && exp.tdeeFrozen != null && !exp.learning
      ? baseSuggestion(exp.tdeeFrozen, exp.avgTraining, profile.base_kcal, profile.sex)
      : null
  const gapNote = persistentGap(data.weeklyGaps)
  const facts = weekFacts(counted.length, averages?.eaten ?? null, sessions)
  // «Para esta semana»: uma ação, com a projeção (e a de há uma semana), a
  // proteína por refeição, os dias acima do alvo, os de fora e as pesagens.
  const action = (() => {
    if (!thisWeek || !longo) return null
    const input = longo.projection.input
    const p = project(input)
    const basis = p.status !== 'insuficiente' ? p.basis : null
    const since = shiftDate(today, -6)
    // Os dias acabados desta semana, com o mesmo veredicto das barras.
    const done = data.days.filter((d) => d.date < today).map((d) => ({ d, r: dayResult(d, today) }))
    return weekAction({
      aboveSpent: done.filter((x) => x.r === 'acima_gasto').map((x) => ({ date: x.d.date, over: x.d.eaten - x.d.out })),
      // B3: os dias acima do alvo (ainda abaixo do gasto) e quantos dias completos acabados há.
      aboveTarget: done.filter((x) => x.r === 'acima_alvo').map((x) => x.d.date),
      completeDays: done.filter((x) => isOnTarget(x.r) || isAbove(x.r)).length,
      leftOut: leftOutList,
      note: moveNote(p, weekAgo(longo.projection)),
      weekday: basis?.weekday ?? null,
      weekend: basis?.weekend ?? null,
      fdsDaysEarlier: daysEarlier(input, 'fds'),
      targetKg: input.targetKg,
      protein: data.protein,
      perMeal: profile.protein_per_meal_g,
      weighings7: new Set(longo.weights.filter((w) => w.date >= since).map((w) => w.date)).size,
      projection: projectionLine(p, input.targetKg, null, today),
      projectionKind: p.status === 'ok' ? p.weight.kind : null,
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
        <button onClick={() => setMonday(shiftDate(monday, -7))} className="min-h-11 text-[15px] text-eat">
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
  // Ideia 1 / K1: um só estado do gasto («medido», «a aprender (faltam N
  // pesagens)», «fórmula»), o mesmo da projeção; K4: o limite de ±400 à vista.
  const stateLabel = measuredStateLabel(exp.state)
  const cap = exp.learning ? null : capLabel(exp.flags)
  const missingDays = exp.state.kind === 'a_aprender' ? exp.state.missingDays : missingComplete
  const daysText = (n: number) => `${n} ${n === 1 ? 'dia completo' : 'dias completos'}`
  const learningText =
    exp.state.kind === 'formula'
      ? 'Sem pesagens nas últimas 4 semanas, não o consigo medir pelo peso. Pesa-te 2 ou 3 vezes por semana.'
      : missingWeighings > 0
        ? `Com 4 pesagens em 10 dias ou mais${missingDays > 0 ? ` e mais ${daysText(missingDays)}` : ''}, passo a medi-lo pelo teu peso.`
        : missingDays > 0
          ? `Com mais ${daysText(missingDays)}, passo a medi-lo pelo teu peso.`
          : 'Já há dias completos e pesagens que cheguem: a medição pelo peso começa na próxima semana.'
  const gastoLine = exp.learning
    ? `Gasto: ${stateLabel}. ${learningText} Até lá uso uma fórmula.`
    : `Gasto: medido pelo teu peso${cap ? ` (${cap})` : ''}.`

  async function applyBase(value: number) {
    const previous = profile.base_kcal
    if (!(await update({ base_kcal: value }))) {
      toast('Não consegui guardar. Tenta outra vez.')
      return
    }
    toast(`Plano base: ${fmtInt(value)}`, [{ label: 'Anular', run: async () => void (await update({ base_kcal: previous })) }])
  }

  // Ideia 14: a única ação do Balanço que muda o plano fica à vista, não em «Ver detalhes».
  const suggestionCard = suggestion != null && (
    <section className="space-y-2 rounded-[18px] border border-line bg-surface p-4 text-[15px]" aria-label="Plano base">
      <p className="label">Plano base</p>
      {suggestion.atMinimum ? (
        <p>
          O plano base podia ser {fmtInt(suggestion.base)} (hoje é {fmtInt(profile.base_kcal)}), o mínimo seguro.{' '}
          {suggestion.pace <= -0.05
            ? `Com ele perdes cerca de ${fmt1(-suggestion.pace)}${NBSP}kg por semana.`
            : 'Com ele o peso fica cerca de igual.'}
        </p>
      ) : (
        <p>
          Para perderes cerca de 0,5{NBSP}kg por semana, o plano base podia ser {fmtInt(suggestion.base)} (hoje é{' '}
          {fmtInt(profile.base_kcal)}).
        </p>
      )}
      <BusyButton busy="A aplicar…" onClick={() => applyBase(suggestion.base)} className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta">
        Aplicar
      </BusyButton>
    </section>
  )
  // B16: «Para esta semana» e a proteína não dependem das refeições desta
  // semana: aparecem também à segunda de manhã, antes da primeira refeição.
  const actionCard = action ? <ParaEstaSemana action={action} onOpenDay={openDay} /> : null

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
              <button onClick={() => setMonday(shiftDate(monday, -7))} className="min-h-11 text-eat">
                Ver a semana passada ›
              </button>
            )}
          </div>
          {actionCard}
          {suggestionCard}
          {lastWeekCard}
          {reviewCard}
          {thisWeek && <ProteinaRefeicao rows={data.protein} perMeal={profile.protein_per_meal_g} />}
        </>
      ) : (
        <>
          <section className="space-y-2 rounded-[18px] border border-line bg-surface p-5">
            {averages && avgOut != null ? (
              <p className="text-[20px] leading-snug font-semibold">{weekSentence(averages.eaten, avgOut, rate, thisWeek)}</p>
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
                    className="min-h-11 rounded-full border border-line px-3 whitespace-nowrap text-eat"
                  >
                    {weekdayShort(date)} {Number(date.slice(8))} ›
                  </button>
                ))}
              </div>
            )}
            <p className="text-[14px] text-dim">{gastoLine}</p>
            {noWeighings && (
              <button onClick={() => sheet.open('peso')} className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta">
                Pesar
              </button>
            )}
          </section>

          {/* Ideia 14: «Para esta semana» logo a seguir à frase do topo. */}
          {actionCard}
          {suggestionCard}

          {lastWeekCard}

          {belowFloor(averages, profile.kcal_floor_week) && (
            <p className="rounded-2xl border border-attn/40 bg-attn/10 px-4 py-3 text-[15px] text-attn">
              {thisWeek ? 'Esta semana comeste' : 'Nesta semana comeste'} menos de {fmtInt(profile.kcal_floor_week)} por dia em
              média. Come um pouco mais: perder devagar protege o músculo.
            </p>
          )}

          <SemanaChart
            days={data.days}
            today={today}
            avg7={data.avg7}
            gasto={exp.learning ? stateLabel : null}
            note={exp.note}
            onOpenDay={openDay}
          />

          {/* O resumo guardado: numa semana passada e, na de hoje, quando a ação não deu para calcular. */}
          {(!thisWeek || !action) && reviewCard}

          {/* Os 14 dias até ao fim da semana vista (numa semana passada, os de então). */}
          <ProteinaRefeicao rows={data.protein} perMeal={profile.protein_per_meal_g} />

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

          <button onClick={() => setDetails(!details)} className="min-h-11 text-[15px] text-dim">
            {details ? 'Esconder detalhes' : 'Ver detalhes ›'}
          </button>

          {details && (
            <section className="space-y-3 rounded-[18px] border border-line bg-surface p-5 text-[15px]">
              {averages && (
                <>
                  <p>
                    Proteína média {fmtInt(averages.protein)}{NBSP}g por dia (meta {fmtInt(profile.protein_g)}{NBSP}g)
                  </p>
                  <p className="text-dim">
                    Hidratos {fmtInt(averages.carbs)}{NBSP}g · Gordura {fmtInt(averages.fat)}{NBSP}g por dia (média)
                  </p>
                </>
              )}
              <p>
                Treino: {sessions} {sessions === 1 ? 'sessão' : 'sessões'} · {fmtInt(minutes)}{NBSP}min
                {trainingKcal > 0 && <span className="text-burn"> · +{fmtKcal(trainingKcal)}{NBSP}kcal do treino</span>}
              </p>
              {exp.tdeeFrozen != null && !exp.learning ? (
                <p>
                  Gasto medido pelo teu peso: cerca de {fmtKcal(exp.tdeeFrozen)}{NBSP}kcal por dia. A fórmula dizia{' '}
                  {fmtKcal(exp.formula + exp.avgTraining)}{NBSP}kcal.
                  {exp.tdeeMeasured != null && Math.abs(exp.tdeeMeasured - exp.tdeeFrozen) >= 100 && (
                    <span className="text-dim">
                      {' '}
                      Só pelo peso dava {fmtKcal(round10(exp.tdeeMeasured))}{NBSP}kcal: {rawGapReason(exp.tdeeMeasured, exp.tdeeFrozen, exp.flags)}{' '}
                      O gasto muda devagar (no máximo 100{NBSP}kcal por semana) e não conta as 2 primeiras semanas da dieta nem as de depois de uma pausa.
                    </span>
                  )}
                  {exp.note && <span className="block pt-1 text-[14px] text-dim">{exp.note}</span>}
                </p>
              ) : (
                <p className="text-dim">
                  {gastoLine} A fórmula dá {fmtKcal(exp.formula)}{NBSP}kcal por dia sem treino.
                </p>
              )}
              {gapNote && (
                <p className="text-dim">
                  Pode ser porções maiores do que as fotos mostram, ou um gasto mais baixo do que o normal. A app já usa o
                  valor medido, por isso o plano continua certo.
                </p>
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
                    data.sleep != null ? `Sono: ${fmt1(data.sleep / 60)}${NBSP}h` : null,
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
