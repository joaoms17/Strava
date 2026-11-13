import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// B17: passos e sono só no Hoje e no Corpo › Recuperação; a projeção
// completa no Corpo e no Balanço (o cartão «Projeção»), sem a repetir na
// frase de «Para esta semana».
const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', file), 'utf8')

describe('B17 · sem repetições no Balanço', () => {
  it('o Balanço não mostra passos nem sono por semana ou por dia', () => {
    for (const file of ['src/screens/Balanco.tsx', 'src/components/BalancoMes.tsx']) {
      const src = read(file)
      expect(src).not.toMatch(/fmtSleep|Passos: \$\{|passos`/)
    }
  })

  it('a projeção completa está no Corpo e no Balanço', () => {
    expect(read('src/components/corpo/Resumo.tsx')).toMatch(/<Projecao /)
    const balanco = read('src/screens/Balanco.tsx')
    expect(balanco).toMatch(/<Projecao /)
    expect(balanco).not.toMatch(/projectionLine\(/)
  })

  it('a ligação do Balanço leva ao Corpo › Recuperação', () => {
    expect(read('src/components/BalancoMes.tsx')).toMatch(/\/corpo\?ver=recuperacao/)
    expect(read('src/screens/Corpo.tsx')).toMatch(/get\('ver'\)/)
  })
})
