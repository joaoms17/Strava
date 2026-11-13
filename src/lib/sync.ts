import { useCallback, useEffect, useState } from 'react'
import { listCaptures, ownCapture } from './capture-queue'
import { supabase } from './supabase'

// O que ainda não chegou ao servidor: as que falharam também contam (senão
// uma foto com erro desaparecia do topo e ninguém dava por ela).
export function useQueueCount(): { count: number; failed: number } {
  const [count, setCount] = useState({ count: 0, failed: 0 })
  const refresh = useCallback(async () => {
    try {
      const [captures, { data }] = await Promise.all([
        listCaptures(),
        supabase.auth.getSession(),
      ])
      const userId = data.session?.user.id ?? null
      const own = captures.filter((c) => ownCapture(c, userId))
      setCount({ count: own.length, failed: own.filter((c) => c.state === 'erro').length })
    } catch {
      setCount({ count: 0, failed: 0 })
    }
  }, [])

  useEffect(() => {
    const run = () => void refresh()
    run()
    const onVisible = () => {
      if (!document.hidden) run()
    }
    window.addEventListener('online', run)
    window.addEventListener('regresso:data', refresh)
    window.addEventListener('regresso:captures', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', run)
      window.removeEventListener('regresso:data', refresh)
      window.removeEventListener('regresso:captures', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  return count
}
