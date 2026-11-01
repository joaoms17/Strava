// O plano de treino de uma pessoa (o PDF do treinador), guardado em
// profile.goals.plano_treino: só aparece a quem o tem. Aqui ficam as contas
// puras: ler o JSON com cuidado, a prescrição para mostrar («3 × 8–12 reps»,
// «máx. tempo») e cada dia como um dos teus treinos do Ginásio, com os
// exercícios do catálogo, as séries, as repetições (ou os segundos) e as notas.
// Só importa outras rules: o telemóvel usa este ficheiro diretamente.

import { sameExercise } from './exercicios.js'
import { isOtherSport, workoutKcal, type OtherSport } from './targets.js'
import { shiftDate } from './nutritional-day.js'

export type PlanoUnidade = 'reps' | 'seg' | 'min' | 'max'

export interface PlanoExercicio {
  nome: string // como o treinador escreve («Lat pulldown»)
  detalhe?: string // «Máquina · Costas»
  series?: number | null
  min?: number | null // repetições, segundos ou minutos (conforme a unidade)
  max?: number | null
  unidade: PlanoUnidade // 'max': o máximo de tempo que aguentares
  nota?: string // «Pés altos na plataforma»
  nota_tipo?: 'subir' | 'tempo' | 'repetir'
  exercicio?: string // o nome no catálogo, para a sessão do Ginásio
  superserie?: { nome: string; exercicio?: string }[] // A, B: seguidos
}

export interface PlanoDia {
  n: number
  titulo: string // «Membros superiores & core»
  curto?: string // «Superiores & core» (nos chips)
  subtitulo?: string // «Estabilidade»
  resumo?: string // a linha do índice
  etiquetas?: string[]
  aviso_joelho?: string
  favorito: string // o nome do teu treino no Ginásio («Fase 1 · Dia 1»)
  minutos?: number
  exercicios: PlanoExercicio[]
}

export interface PlanoFase {
  fase: number
  estado: 'atual' | 'proxima' | 'talvez'
  titulo: string
  pontos: string[]
}

export interface PlanoTreino {
  versao: 1
  fase: number
  quando?: string // «Out 2026»
  lema?: string
  cuidados?: {
    zona: string // «Joelho direito»
    titulo: string
    detalhe?: string
    evitar: string[]
    foco: string[]
  }
  dias: PlanoDia[]
  progressao: PlanoFase[]
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : [])
const UNITS: PlanoUnidade[] = ['reps', 'seg', 'min', 'max']

function cleanExercise(raw: unknown): PlanoExercicio | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const nome = str(e.nome)
  if (!nome) return null
  const unidade = UNITS.includes(e.unidade as PlanoUnidade) ? (e.unidade as PlanoUnidade) : 'reps'
  const superserie = Array.isArray(e.superserie)
    ? e.superserie
        .map((p) => (p && typeof p === 'object' ? { nome: str((p as Record<string, unknown>).nome), exercicio: str((p as Record<string, unknown>).exercicio) } : null))
        .filter((p): p is { nome: string; exercicio: string | undefined } => !!p?.nome)
        .map((p) => (p.exercicio ? { nome: p.nome, exercicio: p.exercicio } : { nome: p.nome }))
    : []
  const notaTipo = ['subir', 'tempo', 'repetir'].includes(e.nota_tipo as string) ? (e.nota_tipo as PlanoExercicio['nota_tipo']) : undefined
  return {
    nome,
    ...(str(e.detalhe) ? { detalhe: str(e.detalhe) } : {}),
    series: num(e.series),
    min: num(e.min),
    max: num(e.max),
    unidade,
    ...(str(e.nota) ? { nota: str(e.nota) } : {}),
    ...(notaTipo ? { nota_tipo: notaTipo } : {}),
    ...(str(e.exercicio) ? { exercicio: str(e.exercicio) } : {}),
    ...(superserie.length >= 2 ? { superserie } : {}),
  }
}

// O JSON guardado no perfil, limpo: sem plano (ou estragado) → null, e a
// app não mostra nada (a Joana, por exemplo).
export function parsePlanoTreino(raw: unknown): PlanoTreino | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const dias = (Array.isArray(p.dias) ? p.dias : [])
    .map((d, i): PlanoDia | null => {
      if (!d || typeof d !== 'object') return null
      const day = d as Record<string, unknown>
      const titulo = str(day.titulo)
      const exercicios = (Array.isArray(day.exercicios) ? day.exercicios : [])
        .map(cleanExercise)
        .filter((e): e is PlanoExercicio => !!e)
      if (!titulo || exercicios.length === 0) return null
      const n = num(day.n) ?? i + 1
      return {
        n,
        titulo,
        ...(str(day.curto) ? { curto: str(day.curto) } : {}),
        ...(str(day.subtitulo) ? { subtitulo: str(day.subtitulo) } : {}),
        ...(str(day.resumo) ? { resumo: str(day.resumo) } : {}),
        etiquetas: strs(day.etiquetas),
        ...(str(day.aviso_joelho) ? { aviso_joelho: str(day.aviso_joelho) } : {}),
        favorito: str(day.favorito) ?? `Fase ${num(p.fase) ?? 1} · ${dayLabel({ n, titulo, curto: str(day.curto) }, true)}`,
        ...(num(day.minutos) ? { minutos: num(day.minutos)! } : {}),
        exercicios,
      }
    })
    .filter((d): d is PlanoDia => !!d)
  if (dias.length === 0) return null
  const c = p.cuidados as Record<string, unknown> | undefined
  const cuidados =
    c && typeof c === 'object' && str(c.titulo)
      ? {
          zona: str(c.zona) ?? 'Cuidados',
          titulo: str(c.titulo)!,
          ...(str(c.detalhe) ? { detalhe: str(c.detalhe) } : {}),
          evitar: strs(c.evitar),
          foco: strs(c.foco),
        }
      : undefined
  const progressao = (Array.isArray(p.progressao) ? p.progressao : [])
    .map((f): PlanoFase | null => {
      if (!f || typeof f !== 'object') return null
      const fase = f as Record<string, unknown>
      const titulo = str(fase.titulo)
      const n = num(fase.fase)
      if (!titulo || n == null) return null
      const estado = ['atual', 'proxima', 'talvez'].includes(fase.estado as string) ? (fase.estado as PlanoFase['estado']) : 'talvez'
      return { fase: n, estado, titulo, pontos: strs(fase.pontos) }
    })
    .filter((f): f is PlanoFase => !!f)
  return {
    versao: 1,
    fase: num(p.fase) ?? 1,
    ...(str(p.quando) ? { quando: str(p.quando) } : {}),
    ...(str(p.lema) ? { lema: str(p.lema) } : {}),
    ...(cuidados ? { cuidados } : {}),
    dias,
    progressao,
  }
}

const range = (min: number | null | undefined, max: number | null | undefined): string =>
  min != null && max != null && max !== min ? `${min}–${max}` : String(min ?? max ?? '')

// A prescrição para ler de longe: as séries, o alvo e a unidade.
// «3 × 8–12 reps», «3 × 1 min», «máx. tempo».
export function prescription(e: PlanoExercicio): { series: string | null; alvo: string; unidade: string } {
  if (e.unidade === 'max') return { series: e.series ? String(e.series) : null, alvo: 'Máx.', unidade: 'tempo' }
  const unidade = e.unidade === 'reps' ? 'reps' : e.unidade === 'seg' ? 'seg' : 'min'
  return { series: e.series ? String(e.series) : null, alvo: range(e.min, e.max), unidade }
}

export function prescriptionText(e: PlanoExercicio): string {
  const p = prescription(e)
  if (e.unidade === 'max') return p.series ? `${p.series} × máx. tempo` : 'máx. tempo'
  return `${p.series ? `${p.series} × ` : ''}${p.alvo} ${p.unidade}`
}

// Um exercício do teu treino no Ginásio (a mesma forma de favorites.workout.exercises).
export interface PlanTemplateExercise {
  name: string
  sets: number
  rep_min: number
  rep_max: number
  note?: string
}

// Os de tempo contam segundos nas repetições e levam «(segundos)» no nome.
export const isTimedExercise = (name: string) => /\(segundos\)/i.test(name)

const TIMED_UNITS: PlanoUnidade[] = ['seg', 'min', 'max']

function catalogName(nome: string, exercicio: string | undefined, timed: boolean): string {
  const name = exercicio ?? nome
  return timed && !isTimedExercise(name) ? `${name} (segundos)` : name
}

// O nome do treinador, quando o do catálogo é outro («Lat pulldown» →
// «Puxada à frente»), para se reconhecer na sessão. Não se repete quando o do
// catálogo já tem as palavras dele («Supino inclinado com halteres»,
// «Elevações laterais» para «Elevação lateral»).
const stems = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(segundos\)/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.slice(0, 5))
function alias(nome: string, name: string): string | null {
  if (sameExercise(nome, name)) return null
  const known = stems(name)
  return stems(nome).every((w) => known.includes(w)) ? null : `No plano: ${nome}`
}

// Um dia do plano como os exercícios de um treino teu: as séries, as
// repetições mín.–máx. (ou os segundos; 1 min = 60) e uma nota com o que o
// treinador diz. O máximo de tempo fica a 0 (escreves o que aguentaste). A
// supersérie são dois exercícios seguidos, cada um com a nota da volta.
export function dayTemplate(day: PlanoDia): PlanTemplateExercise[] {
  const out: PlanTemplateExercise[] = []
  for (const e of day.exercicios) {
    const timed = TIMED_UNITS.includes(e.unidade)
    const factor = e.unidade === 'min' ? 60 : 1
    const lo = e.unidade === 'max' ? 0 : Math.round((e.min ?? e.max ?? 10) * factor)
    const hi = e.unidade === 'max' ? 0 : Math.round((e.max ?? e.min ?? 10) * factor)
    const sets = Math.max(1, e.series ?? 1)
    const base = { sets, rep_min: Math.min(lo, hi), rep_max: Math.max(lo, hi) }
    const parts = e.superserie ?? []
    if (parts.length >= 2) {
      // «Supersérie A · Curl de bíceps → Tríceps à testa · A + B seguidos, …»
      const chain = parts.map((part) => part.nome).join(' → ')
      parts.forEach((part, i) => {
        out.push({
          name: catalogName(part.nome, part.exercicio, timed),
          ...base,
          note: [`Supersérie ${'ABCDEFGH'[i]}`, chain, e.nota].filter(Boolean).join(' · '),
        })
      })
      continue
    }
    const name = catalogName(e.nome, e.exercicio, timed)
    const named = alias(e.nome, name)
    const extra = e.unidade === 'max' ? 'Máx. tempo' : null
    const note = [named, extra, e.nota].filter(Boolean).join(' · ')
    out.push({ name, ...base, ...(note ? { note } : {}) })
  }
  return out
}

// O dia do plano de um dos teus treinos (pelo nome do favorito), para a
// sessão do Ginásio mostrar «Ver plano».
export function planDayOfFavorite(plan: PlanoTreino | null, favoriteName: string | null | undefined): PlanoDia | null {
  if (!plan || !favoriteName) return null
  return plan.dias.find((d) => sameExercise(d.favorito, favoriteName)) ?? null
}

// Um dia do plano tem sempre o título ao lado do número: «Dia 1 · Membros
// superiores & core»; curto nos chips («Dia 1 · Superiores & core»).
export function dayLabel(day: Pick<PlanoDia, 'n' | 'titulo' | 'curto'>, short = false): string {
  return `Dia ${day.n} · ${short ? (day.curto ?? day.titulo) : day.titulo}`
}

// O teu treino «Fase 1 · Dia N» (favorites, kind 'workout'), para o Ginásio
// começar com os exercícios do dia. As kcal como ao guardar um treino teu:
// pelos minutos, sem relógio.
export function planFavorite(day: PlanoDia): {
  name: string
  kcal: number
  workout: { type: 'strength'; minutes: number; exercises: PlanTemplateExercise[] }
} {
  const minutes = day.minutos ?? 60
  return {
    name: day.favorito,
    kcal: workoutKcal({ type: 'strength', minutes, watts: null, deviceCalories: null }),
    workout: { type: 'strength', minutes, exercises: dayTemplate(day) },
  }
}

// ---------------------------------------------------------------------------
// «Qual foi?» (decisão 306): um ginásio (ou outro treino) que chegou sozinho
// — o relógio pelo intervals.icu, o Strava, um print — sem ser um dos teus
// treinos. Quem tem plano responde num toque: Dia 1 · Dia 2 · Dia 3 ·
// Bicicleta · Outro.

export interface QualFoiWorkout {
  id: string
  date: string
  type: 'bike' | 'strength' | 'other'
  source: string
  favorite_id?: string | null
  name?: string | null
  sport?: string | null
  deleted_at?: string | null
  raw?: { sport?: string; qual_foi?: boolean } | null
  started_at?: string | null
}

export const QUAL_FOI_DAYS = 7

const unknownSport = (sport: string | null | undefined) => !isOtherSport(sport) || sport === 'outro'

// Os que perguntam: dos últimos 7 dias (com hoje), automáticos (não os
// registados à mão), de ginásio ou de um desporto que o relógio não soube
// dizer («outro»; uma caminhada ou uma corrida já se sabe o que foi), sem um
// dos teus treinos e ainda sem resposta (`raw.qual_foi`). O mais recente
// primeiro.
export function askWhichWorkout<T extends QualFoiWorkout>(workouts: T[], today: string): T[] {
  const from = shiftDate(today, -(QUAL_FOI_DAYS - 1))
  return workouts
    .filter(
      (w) =>
        !w.deleted_at &&
        w.source !== 'manual' &&
        (w.type === 'strength' || (w.type === 'other' && unknownSport(w.sport ?? w.raw?.sport))) &&
        !w.favorite_id &&
        w.raw?.qual_foi !== true &&
        w.date >= from &&
        w.date <= today,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''))
}

export type QualFoiChoice = { kind: 'dia'; n: number; favoriteId: string } | { kind: 'bike' } | { kind: 'outro'; sport: OtherSport }

// O pedido a /api/workout/update para cada resposta. Um dia do plano liga o
// treino ao teu «Fase 1 · Dia N» (o nome passa a ser esse) e faz dele um
// ginásio; Bicicleta e Outro mudam o tipo (as kcal recalculam-se no servidor,
// com as calorias do relógio guardadas). Todas ficam respondidas.
export function qualFoiPatch(w: QualFoiWorkout, choice: QualFoiChoice): Record<string, unknown> {
  switch (choice.kind) {
    case 'dia':
      return { favorite_id: choice.favoriteId, qual_foi: true, ...(w.type !== 'strength' ? { type: 'strength' } : {}) }
    case 'bike':
      return { type: 'bike', qual_foi: true }
    case 'outro':
      return { type: 'other', sport: choice.sport, qual_foi: true }
  }
}

// Anular: o treino volta ao que era (tipo, desporto, nome e sem resposta).
export function qualFoiUndo(previous: QualFoiWorkout): Record<string, unknown> {
  const sport = previous.sport ?? previous.raw?.sport ?? null
  return {
    favorite_id: previous.favorite_id ?? null,
    name: previous.name ?? null,
    type: previous.type,
    ...(previous.type === 'other' ? { sport: isOtherSport(sport) ? sport : 'outro' } : {}),
    qual_foi: false,
  }
}
