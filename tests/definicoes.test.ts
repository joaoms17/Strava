import { describe, expect, it } from 'vitest'
import { campoMudou, lerPotencias, potenciasMudaram, usaBicicleta } from '../src/lib/definicoes'

describe('Definições: alterações por guardar (H14)', () => {
  it('igual ao gravado não está por guardar, com vírgula ou ponto', () => {
    expect(campoMudou('180', 180)).toBe(false)
    expect(campoMudou('72,5', 72.5)).toBe(false)
    expect(campoMudou(' 72.5 ', 72.5)).toBe(false)
  })
  it('um número diferente, apagado ou escrito de novo está por guardar', () => {
    expect(campoMudou('181', 180)).toBe(true)
    expect(campoMudou('', 180)).toBe(true)
    expect(campoMudou('1990', null)).toBe(true)
    expect(campoMudou('', null)).toBe(false)
    expect(campoMudou('abc', 180)).toBe(true)
  })
  it('as potências comparam-se sem ordem nem repetidos', () => {
    expect(lerPotencias('150 · 130 · 140 · 140 · 9')).toEqual([130, 140, 150])
    expect(potenciasMudaram('150 · 130 · 140', [130, 140, 150])).toBe(false)
    expect(potenciasMudaram('130 · 140', [130, 140, 150])).toBe(true)
    expect(potenciasMudaram('', [])).toBe(false)
  })
})

describe('Definições: secções só para quem as usa (H14)', () => {
  it('a bicicleta aparece com potências ou treinos de bicicleta', () => {
    expect(usaBicicleta({ potencias: [], treinosBicicleta: 0 })).toBe(false)
    expect(usaBicicleta({ potencias: null, treinosBicicleta: 0 })).toBe(false)
    expect(usaBicicleta({ potencias: [140], treinosBicicleta: 0 })).toBe(true)
    expect(usaBicicleta({ potencias: [], treinosBicicleta: 3 })).toBe(true)
  })
})
