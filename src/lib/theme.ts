import type { Profile } from './types'

const KEY = 'regresso.theme'

// Tema Sistema / Escuro / Claro: data-theme no <html> (sem atributo = sistema).
export function applyTheme(theme: Profile['theme'] | null | undefined): void {
  const root = document.documentElement
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme
  else delete root.dataset.theme
  try {
    localStorage.setItem(KEY, theme ?? 'system')
  } catch {
    // sem armazenamento local, o tema aplica-se só nesta sessão
  }
}

// Antes de o perfil chegar, usa o último tema escolhido (evita o piscar).
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'dark' || stored === 'light') document.documentElement.dataset.theme = stored
  } catch {
    // ignora
  }
}
