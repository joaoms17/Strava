import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { checkPin, getPinMode, hasPin, lockAfterMs, setPin, setPinMode } from '../lib/pin'

const LAST_SEEN_KEY = 'regresso.last_seen'

function lastSeen(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_SEEN_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function markSeen() {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now()))
  } catch {
    // ignora
  }
}

function shouldLock(): boolean {
  const limit = lockAfterMs(getPinMode())
  if (limit == null || !hasPin()) return false
  const seen = lastSeen()
  return seen == null || Date.now() - seen > limit
}

// PIN de 4 dígitos, pedido por omissão só depois de 12 h sem usar a app.
export default function PinGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'locked' | 'create' | 'open'>(() => {
    if (getPinMode() === 'off') return 'open'
    if (!hasPin()) return 'create'
    return shouldLock() ? 'locked' : 'open'
  })
  const [value, setValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    if (mode === 'open') markSeen()
    function onVisibility() {
      if (document.hidden) {
        hiddenAt.current = Date.now()
        if (mode === 'open') markSeen()
      } else if (mode === 'open' && shouldLock()) {
        setMode('locked')
        setValue('')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [mode])

  if (mode === 'open') return <>{children}</>

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode === 'create') {
      if (!/^\d{4}$/.test(value)) {
        setError('O PIN tem 4 dígitos.')
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
    'h-16 w-full rounded-2xl border border-line bg-surface text-center text-[32px] tracking-[0.5em] focus:border-eat focus:outline-none'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-center text-[22px] font-semibold">{mode === 'create' ? 'Cria um PIN' : 'PIN'}</h1>
        {mode === 'create' && (
          <p className="text-center text-[15px] text-dim">
            Só é pedido depois de 12 h sem abrir a app. Podes mudar nas Definições.
          </p>
        )}
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={mode === 'create' ? 4 : 6}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          className={inputClass}
          aria-label="PIN"
        />
        {mode === 'create' && (
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="repete"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value.replace(/\D/g, ''))}
            className={inputClass}
            aria-label="Repete o PIN"
          />
        )}
        {error && <p className="text-center text-[15px] text-pain">{error}</p>}
        <button
          type="submit"
          className="min-h-14 w-full rounded-2xl bg-eat font-semibold text-bg disabled:opacity-40"
          disabled={value.length < 4}
        >
          {mode === 'create' ? 'Guardar PIN' : 'Abrir'}
        </button>
        {mode === 'create' && (
          <button
            type="button"
            onClick={() => {
              setPinMode('off')
              setMode('open')
            }}
            className="w-full py-2 text-[15px] text-dim"
          >
            Agora não (sem PIN)
          </button>
        )}
      </form>
    </div>
  )
}
