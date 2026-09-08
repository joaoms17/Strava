import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { checkPin, hasPin, setPin } from '../lib/pin'

const LOCK_AFTER_MS = 5 * 60 * 1000

export default function PinGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'locked' | 'create' | 'open'>(() =>
    hasPin() ? 'locked' : 'create',
  )
  const [value, setValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        hiddenAt.current = Date.now()
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS && hasPin()) {
        setMode('locked')
        setValue('')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (mode === 'open') return <>{children}</>

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode === 'create') {
      if (!/^\d{4,6}$/.test(value)) {
        setError('O PIN tem de ter 4 a 6 dígitos.')
        return
      }
      if (value !== confirmValue) {
        setError('Os PINs não coincidem.')
        return
      }
      await setPin(value)
      setMode('open')
      return
    }
    if (await checkPin(value)) {
      setMode('open')
    } else {
      setError('PIN errado.')
      setValue('')
    }
  }

  const inputClass =
    'w-full rounded-xl border border-edge bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] text-ink focus:border-accent focus:outline-none'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-center font-display text-xl">
          {mode === 'create' ? 'Cria um PIN' : 'PIN'}
        </h1>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          className={inputClass}
        />
        {mode === 'create' && (
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="repete"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
          />
        )}
        {error && <p className="text-center text-sm text-warn">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-accent py-3 font-semibold text-bg disabled:opacity-50"
          disabled={value.length < 4}
        >
          {mode === 'create' ? 'Guardar PIN' : 'Abrir'}
        </button>
      </form>
    </div>
  )
}
