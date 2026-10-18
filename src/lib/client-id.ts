import { useCallback, useRef } from 'react'

// O client_id de um registo feito numa folha. Repetir o mesmo envio (tocar
// outra vez depois de uma falha de rede, com o servidor já a ter gravado)
// leva o mesmo client_id e não grava a dobrar. Mudar o que se envia (outro
// prato do menu, outros números) é outro registo, com outro client_id: senão
// o servidor devolvia o primeiro e o ecrã dizia «Registado» com o que não foi.
export function useClientId(): (content: unknown) => string {
  const last = useRef<{ key: string; id: string } | null>(null)
  return useCallback((content: unknown) => {
    const key = JSON.stringify(content)
    if (last.current?.key !== key) last.current = { key, id: crypto.randomUUID() }
    return last.current.id
  }, [])
}
