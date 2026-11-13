import { describe, expect, it } from 'vitest'
import { usesBikePower, usesConnectIq, wattsChoices } from '../src/lib/bicicleta'

describe('bicicleta só para quem a usa (T15)', () => {
  it('as potências das Definições, ou as das últimas sessões; nunca números fixos', () => {
    expect(wattsChoices([150, 130], [200])).toEqual([130, 150])
    expect(wattsChoices([], [145, 140, 145, null, 150, 160, 170])).toEqual([140, 145, 150, 160])
    expect(wattsChoices(null, [])).toEqual([])
  })
  it('uma volta de estrada sem potência não mostra «Próxima bicicleta»', () => {
    expect(usesBikePower({ bikeFavorites: 0, bikes: [{ watts: null }] })).toBe(false)
    expect(usesBikePower({ bikeFavorites: 0, bikes: [{ watts: 140, watts_source: 'prefill' }] })).toBe(false)
    expect(usesBikePower({ bikeFavorites: 0, bikes: [{ watts: 140, watts_source: 'console' }] })).toBe(true)
    expect(usesBikePower({ bikeFavorites: 1, bikes: [] })).toBe(true)
    expect(usesBikePower({ profileOptions: [130], bikeFavorites: 0, bikes: [] })).toBe(true)
  })
  it('os prints da secção Connect IQ só a quem já teve watts do relógio ou da consola', () => {
    expect(usesConnectIq([{ watts: null }, { watts: 140, watts_source: 'manual' }])).toBe(false)
    expect(usesConnectIq([{ watts: 138, watts_source: 'device' }])).toBe(true)
  })
})
