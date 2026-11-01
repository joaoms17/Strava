import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  dayTemplate,
  isTimedExercise,
  parsePlanoTreino,
  planDayOfFavorite,
  planFavorite,
  prescriptionText,
  askWhichWorkout,
  dayLabel,
  qualFoiPatch,
  qualFoiUndo,
  type PlanoDia,
  type QualFoiWorkout,
} from '../api/_lib/rules/plano-treino'
import { DEFAULT_EXERCISES, sameExercise } from '../api/_lib/rules/exercicios'

// O plano do João vive só no SQL que o põe no perfil dele (não vai no código
// da app): o teste lê-o de lá.
const SQL = fs.readFileSync(new URL('../supabase/oneoff/20261101_plano_treino_joao.sql', import.meta.url), 'utf8')
const RAW = JSON.parse(/\$plano\$([\s\S]*?)\$plano\$/.exec(SQL)![1]!)
const PLAN = parsePlanoTreino(RAW)!
const day = (n: number) => PLAN.dias.find((d) => d.n === n)!

describe('parsePlanoTreino', () => {
  it('lê o plano do João: fase 1, 3 dias, cuidados e progressão', () => {
    expect(PLAN.fase).toBe(1)
    expect(PLAN.dias.map((d) => [d.n, d.exercicios.length, d.favorito])).toEqual([
      [1, 6, 'Fase 1 · Dia 1 · Superiores & core'],
      [2, 5, 'Fase 1 · Dia 2 · Inferiores'],
      [3, 5, 'Fase 1 · Dia 3 · Corpo inteiro'],
    ])
    expect(PLAN.cuidados?.zona).toBe('Joelho direito')
    expect(PLAN.cuidados?.evitar).toHaveLength(3)
    expect(PLAN.cuidados?.foco).toHaveLength(2)
    expect(PLAN.progressao.map((f) => f.estado)).toEqual(['atual', 'proxima', 'talvez'])
    expect(day(2).aviso_joelho).toMatch(/flexão profunda/)
  })

  it('sem plano ou estragado: nada (a Joana não vê o cartão)', () => {
    expect(parsePlanoTreino(undefined)).toBeNull()
    expect(parsePlanoTreino(null)).toBeNull()
    expect(parsePlanoTreino('plano')).toBeNull()
    expect(parsePlanoTreino({ dias: [] })).toBeNull()
    expect(parsePlanoTreino({ dias: [{ titulo: 'Sem exercícios', exercicios: [] }] })).toBeNull()
  })

  it('limpa o que vem mal e põe os valores por omissão', () => {
    const plan = parsePlanoTreino({
      fase: 2,
      dias: [{ titulo: 'Pernas', exercicios: [{ nome: 'Agachamento', unidade: 'kg', series: -1, min: 'dez' }, { detalhe: 'sem nome' }] }],
      progressao: [{ fase: 2, titulo: 'Volume', estado: 'já' }, { titulo: 'sem fase' }],
    })!
    expect(plan.dias[0]).toMatchObject({ n: 1, favorito: 'Fase 2 · Dia 1 · Pernas' })
    expect(plan.dias[0]!.exercicios).toEqual([{ nome: 'Agachamento', series: null, min: null, max: null, unidade: 'reps' }])
    expect(plan.progressao).toEqual([{ fase: 2, estado: 'talvez', titulo: 'Volume', pontos: [] }])
    expect(plan.cuidados).toBeUndefined()
  })
})

describe('prescrição', () => {
  it('séries × alvo e unidade, como no PDF', () => {
    expect(day(1).exercicios.map(prescriptionText)).toEqual([
      'máx. tempo',
      '3 × 8–12 reps',
      '3 × 8–12 reps',
      '3 × 10 reps',
      '3 × 10 reps',
      '3 × 20 seg',
    ])
    expect(day(2).exercicios.map(prescriptionText)).toEqual(['3 × 1 min', '3 × 30–45 seg', '3 × 10–12 reps', '3 × 10–12 reps', '4 × 15 reps'])
    expect(prescriptionText(day(3).exercicios[4]!)).toBe('4 × 12 reps')
  })
})

describe('dayTemplate (o dia como um treino teu no Ginásio)', () => {
  it('todos os exercícios estão no catálogo da app', () => {
    for (const d of PLAN.dias) {
      for (const e of dayTemplate(d)) {
        expect(DEFAULT_EXERCISES.some((c) => sameExercise(c.name, e.name)), e.name).toBe(true)
      }
    }
  })

  it('os de tempo ficam em segundos (1 min = 60) e o máximo fica a 0', () => {
    const [wall, ponte] = dayTemplate(day(2))
    expect(wall).toEqual({ name: 'Isométrico de parede parcial (segundos)', sets: 3, rep_min: 60, rep_max: 60, note: 'No plano: Wall sit' })
    expect(ponte).toMatchObject({ name: 'Ponte de glúteos isométrica (segundos)', sets: 3, rep_min: 30, rep_max: 45 })
    const [barra, , , , , hollow] = dayTemplate(day(1))
    expect(barra).toEqual({ name: 'Pendurar na barra (segundos)', sets: 1, rep_min: 0, rep_max: 0, note: 'Máx. tempo' })
    expect(hollow).toMatchObject({ rep_min: 20, rep_max: 20 })
    for (const d of PLAN.dias) {
      d.exercicios.forEach((e) => {
        if (e.unidade === 'reps' || e.superserie) return
        expect(isTimedExercise(dayTemplate({ ...d, exercicios: [e] })[0]!.name)).toBe(true)
      })
    }
  })

  it('um de tempo sem «(segundos)» no nome ganha-o', () => {
    const d: PlanoDia = { n: 1, titulo: 'X', favorito: 'X', exercicios: [{ nome: 'Prancha', series: 3, min: 30, unidade: 'seg' }] }
    expect(dayTemplate(d)[0]!.name).toBe('Prancha (segundos)')
  })

  it('as notas do treinador e o nome do plano quando o do catálogo é outro', () => {
    const [, , pulldown, remada, ombros] = dayTemplate(day(1))
    expect(pulldown!.note).toBe('No plano: Lat pulldown')
    expect(remada!.note).toBe('No plano: Remada unilateral')
    expect(ombros!.note).toBeUndefined() // «Press de ombros na máquina» já o diz
    const [, , legPress, legCurl, gemeos] = dayTemplate(day(2))
    expect(legPress!.note).toBe('Pés altos na plataforma')
    expect(legCurl!.note).toBe('3-5 seg. a contrair')
    expect(gemeos).toMatchObject({ name: 'Calf raise', sets: 4, rep_min: 15, rep_max: 15, note: 'No plano: Gémeos em pé' })
    expect(dayTemplate(day(3))[3]!.note).toBeUndefined() // Elevação lateral ≈ Elevações laterais
  })

  it('a supersérie são dois exercícios seguidos com a nota da volta', () => {
    const t = dayTemplate(day(3))
    expect(t).toHaveLength(6)
    expect(t.slice(4)).toEqual([
      { name: 'Curl com barra EZ', sets: 4, rep_min: 12, rep_max: 12, note: 'Supersérie A · Curl de bíceps → Tríceps à testa · A + B seguidos, descanso no fim da volta' },
      { name: 'Tríceps francês', sets: 4, rep_min: 12, rep_max: 12, note: 'Supersérie B · Curl de bíceps → Tríceps à testa · A + B seguidos, descanso no fim da volta' },
    ])
  })

  it('o SQL cria os mesmos treinos que a app', () => {
    const rows = [...SQL.matchAll(/\('([^']+)', \$treino\$(.*?)\$treino\$::jsonb, (\d+)\)/g)].map((m) => ({
      name: m[1],
      workout: JSON.parse(m[2]!),
      kcal: Number(m[3]),
    }))
    expect(rows).toEqual(PLAN.dias.map(planFavorite))
  })

  it('o SQL liga o ginásio de 31 out ao Dia 1 como a app (favorito, nome e resposta)', () => {
    const step = SQL.slice(SQL.indexOf('-- 4.'), SQL.indexOf('-- 5.'))
    expect(step).toContain(`name = '${PLAN.dias[0]!.favorito}'`)
    expect(step).toContain("w.type = 'strength' and w.date = date '2026-10-31'")
    expect(step).toMatch(/set favorite_id = fav\.id,\s+name = fav\.name,/)
    expect(step).toContain('"qual_foi": true')
  })

  it('o SQL só toca no João', () => {
    const ids = new Set(SQL.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g))
    expect([...ids]).toEqual(['3b3b6d86-f2e0-41f5-9681-2e3cce7e5724'])
  })
})

describe('planDayOfFavorite', () => {
  it('o dia do plano de um treino teu, pelo nome', () => {
    expect(planDayOfFavorite(PLAN, 'Fase 1 · Dia 2 · Inferiores')?.n).toBe(2)
    expect(planDayOfFavorite(PLAN, 'fase 1 · dia 3 · corpo inteiro')?.n).toBe(3)
    expect(planDayOfFavorite(PLAN, 'Pernas A')).toBeNull()
    expect(planDayOfFavorite(null, 'Fase 1 · Dia 1 · Superiores & core')).toBeNull()
    expect(planDayOfFavorite(PLAN, null)).toBeNull()
  })
})

describe('dayLabel', () => {
  it('o número do dia vem sempre com o título', () => {
    expect(PLAN.dias.map((d) => dayLabel(d))).toEqual([
      'Dia 1 · Membros superiores & core',
      'Dia 2 · Membros inferiores',
      'Dia 3 · Corpo inteiro',
    ])
    expect(PLAN.dias.map((d) => dayLabel(d, true))).toEqual(['Dia 1 · Superiores & core', 'Dia 2 · Inferiores', 'Dia 3 · Corpo inteiro'])
    expect(dayLabel({ n: 4, titulo: 'Mobilidade' }, true)).toBe('Dia 4 · Mobilidade')
  })
})

describe('«Qual foi?»', () => {
  const today = '2026-11-01'
  const w = (id: string, patch: Partial<QualFoiWorkout> = {}): QualFoiWorkout => ({
    id,
    date: '2026-10-31',
    type: 'strength',
    source: 'intervals',
    favorite_id: null,
    name: 'Strength',
    deleted_at: null,
    raw: { calories: 236 } as QualFoiWorkout['raw'],
    ...patch,
  })

  it('pergunta os automáticos de ginásio (ou desporto desconhecido) dos últimos 7 dias, sem treino teu nem resposta', () => {
    const list = [
      w('relogio', { started_at: '2026-10-31T09:00:00Z' }),
      w('print', { source: 'screenshot', date: '2026-10-29' }),
      w('caminhada', { type: 'other', sport: 'caminhada', date: '2026-11-01' }),
      w('outro', { type: 'other', sport: 'outro', date: '2026-11-01' }),
      w('tarde', { started_at: '2026-10-31T18:40:00Z' }),
      w('a-mao', { source: 'manual' }),
      w('bike', { type: 'bike' }),
      w('com-treino', { favorite_id: 'f1' }),
      w('respondido', { raw: { qual_foi: true } }),
      w('apagado', { deleted_at: '2026-10-31T20:00:00Z' }),
      w('antigo', { date: '2026-10-25' }),
      w('sete-dias', { date: '2026-10-26' }),
    ]
    expect(askWhichWorkout(list, today).map((x) => x.id)).toEqual(['outro', 'tarde', 'relogio', 'print', 'sete-dias'])
  })

  it('Dia N liga ao teu treino (e faz dele ginásio); Bicicleta e Outro mudam o tipo', () => {
    expect(qualFoiPatch(w('a'), { kind: 'dia', n: 1, favoriteId: 'fav-1' })).toEqual({ favorite_id: 'fav-1', qual_foi: true })
    expect(qualFoiPatch(w('a', { type: 'other' }), { kind: 'dia', n: 2, favoriteId: 'fav-2' })).toEqual({
      favorite_id: 'fav-2',
      qual_foi: true,
      type: 'strength',
    })
    expect(qualFoiPatch(w('a'), { kind: 'bike' })).toEqual({ type: 'bike', qual_foi: true })
    expect(qualFoiPatch(w('a'), { kind: 'outro', sport: 'remo' })).toEqual({ type: 'other', sport: 'remo', qual_foi: true })
  })

  it('Anular volta ao que era', () => {
    expect(qualFoiUndo(w('a'))).toEqual({ favorite_id: null, name: 'Strength', type: 'strength', qual_foi: false })
    expect(qualFoiUndo(w('a', { type: 'other', sport: null, raw: { sport: 'caminhada' }, name: null }))).toEqual({
      favorite_id: null,
      name: null,
      type: 'other',
      sport: 'caminhada',
      qual_foi: false,
    })
    expect(qualFoiUndo(w('a', { type: 'other', sport: 'xpto' })).sport).toBe('outro')
  })
})
