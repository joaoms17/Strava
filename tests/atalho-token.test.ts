import { describe, expect, it } from 'vitest'
import { personalToken, tokenUser } from '../api/_lib/ingest-token'

// Token do Atalho do iPhone por pessoa (a Joana manda os passos e o sono do
// Apple Watch para a conta dela).
describe('token pessoal do Atalho', () => {
  const secret = 'segredo-de-teste'
  const joana = '85237bd5-2f89-42cd-8aa8-59942bff4c67'
  const joao = '3b3b6d86-f2e0-41f5-9681-2e3cce7e5724'

  it('volta a dar a pessoa certa', () => {
    expect(tokenUser(secret, personalToken(secret, joana))).toBe(joana)
    expect(tokenUser(secret, personalToken(secret, joao))).toBe(joao)
  })

  it('não aceita trocar a pessoa nem outro segredo', () => {
    const sig = personalToken(secret, joana).split('.')[1]
    expect(tokenUser(secret, `${joao}.${sig}`)).toBeNull()
    expect(tokenUser('outro', personalToken(secret, joana))).toBeNull()
  })

  it('não aceita lixo', () => {
    expect(tokenUser(secret, '')).toBeNull()
    expect(tokenUser(secret, secret)).toBeNull()
    expect(tokenUser(secret, `${joana}.`)).toBeNull()
    expect(tokenUser(secret, 'abc.def')).toBeNull()
  })
})
