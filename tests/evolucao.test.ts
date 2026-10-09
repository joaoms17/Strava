import { describe, expect, it } from 'vitest'
import { cleanAnalysis, daysToConfirm, foodWeeks, weightSummary, wellnessMonths } from '../api/_lib/rules/evolucao'

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

  it('dias por confirmar: incompletos, com refeições, sem resposta, sem hoje', () => {
    const days = [
      { date: '2026-10-08', kcal_in: 900, is_complete: false },
      { date: '2026-10-07', kcal_in: 1100.4, is_complete: false },
      { date: '2026-10-06', kcal_in: 2000, is_complete: true },
      { date: '2026-10-05', kcal_in: 700, is_complete: false, flags: ['dia_fechado'] },
      { date: '2026-10-04', kcal_in: 600, is_complete: false, flags: ['faltou_algo'] },
      { date: '2026-10-03', kcal_in: 0, is_complete: false },
      { date: '2026-09-01', kcal_in: 800, is_complete: false },
    ]
    const meals = { '2026-10-08': 1, '2026-10-07': 1, '2026-10-06': 3, '2026-10-05': 1, '2026-10-04': 1, '2026-09-01': 1 }
    expect(daysToConfirm(days, meals, '2026-10-08')).toEqual([{ data: '2026-10-07', refeicoes: 1, kcal: 1100 }])
  })
})
