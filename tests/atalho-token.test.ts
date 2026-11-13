import { describe, expect, it } from 'vitest'
import {
  missingColumn,
  personalToken,
  sharedSecretAccepted,
  tokenClaimedUser,
  tokenEpoch,
  tokenUser,
} from '../api/_lib/ingest-token'

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

  // G4: gerar um token novo invalida o anterior; sem data vale o de origem.
  it('o token de origem continua a valer enquanto não se gera outro', () => {
    const origem = personalToken(secret, joana)
    expect(tokenUser(secret, origem, null)).toBe(joana)
    expect(personalToken(secret, joana, null)).toBe(origem)
  })

  it('gerar outro invalida o anterior (o de origem e o gerado antes)', () => {
    const origem = personalToken(secret, joana)
    const primeiro = personalToken(secret, joana, '2026-11-13T10:00:00.000Z')
    const segundo = personalToken(secret, joana, '2026-11-20T08:30:00.123Z')
    expect(primeiro).not.toBe(origem)
    expect(tokenUser(secret, primeiro, '2026-11-13T10:00:00.000Z')).toBe(joana)
    expect(tokenUser(secret, origem, '2026-11-13T10:00:00.000Z')).toBeNull()
    expect(tokenUser(secret, primeiro, '2026-11-20T08:30:00.123Z')).toBeNull()
    expect(tokenUser(secret, segundo, '2026-11-20T08:30:00.123Z')).toBe(joana)
  })

  it('a data vale igual no formato da base de dados e no do JavaScript', () => {
    const token = personalToken(secret, joao, '2026-11-13T10:00:00.123Z')
    expect(tokenUser(secret, token, '2026-11-13T10:00:00.123+00:00')).toBe(joao)
    expect(tokenEpoch('2026-11-13T10:00:00.123+00:00')).toBe(tokenEpoch('2026-11-13T10:00:00.123Z'))
    expect(tokenEpoch('lixo')).toBeNull()
    expect(tokenEpoch(null)).toBeNull()
  })

  it('de quem diz ser o token (para ler a data antes de confirmar)', () => {
    expect(tokenClaimedUser(personalToken(secret, joana))).toBe(joana)
    expect(tokenClaimedUser('abc.def')).toBeNull()
    expect(tokenClaimedUser(secret)).toBeNull()
  })

  it('o segredo da casa deixa de valer quando a primeira conta gera o seu token', () => {
    expect(sharedSecretAccepted(null)).toBe(true)
    expect(sharedSecretAccepted(undefined)).toBe(true)
    expect(sharedSecretAccepted('2026-11-13T10:00:00Z')).toBe(false)
  })

  it('sem a migração (coluna em falta) lê-se como o token de origem', () => {
    expect(missingColumn({ code: '42703', message: 'column profile.ingest_token_at does not exist' })).toBe(true)
    expect(missingColumn({ code: 'PGRST204', message: "Could not find the 'ingest_token_at' column" })).toBe(true)
    expect(missingColumn({ code: '08006', message: 'connection failure' })).toBe(false)
    expect(missingColumn(null)).toBe(false)
  })
})
