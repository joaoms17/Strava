import { describe, expect, it } from 'vitest'
import { newPasswordProblem, passwordUpdateError, recoveryLinkError, resetRequestError } from '../src/lib/auth-messages'

// Recuperar a palavra-passe: as mensagens do Supabase Auth em frases simples.
describe('recuperar palavra-passe', () => {
  it('nova palavra-passe: mínimo de 8 e as duas iguais', () => {
    expect(newPasswordProblem('curta', 'curta')).toMatch(/pelo menos 8/)
    expect(newPasswordProblem('comprida1', 'comprida2')).toMatch(/não são iguais/)
    expect(newPasswordProblem('comprida1', 'comprida1')).toBeNull()
  })

  it('erros do Supabase ao guardar', () => {
    expect(passwordUpdateError('New password should be different from the old password.')).toMatch(/diferente da antiga/)
    expect(passwordUpdateError('Password should be at least 10 characters.')).toBe('Tem de ter pelo menos 10 caracteres.')
    expect(passwordUpdateError('Auth session missing!')).toMatch(/link expirou/)
    expect(passwordUpdateError('Password is known to be weak and easy to guess, please choose a different one.')).toMatch(/fraca/)
  })

  it('pedir o link: limite do Supabase e email inválido', () => {
    expect(resetRequestError('For security purposes, you can only request this after 42 seconds.')).toMatch(/Espera um minuto/)
    expect(resetRequestError('email rate limit exceeded')).toMatch(/Espera um minuto/)
    expect(resetRequestError('Unable to validate email address: invalid format')).toBe('Esse email não parece válido.')
  })

  it('link expirado', () => {
    expect(recoveryLinkError('otp_expired', 'Email link is invalid or has expired')).toMatch(/expirou/)
    expect(recoveryLinkError(null, null)).toBeNull()
  })
})
