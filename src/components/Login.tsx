import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError('Email ou palavra-passe errados.')
    setBusy(false)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center font-display text-2xl">A Época do Regresso</h1>
        <input
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-edge bg-card px-4 py-3 text-ink placeholder:text-dim focus:border-accent focus:outline-none"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Palavra-passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-edge bg-card px-4 py-3 text-ink placeholder:text-dim focus:border-accent focus:outline-none"
        />
        {error && <p className="text-sm text-warn">{error}</p>}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
        >
          {busy ? 'A entrar…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
