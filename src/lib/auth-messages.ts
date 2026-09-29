// Erros do Supabase Auth em frases simples.

export const PASSWORD_MIN = 8

export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `Tem de ter pelo menos ${PASSWORD_MIN} caracteres.`
  if (password !== confirm) return 'As duas palavras-passe não são iguais.'
  return null
}

export function passwordUpdateError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('should be different')) return 'A nova palavra-passe tem de ser diferente da antiga.'
  const min = /at least (\d+) characters/.exec(m)
  if (min) return `Tem de ter pelo menos ${min[1]} caracteres.`
  if (/weak|pwned|leaked|known to be/.test(m)) {
    return 'Essa palavra-passe é fraca ou apareceu numa fuga de dados. Escolhe outra.'
  }
  if (/reauthenticat/.test(m)) return 'O Supabase pede confirmação por email para mudar a palavra-passe.'
  if (/session|jwt|expired|not authenticated|missing/.test(m)) return 'O link expirou ou já foi usado. Pede outro.'
  if (/fetch|network/.test(m)) return 'Sem ligação. Tenta outra vez.'
  return message
}

export function resetRequestError(message: string): string {
  const m = message.toLowerCase()
  if (/rate limit|security purposes|only request this after|too many/.test(m)) {
    return 'Já pediste um link há pouco. Espera um minuto e tenta outra vez.'
  }
  if (/invalid|validate email|format/.test(m)) return 'Esse email não parece válido.'
  if (/fetch|network/.test(m)) return 'Sem ligação. Tenta outra vez.'
  if (/error sending|smtp|email/.test(m)) {
    return 'O Supabase não conseguiu enviar o email. Tenta daqui a uns minutos.'
  }
  return message
}

export function recoveryLinkError(code: string | null, description: string | null): string | null {
  if (!code && !description) return null
  if (code === 'otp_expired' || /expired|invalid/i.test(description ?? '')) {
    return 'O link expirou ou já foi usado. Pede outro no ecrã de entrada.'
  }
  return description ?? 'O link não funcionou. Pede outro no ecrã de entrada.'
}
