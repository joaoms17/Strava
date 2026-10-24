import { describe, expect, it } from 'vitest'
import {
  WEIGHT_HISTORY_DAYS,
  cleanAnalysis,
  daysToConfirm,
  foodWeeks,
  measurementSummary,
  scaleFatSummary,
  weightSummary,
  wellnessMonths,
} from '../api/_lib/rules/evolucao'
import { shiftDate } from '../api/_lib/rules/nutritional-day'

// Corpo › Evolução: o que vai para a IA e o que se mostra do que ela devolve.
describe('análise da evolução', () => {
  it('só áreas conhecidas, uma vez cada, pela ordem; as vazias e «sem dados» saem', () => {
    const a = cleanAnalysis({
      titulo: ' A descer devagar ',
      resumo: 'Bom mês.',
      areas: [
        { area: 'sono', estado: 'pior', texto: 'Dormiste menos 30 min.' },
        { area: 'peso', estado: 'melhor', texto: '−1,2 kg em 30 dias.' },
        { area: 'peso', estado: 'pior', texto: 'repetida' },
        { area: 'coracao', estado: 'sem_dados', texto: '' },
        { area: 'humor', estado: 'melhor', texto: 'não existe' },
        { area: 'passos', estado: 'igual', texto: '' },
      ],
      foco: ['Proteína a 140 g', '', 'Dormir 7 h', 'Caminhar', 'A mais'],
    })
    expect(a.titulo).toBe('A descer devagar')
    expect(a.areas.map((x) => [x.area, x.estado])).toEqual([
      ['peso', 'melhor'],
      ['sono', 'pior'],
    ])
    expect(a.foco).toEqual(['Proteína a 140 g', 'Dormir 7 h', 'Caminhar'])
    expect(cleanAnalysis(null)).toEqual({ titulo: '', resumo: '', areas: [], foco: [], perguntas: [] })
  })

  it('peso: último, média de 7 dias hoje e há 30 dias (só com pesagem perto)', () => {
    const weights = [
      { date: '2026-09-01', kg: 88 },
      { date: '2026-09-04', kg: 87.6 },
      { date: '2026-10-03', kg: 86.2 },
      { date: '2026-10-05', kg: 85.8 },
    ]
    const w = weightSummary(weights, '2026-10-05')!
    expect(w.ultimo).toEqual({ data: '2026-10-05', kg: 85.8 })
    expect(w.media_7_dias.hoje).toBe(86)
    expect(w.media_7_dias.ha_30_dias).toBe(87.8)
    expect(w.media_7_dias.ha_90_dias).toBeNull()
    expect(weightSummary([], '2026-10-05')).toBeNull()
  })

  it('comida: 4 semanas, só dias completos, a última termina ontem', () => {
    const days = [
      { date: '2026-10-04', kcal_in: 1800, protein: 130, kcal_target: 1700, is_complete: true },
      { date: '2026-10-03', kcal_in: 1600, protein: 120, kcal_target: 1700, is_complete: true },
      { date: '2026-10-02', kcal_in: 400, protein: 20, kcal_target: 1700, is_complete: false },
      { date: '2026-10-05', kcal_in: 900, protein: 50, kcal_target: 1700, is_complete: true },
    ]
    const weeks = foodWeeks(days, '2026-10-05')
    expect(weeks).toHaveLength(4)
    expect(weeks[3]).toMatchObject({ de: '2026-09-28', a: '2026-10-04', dias_completos: 2, comeu_kcal: 1700, proteina_g: 125 })
  })

  it('relógio: 30 dias contra os 30 antes, sem a FC dos dias sem noite', () => {
    const rows = [
      { date: '2026-10-04', steps: 9000, resting_hr: 55, sleep_minutes: 420 },
      { date: '2026-10-01', steps: 7000, resting_hr: 74 },
      { date: '2026-10-05', steps: 300 },
      { date: '2026-08-20', steps: 5000, resting_hr: 60, sleep_score: 70 },
    ]
    const m = wellnessMonths(rows, '2026-10-05')
    expect(m.ultimos_30_dias).toMatchObject({ dias_com_dados: 2, passos: 8000, fc_repouso: 55, sono_minutos: 420 })
    expect(m.os_30_antes).toMatchObject({ dias_com_dados: 1, passos: 5000, fc_repouso: 60 })
  })

  it('perguntas: só dias por confirmar, uma por dia, no máximo 3', () => {
    const raw = {
      perguntas: [
        { data: '2026-10-03', pergunta: 'Só 1 refeição. Foi jejum?' },
        { data: '2026-10-03', pergunta: 'repetida' },
        { data: '2026-10-01', pergunta: 'Não foi à IA' },
        { data: 'ontem', pergunta: 'data inválida' },
        { data: '2026-10-04', pergunta: '' },
        { data: '2026-10-05', pergunta: 'Foi tudo?' },
        { data: '2026-10-06', pergunta: 'Foi tudo?' },
        { data: '2026-10-07', pergunta: 'A quarta' },
      ],
    }
    const allowed = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']
    expect(cleanAnalysis(raw, allowed).perguntas.map((q) => q.data)).toEqual(['2026-10-03', '2026-10-05', '2026-10-06'])
    // Sem lista (no ecrã), qualquer data válida.
    expect(cleanAnalysis(raw).perguntas.map((q) => q.data)).toEqual(['2026-10-03', '2026-10-01', '2026-10-05'])
  })

  it('dias por confirmar: pelas refeições (não pelo dia guardado), sem resposta, sem hoje', () => {
    const days = [
      { date: '2026-10-05', flags: ['dia_fechado'] },
      { date: '2026-10-04', flags: ['faltou_algo'] },
    ]
    const meals = {
      '2026-10-08': { refeicoes: 1, kcal: 900 }, // hoje
      '2026-10-07': { refeicoes: 1, kcal: 1100.4 },
      '2026-10-06': { refeicoes: 8, kcal: 2391 }, // completo (o dia guardado a 0 não conta)
      '2026-10-05': { refeicoes: 1, kcal: 700 },
      '2026-10-04': { refeicoes: 1, kcal: 600 },
      '2026-10-03': { refeicoes: 3, kcal: 700 },
      '2026-09-01': { refeicoes: 1, kcal: 800 },
    }
    expect(daysToConfirm(days, meals, '2026-10-08')).toEqual([
      { data: '2026-10-07', dia: '7/10', refeicoes: 1, kcal: 1100 },
      { data: '2026-10-03', dia: '3/10', refeicoes: 3, kcal: 700 },
    ])
  })

  it('peso há 90 dias: a média de 7 dias com as pesagens pedidas (não uma pesagem solta)', () => {
    const today = '2026-10-18'
    // pesagens de −95 a −88 dias e hoje; só entram as da janela pedida
    const weights = [
      ...[95, 94, 93, 92, 91, 90, 89, 88].map((d, i) => ({ date: shiftDate(today, -d), kg: 90 - i * 0.2 })),
      { date: shiftDate(today, -120), kg: 99 },
      { date: today, kg: 85 },
    ].filter((w) => w.date >= shiftDate(today, -WEIGHT_HISTORY_DAYS))
    const w = weightSummary(weights, today)!
    // a −90: média de −95 a −90 (90; 89,8; …; 89) = 89,5
    expect(w.media_7_dias.ha_90_dias).toBe(89.5)
    // com só 90 dias pedidos ficava a pesagem crua de −90 (89)
    const narrow = weights.filter((x) => x.date >= shiftDate(today, -90))
    expect(weightSummary(narrow, today)!.media_7_dias.ha_90_dias).toBe(89)
  })

  it('medidas: gordura com a fórmula do sexo, e o «desde» só com a cintura no mesmo sítio', () => {
    const rows = [
      { date: '2026-08-01', neck_cm: 32, waist_cm: 81, hips_cm: 99, weight_used_kg: 62, readings: null },
      { date: '2026-09-01', neck_cm: 32, waist_cm: 80, hips_cm: 98, weight_used_kg: 61, readings: null },
      { date: '2026-10-01', neck_cm: 32, waist_cm: 74, hips_cm: 98, weight_used_kg: 60.5, readings: { waist_site: 'natural' } },
      { date: '2026-10-15', neck_cm: 32, waist_cm: 73, hips_cm: 97, weight_used_kg: 60, readings: { waist_site: 'natural' } },
    ]
    const m = measurementSummary(rows, 165, 'f', '2026-10-18')!
    expect(m.dias_desde_a_ultima).toBe(3)
    expect(m.ultimas.map((x) => x.data)).toEqual(['2026-10-15', '2026-10-01', '2026-09-01', '2026-08-01'])
    expect(m.ultimas[0]).toMatchObject({ zonas_cm: { cintura: 73, anca: 97, pescoco: 32 }, peso_usado_kg: 60, gordura_pct: 27 })
    expect(m.ultimas[0]!.categoria).toBe('Saudável')
    expect(m.ultimas[0]).not.toHaveProperty('cintura_no_umbigo')
    expect(m.ultimas[2]).toMatchObject({ cintura_no_umbigo: true })
    // compara 1/10 com 15/10, não com as do umbigo
    expect(m.desde_a_primeira).toMatchObject({ de: '2026-10-01', a: '2026-10-15' })
    expect(measurementSummary([], 165, 'f', '2026-10-18')).toBeNull()
    // nos homens não há «no umbigo» a assinalar
    const men = measurementSummary([{ date: '2026-10-01', neck_cm: 40, waist_cm: 94, weight_used_kg: 85 }], 183, 'm', '2026-10-18')!
    expect(men.ultimas[0]).toMatchObject({ gordura_pct: 21, gordura_kg: 17.5, massa_magra_kg: 67.5 })
    expect(men.ultimas[0]).not.toHaveProperty('cintura_no_umbigo')
    expect(men.desde_a_primeira).toBeNull()
  })

  it('balança: a média suavizada hoje e há 30 dias', () => {
    const rows = [
      { date: '2026-09-01', body_fat_pct: 24 },
      { date: '2026-09-10', body_fat_pct: 20 },
      { date: '2026-10-10', body_fat_pct: 23 },
      { date: '2026-10-17', body_fat_pct: '25' },
    ]
    // há 30 dias só entram 1/9 e 10/9
    expect(scaleFatSummary(rows, '2026-10-18')).toEqual({ media_pct: 23.7, ha_30_dias_pct: 23.6 })
    expect(scaleFatSummary([], '2026-10-18')).toBeNull()
  })
})
