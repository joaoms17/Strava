import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { PASSWORD_MIN, newPasswordProblem, passwordUpdateError } from '../lib/auth-messages'
import { busyContent, runBusy, useBusyKey } from '../lib/busy'

// Nova palavra-passe (duas vezes) → supabase.auth.updateUser. O campo do
// email, escondido, ajuda o iPhone a guardar a nova palavra-passe no porta-chaves.
export default function NewPasswordForm({
  email,
  submitLabel,
  onDone,
}: {
  email: string | null
  submitLabel: string
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busyKey, busy] = useBusyKey()
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const problem = newPasswordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(passwordUpdateError(updateError.message))
      return
    }
    setPassword('')
    setConfirm('')
    onDone()
  }

  const field =
    'w-full rounded-xl border border-line bg-surface px-4 py-3 text-[17px] text-ink placeholder:text-dim focus:border-eat focus:outline-none'

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        void runBusy('A guardar…', save, busyKey)
      }}
      className="space-y-3"
    >
      {email && (
        <input type="email" name="email" autoComplete="username" value={email} readOnly className="sr-only" tabIndex={-1} />
      )}
      <input
        type={show ? 'text' : 'password'}
        name="new-password"
        autoComplete="new-password"
        placeholder={`Nova palavra-passe (mín. ${PASSWORD_MIN})`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={field}
      />
      <input
        type={show ? 'text' : 'password'}
        name="confirm-password"
        autoComplete="new-password"
        placeholder="Repete a nova palavra-passe"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className={field}
      />
      <label className="flex items-center gap-2 text-[14px] text-dim">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-cta" />
        Mostrar
      </label>
      {error && <p className="text-[14px] text-eat">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password || !confirm}
        className="min-h-12 w-full rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-50"
      >
        {busyContent(busy, 'A guardar…', submitLabel)}
      </button>
    </form>
  )
}
