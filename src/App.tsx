import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './lib/supabase'
import Login from './components/Login'
import PinGate from './components/PinGate'
import TabBar, { type Tab } from './components/TabBar'
import Registar from './screens/Registar'
import Hoje from './screens/Hoje'
import Treino from './screens/Treino'
import Capitulo from './screens/Capitulo'

// Gráficos carrega o recharts — fica num chunk próprio, só quando é preciso.
const Graficos = lazy(() => import('./screens/Graficos'))

export type Page = Tab | 'capitulo'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [page, setPage] = useState<Page>('registar')

  useEffect(() => {
    if (!supabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <p className="max-w-sm text-center text-dim">
          Faltam as variáveis <code>VITE_SUPABASE_URL</code> e{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. Configura o ambiente e volta a abrir a app.
        </p>
      </div>
    )
  }

  if (session === undefined) {
    return <div className="min-h-dvh bg-bg" />
  }

  if (!session) {
    return <Login />
  }

  return (
    <PinGate>
      <div className="flex min-h-dvh flex-col bg-bg">
        <header className="flex items-center justify-between px-4 pt-4 pb-2">
          <button
            className="text-left font-display text-lg text-ink"
            onClick={() => setPage('registar')}
          >
            A Época do Regresso
          </button>
          <div className="flex items-center gap-4">
            <button
              className={`text-sm ${page === 'capitulo' ? 'text-accent' : 'text-dim'}`}
              onClick={() => setPage('capitulo')}
            >
              Capítulo
            </button>
            <button
              className="text-sm text-dim"
              onClick={() => void supabase.auth.signOut()}
              aria-label="Sair"
            >
              Sair
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pb-28">
          {page === 'registar' && <Registar />}
          {page === 'hoje' && <Hoje />}
          {page === 'treino' && <Treino />}
          {page === 'graficos' && (
            <Suspense fallback={<p className="pt-8 text-center text-sm text-dim">A carregar…</p>}>
              <Graficos />
            </Suspense>
          )}
          {page === 'capitulo' && <Capitulo />}
        </main>

        <TabBar active={page} onChange={setPage} />
      </div>
    </PinGate>
  )
}
