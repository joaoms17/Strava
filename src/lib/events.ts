import { useEffect, useState } from 'react'

// Aviso simples «os dados mudaram»: uma folha grava, os ecrãs recarregam.
const EVENT = 'regresso:data'

export function emitDataChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

// Versão que sobe quando os dados mudam ou a app volta ao primeiro plano.
export function useDataVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    const onVisible = () => {
      if (!document.hidden) bump()
    }
    window.addEventListener(EVENT, bump)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(EVENT, bump)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return version
}
