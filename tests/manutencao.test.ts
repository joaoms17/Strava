import { describe, expect, it } from 'vitest'
import { inWaterPhase, isMaintenanceWeek, maintenanceTarget, mondayOf } from '../api/_lib/rules/manutencao'

describe('mondayOf', () => {
  it('recua até à segunda-feira da semana', () => {
    expect(mondayOf('2026-09-14')).toBe('2026-09-14') // segunda
    expect(mondayOf('2026-09-17')).toBe('2026-09-14') // quinta
    expect(mondayOf('2026-09-20')).toBe('2026-09-14') // domingo
  })
})

// Regra 7: manutenção a cada 6 semanas (a 6.ª semana de cada ciclo).
describe('isMaintenanceWeek', () => {
  const anchor = '2026-09-14' // segunda, semana 0

  it('as primeiras 5 semanas são de défice', () => {
    expect(isMaintenanceWeek(anchor, '2026-09-14')).toBe(false) // semana 0
    expect(isMaintenanceWeek(anchor, '2026-10-15')).toBe(false) // semana 4
  })

  it('a 6.ª semana é de manutenção', () => {
    expect(isMaintenanceWeek(anchor, '2026-10-19')).toBe(true) // semana 5, segunda
    expect(isMaintenanceWeek(anchor, '2026-10-25')).toBe(true) // semana 5, domingo
    expect(isMaintenanceWeek(anchor, '2026-10-26')).toBe(false) // semana 6
  })

  it('repete a cada 6 semanas', () => {
    expect(isMaintenanceWeek(anchor, '2026-11-30')).toBe(true) // semana 11
  })

  it('o âncora pode ser um dia a meio da semana', () => {
    expect(isMaintenanceWeek('2026-09-17', '2026-10-19')).toBe(true)
  })
})

describe('maintenanceTarget', () => {
  it('usa o tdee estimado quando existe, senão 2000', () => {
    expect(maintenanceTarget(2135.4)).toBe(2135)
    expect(maintenanceTarget(null)).toBe(2000)
  })
})

// 2026-09-07 é segunda: semanas 0–2 (dias 0–20) e, depois da manutenção
// (semana 5), as semanas 6–8 (dias 42–62) são de água.
describe('inWaterPhase', () => {
  it('as 3 primeiras semanas da dieta', () => {
    expect(inWaterPhase('2026-09-09', '2026-09-07')).toBe(true)
    expect(inWaterPhase('2026-09-09', '2026-09-27')).toBe(true) // dia 20
    expect(inWaterPhase('2026-09-09', '2026-09-28')).toBe(false) // dia 21
  })

  it('as 3 semanas depois de cada semana de manutenção', () => {
    expect(inWaterPhase('2026-09-07', '2026-10-18')).toBe(false) // dia 41, manutenção
    expect(inWaterPhase('2026-09-07', '2026-10-19')).toBe(true) // dia 42
    expect(inWaterPhase('2026-09-07', '2026-11-08')).toBe(true) // dia 62
    expect(inWaterPhase('2026-09-07', '2026-11-09')).toBe(false) // dia 63
  })

  it('sem manutenção só as 3 primeiras; sem início nunca; antes do início não', () => {
    expect(inWaterPhase('2026-09-07', '2026-10-19', false)).toBe(false)
    expect(inWaterPhase('2026-09-07', '2026-09-10', false)).toBe(true)
    expect(inWaterPhase(null, '2026-09-10')).toBe(false)
    expect(inWaterPhase('2026-09-07', '2026-09-01')).toBe(false)
  })
})
