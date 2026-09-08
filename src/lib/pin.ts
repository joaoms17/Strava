// Bloqueio por PIN no cliente — conveniência local, não substitui o Auth.
const STORAGE_KEY = 'regresso.pin'

interface StoredPin {
  salt: string
  hash: string
}

async function digest(salt: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function read(): StoredPin | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredPin) : null
  } catch {
    return null
  }
}

export function hasPin(): boolean {
  return read() !== null
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.randomUUID()
  const hash = await digest(salt, pin)
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ salt, hash }))
}

export async function checkPin(pin: string): Promise<boolean> {
  const stored = read()
  if (!stored) return false
  return (await digest(stored.salt, pin)) === stored.hash
}

export function clearPin(): void {
  localStorage.removeItem(STORAGE_KEY)
}
