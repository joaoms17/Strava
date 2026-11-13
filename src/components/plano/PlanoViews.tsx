import type { ReactNode } from 'react'
import { prescription, type PlanoDia, type PlanoExercicio, type PlanoTreino } from '../../../api/_lib/rules/plano-treino'
import Icon from '../ui/Icon'

// As peças do plano de treino (decisão 305), para ler no ginásio: letra
// grande, as séries e as repetições em números de placar e as notas do
// treinador à vista. Servem a página do plano e a folha «Ver plano».

// Cada dia com a sua cor (como no PDF): o 1 no tom do treino, o 2 no verde
// e o 3 no laranja. Nunca é só a cor: o número do dia está sempre escrito.
const TONES = [
  { text: 'text-burn', soft: 'bg-burn/12', border: 'border-l-burn', solid: 'bg-burn text-bg' },
  { text: 'text-ok', soft: 'bg-ok/12', border: 'border-l-ok', solid: 'bg-ok text-bg' },
  { text: 'text-eat', soft: 'bg-eat/12', border: 'border-l-eat', solid: 'bg-eat text-bg' },
]
export const dayTone = (n: number) => TONES[(Math.max(1, n) - 1) % TONES.length]!

export const kicker = 'font-display text-[0.8125rem] font-bold tracking-[0.16em] uppercase'
export const bigTitle = 'font-display text-[2.375rem] leading-[0.95] font-extrabold uppercase'

export function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-line bg-surface px-3 py-1 text-[0.875rem] text-dim">{children}</span>
}

function Numbers({ e, tone }: { e: PlanoExercicio; tone: string }) {
  const p = prescription(e)
  const cell = (value: string, label: string, color: string) => (
    <span className="flex flex-col items-center">
      <span className={`num text-[1.875rem] leading-none ${color}`}>{value}</span>
      <span className="mt-1 font-display text-[0.6875rem] font-semibold tracking-[0.14em] text-dim uppercase">{label}</span>
    </span>
  )
  return (
    <span className="flex shrink-0 items-start gap-2" aria-label={p.series ? `${p.series} séries de ${p.alvo} ${p.unidade}` : `${p.alvo} ${p.unidade}`}>
      {p.series && cell(p.series, 'séries', 'text-ink')}
      {p.series && <span className="num pt-2 text-[1rem] text-dim">×</span>}
      {cell(p.alvo, p.unidade, tone)}
    </span>
  )
}

function NoteChip({ e, tone }: { e: PlanoExercicio; tone: ReturnType<typeof dayTone> }) {
  if (!e.nota || e.superserie) return null
  return (
    <span className={`mt-2 inline-flex items-center gap-1.5 rounded-lg ${tone.soft} px-2.5 py-1 text-[0.9375rem] font-semibold ${tone.text}`}>
      {e.nota_tipo === 'subir' ? <span aria-hidden="true">↑</span> : e.nota_tipo === 'tempo' ? <Icon name="watch" size={15} /> : null}
      {e.nota}
    </span>
  )
}

export function ExerciseCard({ e, index, n }: { e: PlanoExercicio; index: number; n: number }) {
  const tone = dayTone(n)
  return (
    <li className="rounded-[18px] border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className={`num flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[1.0625rem] ${tone.soft} ${tone.text}`}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.1875rem] leading-tight font-semibold">{e.nome}</span>
          {e.detalhe && <span className="block text-[0.9375rem] text-dim">{e.detalhe}</span>}
        </span>
        <Numbers e={e} tone={tone.text} />
      </div>
      {e.nota && !e.superserie && (
        <div className="ml-[52px]">
          <NoteChip e={e} tone={tone} />
        </div>
      )}
      {e.superserie && (
        <div className="mt-3 ml-[52px] space-y-2">
          {e.superserie.map((part, i) => (
            <p key={part.nome} className="flex items-center gap-2.5 text-[1.0625rem] font-semibold">
              <span className={`num flex h-7 w-7 items-center justify-center rounded-full border-2 text-[0.875rem] ${tone.text} border-current`}>
                {'ABCDEFGH'[i]}
              </span>
              {part.nome}
            </p>
          ))}
          {e.nota && (
            <p className="flex items-center gap-1.5 pt-1 text-[0.9375rem] text-dim">
              <span className={tone.text}>
                <Icon name="repeat" size={16} />
              </span>
              {e.nota}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function KneeWarning({ text, onOpen }: { text: string; onOpen?: () => void }) {
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-attn/15 text-attn">
        <Icon name="alert" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1rem] font-semibold text-attn">Joelho direito</span>
        <span className="block text-[0.9375rem] text-dim">{text}</span>
      </span>
      {onOpen && <Icon name="chevron" size={20} />}
    </>
  )
  const cls = 'flex w-full items-center gap-3 rounded-[18px] border border-attn/50 bg-attn/8 p-3 text-left'
  return onOpen ? (
    <button onClick={onOpen} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function DayHeader({ day, fase }: { day: PlanoDia; fase: number }) {
  const tone = dayTone(day.n)
  return (
    <div className="space-y-2">
      <p className={`${kicker} ${tone.text}`}>
        Dia {day.n} · Fase {fase}
      </p>
      <h2 className={bigTitle}>{day.titulo}</h2>
      {day.subtitulo && <p className={`font-display text-[1.25rem] font-bold tracking-[0.12em] uppercase ${tone.text}`}>{day.subtitulo}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Pill>{day.exercicios.length} exercícios</Pill>
        {day.etiquetas?.map((t) => <Pill key={t}>{t}</Pill>)}
      </div>
    </div>
  )
}

export function ExerciseList({ day }: { day: PlanoDia }) {
  return (
    <ol className="space-y-2" aria-label={`Exercícios do dia ${day.n}`}>
      {day.exercicios.map((e, i) => (
        <ExerciseCard key={`${e.nome}-${i}`} e={e} index={i} n={day.n} />
      ))}
    </ol>
  )
}

export function Cuidados({ plan }: { plan: PlanoTreino }) {
  const c = plan.cuidados
  if (!c) return null
  const row = (text: string, kind: 'evitar' | 'foco') => (
    <li key={text} className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          kind === 'evitar' ? 'bg-pain/15 text-pain' : 'bg-ok/15 text-ok'
        }`}
        aria-label={kind === 'evitar' ? 'Evitar' : 'Fazer'}
      >
        <Icon name={kind === 'evitar' ? 'close' : 'check'} size={16} />
      </span>
      <span className="text-[1.0625rem] font-semibold">{text}</span>
    </li>
  )
  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-attn/50 bg-attn/8 p-4">
        <p className={`${kicker} flex items-center gap-2 text-attn`}>
          <Icon name="alert" size={16} /> {c.zona}
        </p>
        <p className="mt-2 text-[1.3125rem] leading-snug font-semibold">{c.titulo}</p>
        {c.detalhe && <p className="mt-1 text-[1rem] text-dim">{c.detalhe}</p>}
      </div>
      {c.evitar.length > 0 && (
        <section className="space-y-2">
          <p className={`${kicker} text-pain`}>Evitar</p>
          <ul className="space-y-2">{c.evitar.map((t) => row(t, 'evitar'))}</ul>
        </section>
      )}
      {c.foco.length > 0 && (
        <section className="space-y-2">
          <p className={`${kicker} text-ok`}>Foco da fase {plan.fase}</p>
          <ul className="space-y-2">{c.foco.map((t) => row(t, 'foco'))}</ul>
        </section>
      )}
    </div>
  )
}

const STATE_LABEL = { atual: 'Atual', proxima: 'Próxima', talvez: 'Talvez' } as const

export function Progressao({ plan }: { plan: PlanoTreino }) {
  return (
    <ol className="space-y-3">
      {plan.progressao.map((f, i) => {
        const current = f.estado === 'atual'
        return (
          <li key={f.fase} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                className={`num flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[1.0625rem] ${
                  current ? 'bg-cta text-on-cta' : 'border-2 border-line text-dim'
                }`}
              >
                {f.fase}
              </span>
              {i < plan.progressao.length - 1 && <span className="mt-1 w-0.5 flex-1 bg-line" aria-hidden="true" />}
            </span>
            <div className={`mb-1 flex-1 rounded-[18px] border p-4 ${current ? 'border-cta bg-surface' : 'border-line bg-surface'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className={`${kicker} ${current ? 'text-ink' : 'text-dim'}`}>Fase {f.fase}</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-display text-[0.75rem] font-bold tracking-[0.1em] uppercase ${
                    current ? 'bg-cta text-on-cta' : 'border border-line text-dim'
                  }`}
                >
                  {STATE_LABEL[f.estado]}
                </span>
              </div>
              <p className="mt-1 text-[1.1875rem] leading-snug font-semibold">{f.titulo}</p>
              {f.pontos.length > 0 && (
                <ul className="mt-2 space-y-1 text-[1rem] text-dim">
                  {f.pontos.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
