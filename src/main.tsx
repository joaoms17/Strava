import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import './index.css'
import App from './App'
import { applyStoredTheme } from './lib/theme'
import { reloadWhenIdle } from './lib/update'

// Uma versão nova não recarrega a meio de um registo (a foto e o texto da
// folha aberta perdiam-se): espera que não haja nada a meio.
registerSW({ immediate: true, onNeedReload: reloadWhenIdle })
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
