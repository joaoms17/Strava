import { isBusy } from './busy'

// Versão nova da app (o service worker novo já está ativo): recarrega só
// quando não há nada a meio — nenhuma folha aberta, nada a guardar e nenhum
// campo a ser escrito. Até lá, a versão que está aberta continua a funcionar.
function idle(): boolean {
  if (isBusy()) return false
  if (new URLSearchParams(window.location.search).has('folha')) return false
  const active = document.activeElement
  return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
}

let waiting = false

export function reloadWhenIdle(): void {
  if (waiting) return
  waiting = true
  const tryNow = () => {
    if (!idle()) return
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', tryNow)
    window.location.reload()
  }
  const timer = window.setInterval(tryNow, 2000)
  document.addEventListener('visibilitychange', tryNow)
  tryNow()
}
