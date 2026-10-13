import { describe, expect, it } from 'vitest'
import { fatTally } from '../api/_lib/rules/conta-gordura'

// Conta da gordura: défice dos dias completos a 7700 kcal/kg contra o peso.
describe('fatTally', () => {
  const days = [
    { date: '2026-09-30', kcal_in: 1500, kcal_out_est: 2500, is_complete: true }, // antes do início
    { date: '2026-10-01', kcal_in: 1500, kcal_out_est: 2500, is_complete: true },
    { date: '2026-10-02', kcal_in: 1700, kcal_out_est: 2400, is_complete: true },
    { date: '2026-10-03', kcal_in: 900, kcal_out_est: 2400, is_complete: false }, // incompleto
    { date: '2026-10-04', kcal_in: 2000, kcal_out_est: 2300, is_complete: true, flags: ['faltou_algo'] },
    { date: '2026-10-05', kcal_in: 2600, kcal_out_est: 2300, is_complete: true }, // excedente
    { date: '2026-10-06', kcal_in: 1000, kcal_out_est: 2500, is_complete: true }, // hoje: não conta
  ]
  const weights = [
    { date: '2026-09-28', kg: 90 },
    { date: '2026-10-01', kg: 90 },
    { date: '2026-10-03', kg: 89.6 },
    { date: '2026-10-05', kg: 89.2 },
  ]

  it('soma o défice só dos dias completos, sem hoje nem «faltou algo»', () => {
    const t = fatTally(days, weights, '2026-10-01', '2026-10-06')
    expect(t.diasContados).toBe(3)
    expect(t.diasFora).toBe(2)
    expect(t.defice).toBe(1000 + 700 - 300)
    expect(t.previstoKg).toBe(0.2)
  })

  it('o peso real é o peso médio no início contra o mais recente', () => {
    const t = fatTally(days, weights, '2026-10-01', '2026-10-06')
    // início: média de 28/9 e 1/10 = 90; fim: média de 1/10, 3/10 e 5/10 = 89,6
    expect(t.realKg).toBe(0.4)
  })

  it('recomeçar a contagem só conta a partir dessa data', () => {
    const t = fatTally(days, weights, '2026-10-05', '2026-10-06')
    expect(t.diasContados).toBe(1)
    expect(t.defice).toBe(-300)
    expect(t.previstoKg).toBe(0)
  })

  it('sem pesagens não há peso real', () => {
    expect(fatTally(days, [], '2026-10-01', '2026-10-06').realKg).toBeNull()
  })
})
