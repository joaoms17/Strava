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
import { checkForUpdates, reloadWhenIdle } from './lib/update'

// Uma versão nova não recarrega a meio de um registo (a foto e o texto da
// folha aberta perdiam-se): espera que não haja nada a meio. E procura-se
// uma versão nova ao voltar à app (H7): uma PWA que fica dias em memória
// só a via num arranque a frio.
registerSW({
  immediate: true,
  onNeedReload: reloadWhenIdle,
  onRegisteredSW: (_url, registration) => {
    if (registration) checkForUpdates(registration)
  },
})
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
