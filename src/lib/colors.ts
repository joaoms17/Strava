import { useEffect, useState } from 'react'

// Cores do tema lidas das variáveis CSS, para os gráficos (SVG) seguirem o
// tema claro ou escuro.
const NAMES = ['bg', 'surface', 'surface2', 'line', 'ink', 'dim', 'eat', 'burn', 'protein', 'body', 'bodyfat', 'attn', 'pain', 'ok', 'chart-bike', 'chart-gym', 'chart-health'] as const
export type ThemeColors = Record<(typeof NAMES)[number], string>

function read(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  return Object.fromEntries(
    NAMES.map((name) => [name, style.getPropertyValue(`--color-${name}`).trim() || '#888']),
  ) as ThemeColors
}

export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(read)
  useEffect(() => {
    const refresh = () => setColors(read())
    const media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', refresh)
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', refresh)
      observer.disconnect()
    }
  }, [])
  return colors
}
