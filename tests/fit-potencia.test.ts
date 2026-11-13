import { describe, expect, it } from 'vitest'
import { summaryDevFields } from '../api/_lib/fit'

// T19: sem sessão no FIT, a potência média das apps é a média dos registos
// (ou das voltas, pesadas pelo tempo), não a do fim do treino.
const descriptions = [
  { key: 0, fieldName: 'Power', units: 'W' },
  { key: 1, fieldName: 'Distance', units: 'km' },
  { key: 2, fieldName: 'Max Power', units: 'W' },
]
const dev = (power: number, km: number, max: number) => ({ developerFields: { 0: power, 1: km, 2: max } })

describe('potência média do FIT (T19)', () => {
  it('com sessão: os valores dela', () => {
    const fields = summaryDevFields({
      fieldDescriptionMesgs: descriptions,
      sessionMesgs: [dev(140, 20, 300)],
      recordMesgs: [dev(90, 1, 90), dev(200, 20, 300)],
    })
    expect(fields.find((f) => f.name === 'Power')?.value).toBe(140)
  })

  it('só registos: a média de todos; a distância e o máximo do último', () => {
    const fields = summaryDevFields({
      fieldDescriptionMesgs: descriptions,
      recordMesgs: [dev(100, 5, 150), dev(150, 10, 220), dev(80, 15, 220)],
    })
    expect(fields.find((f) => f.name === 'Power')?.value).toBe(110)
    expect(fields.find((f) => f.name === 'Distance')?.value).toBe(15)
    expect(fields.find((f) => f.name === 'Max Power')?.value).toBe(220)
  })

  it('só voltas: a média pesada pelo tempo de cada volta', () => {
    const fields = summaryDevFields({
      fieldDescriptionMesgs: descriptions,
      lapMesgs: [
        { ...dev(150, 10, 200), totalTimerTime: 1800 },
        { ...dev(90, 12, 200), totalTimerTime: 600 },
      ],
    })
    expect(fields.find((f) => f.name === 'Power')?.value).toBe(135)
    expect(fields.find((f) => f.name === 'Distance')?.value).toBe(12)
  })
})
