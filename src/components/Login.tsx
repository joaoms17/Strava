import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { RECOVERY_PATH } from '../lib/boot-url'
import { resetRequestError } from '../lib/auth-messages'

type Mode = 'entrar' | 'recuperar' | 'enviado'

export default function Login() {
  const [mode, setMode] = useState<Mode>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (authError) {
      const message = authError.message.toLowerCase()
      if (message.includes('confirm')) {
        setError(
          'O email ainda não está confirmado. No Supabase: Authentication → Users → abre o utilizador → "Confirm email".',
        )
      } else if (message.includes('invalid login')) {
        setError('Email ou palavra-passe errados.')
      } else if (message.includes('fetch') || message.includes('network')) {
        setError('Não consegui falar com o Supabase — verifica as VITE_SUPABASE_* no Vercel.')
      } else {
        setError(authError.message)
      }
    }
    setBusy(false)
  }

  // «Esqueci-me»: o Supabase manda um email com um link para /nova-passe.
  // Por segurança responde igual quer o email exista quer não.
  async function sendReset(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
    })
    setBusy(false)
    if (resetError) setError(resetRequestError(resetError.message))
    else setMode('enviado')
  }

  const field =
    'w-full rounded-xl border border-line bg-surface px-4 py-3 text-[17px] text-ink placeholder:text-dim focus:border-eat focus:outline-none'
  const primary =
    'min-h-12 w-full rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-50'
  const link = 'min-h-11 w-full text-[15px] text-dim underline underline-offset-4'
  const emailField = (
    <input
      type="email"
      name="email"
      autoComplete="username"
      autoCapitalize="none"
      placeholder="Email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      className={field}
    />
  )

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6 text-ink">
      {mode === 'entrar' && (
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h1 className="text-center font-display text-[28px] font-bold tracking-[0.02em] uppercase">
            A Época do Regresso
          </h1>
          {emailField}
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Palavra-passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          {error && <p className="text-[14px] text-eat">{error}</p>}
          <button type="submit" disabled={busy || !email || !password} className={primary}>
            {busy ? 'A entrar…' : 'Entrar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setMode('recuperar')
            }}
            className={link}
          >
            Esqueci-me da palavra-passe
          </button>
        </form>
      )}

      {mode === 'recuperar' && (
        <form onSubmit={sendReset} className="w-full max-w-sm space-y-4">
          <h1 className="font-display text-[28px] font-bold tracking-[0.02em] uppercase">Recuperar palavra-passe</h1>
          <p className="text-[15px] text-dim">
            Escreve o teu email. Mando-te um link para escolheres uma palavra-passe nova.
          </p>
          {emailField}
          {error && <p className="text-[14px] text-eat">{error}</p>}
          <button type="submit" disabled={busy || !email.includes('@')} className={primary}>
            {busy ? 'A enviar…' : 'Enviar link'}
          </button>
          <button type="button" onClick={() => setMode('entrar')} className={link}>
            Voltar
          </button>
        </form>
      )}

      {mode === 'enviado' && (
        <div className="w-full max-w-sm space-y-4">
          <h1 className="font-display text-[28px] font-bold tracking-[0.02em] uppercase">Vê o teu email</h1>
          <p className="text-[17px]">
            Se houver uma conta com <strong className="break-all">{email.trim()}</strong>, chega um email com um link
            em poucos minutos.
          </p>
          <p className="text-[15px] text-dim">
            Vê também no lixo (spam). O link abre no browser: aí escolhes a palavra-passe nova e depois entras aqui
            com ela.
          </p>
          <button type="button" onClick={() => setMode('entrar')} className={primary}>
            Voltar a entrar
          </button>
          <button type="button" onClick={() => setMode('recuperar')} className={link}>
            Não chegou? Pedir outro
          </button>
        </div>
      )}
    </div>
  )
}
