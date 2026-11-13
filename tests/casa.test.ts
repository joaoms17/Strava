import { describe, expect, it } from 'vitest'
import { houseByEmail, houseEmails } from '../api/_lib/rules/casa'

// G1: a casa fecha-se com HOUSE_EMAILS; sem a variável fica como sempre.
describe('a casa', () => {
  it('sem HOUSE_EMAILS, qualquer conta (comportamento de sempre)', () => {
    expect(houseEmails(undefined)).toBeNull()
    expect(houseEmails('  , ')).toBeNull()
    expect(houseByEmail('quem@quer.que.seja', null)).toBe(true)
  })

  it('com a lista, o email tem de lá estar (sem ligar a maiúsculas)', () => {
    const list = houseEmails('Joao@Exemplo.pt, joana@exemplo.pt\nbea@exemplo.pt')
    expect(list?.size).toBe(3)
    expect(houseByEmail('joao@exemplo.pt', list)).toBe(true)
    expect(houseByEmail(' JOANA@exemplo.pt', list)).toBe(true)
    expect(houseByEmail('intruso@exemplo.pt', list)).toBe(false)
    expect(houseByEmail(undefined, list)).toBe(false)
  })
})
