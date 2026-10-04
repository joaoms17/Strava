// O que fica guardado no telemóvel (rascunhos, a importação a meio) é de
// cada pessoa: a chave leva o id de quem está a usar a app.
let activeUser: string | null = null

export function setActiveUser(id: string | null): void {
  activeUser = id
}

export function activeUserId(): string | null {
  return activeUser
}

export function scopedKey(base: string): string {
  return activeUser ? `${base}:${activeUser}` : base
}

// Antes de haver várias pessoas a chave não tinha dono: passa para a atual.
export function readScoped(storage: Storage, base: string): string | null {
  try {
    const key = scopedKey(base)
    const own = storage.getItem(key)
    if (own != null || key === base) return own
    const legacy = storage.getItem(base)
    if (legacy != null) {
      storage.setItem(key, legacy)
      storage.removeItem(base)
    }
    return legacy
  } catch {
    return null
  }
}

export function writeScoped(storage: Storage, base: string, value: string | null): void {
  try {
    if (value == null) storage.removeItem(scopedKey(base))
    else storage.setItem(scopedKey(base), value)
  } catch {
    // sem armazenamento: perde-se só o rascunho
  }
}
