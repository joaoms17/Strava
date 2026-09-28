import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link, Redirect, Route, Switch, useLocation } from 'wouter'
import { supabase, supabaseConfigured } from './lib/supabase'
import { ProfileProvider, useProfile } from './lib/profile'
import { ToastProvider } from './lib/toast'
import { useSheet } from './lib/sheet'
import { useQueueCount } from './lib/sync'
import { fmtDayShort } from './lib/format'
import { nutritionalDay } from './lib/day'
import Login from './components/Login'
import PinGate from './components/PinGate'
import TabBar from './components/TabBar'
import CaptureSheet from './components/sheets/CaptureSheet'
import WeighSheet from './components/sheets/WeighSheet'
import MealSheet from './components/sheets/MealSheet'
import Hoje from './screens/Hoje'
import Registar from './screens/Registar'
import Favoritos from './screens/Favoritos'
import Definicoes from './screens/Definicoes'

// Os ecrãs com gráficos carregam o recharts num chunk à parte.
const Balanco = lazy(() => import('./screens/Balanco'))
const Corpo = lazy(() => import('./screens/Corpo'))
const Treino = lazy(() => import('./screens/Treino'))
const Avancado = lazy(() => import('./screens/Avancado'))
const Arquivo = lazy(() => import('./screens/Arquivo'))

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="max-w-sm space-y-3 text-center text-[15px] text-dim">{children}</div>
    </div>
  )
}

const PARENT: [RegExp, string][] = [
  [/^\/definicoes\/arquivo\/.+/, '/definicoes/arquivo'],
  [/^\/definicoes\/.+/, '/definicoes'],
  [/^\/(definicoes|favoritos|registar)/, '/hoje'],
]

const TITLES: [RegExp, string][] = [
  [/^\/balanco/, 'Balanço'],
  [/^\/treino/, 'Treino'],
  [/^\/corpo/, 'Corpo'],
  [/^\/favoritos/, 'Favoritos'],
  [/^\/registar/, 'Registar'],
  [/^\/definicoes\/avancado/, 'Avançado'],
  [/^\/definicoes\/arquivo/, 'Arquivo'],
  [/^\/definicoes/, 'Definições'],
]

function Header() {
  const [location, navigate] = useLocation()
  const { profile } = useProfile()
  const queued = useQueueCount()
  const parent = PARENT.find(([re]) => re.test(location))?.[1]
  const today = nutritionalDay(new Date(), profile?.nutrition_day_cutoff_hour ?? 4)
  const hojeDate = /^\/hoje\/(\d{4}-\d{2}-\d{2})/.exec(location)?.[1] ?? today
  const title = location.startsWith('/hoje')
    ? fmtDayShort(hojeDate)
    : (TITLES.find(([re]) => re.test(location))?.[1] ?? '')

  return (
    <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-2">
      <div className="flex min-w-0 items-center gap-1">
        {parent && (
          <button onClick={() => navigate(parent)} className="-ml-2 px-2 py-1 text-[17px] text-eat">
            ‹ Voltar
          </button>
        )}
        {!parent && <h1 className="truncate text-[22px] font-semibold">{title}</h1>}
      </div>
      {parent && <h1 className="truncate text-[17px] font-semibold">{title}</h1>}
      <div className="flex shrink-0 items-center gap-3">
        {queued > 0 && (
          <span className="rounded-full bg-surface2 px-2.5 py-1 text-[13px] text-dim">
            {queued} à espera de rede
          </span>
        )}
        {!location.startsWith('/definicoes') && (
          <Link
            href="/definicoes"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface2 text-[15px] font-semibold"
            aria-label="Definições"
          >
            J
          </Link>
        )}
      </div>
    </header>
  )
}

function Sheets() {
  const sheet = useSheet()
  if (sheet.name === 'registar') return <CaptureSheet />
  if (sheet.name === 'peso') return <WeighSheet key={sheet.params.get('data') ?? ''} />
  if (sheet.name === 'refeicao' && sheet.params.get('id')) {
    return <MealSheet key={sheet.params.get('id')} />
  }
  return null
}

function Shell() {
  const { status, reload } = useProfile()

  if (status === 'loading') return <div className="min-h-dvh bg-bg" />
  if (status === 'no-profile') {
    return (
      <Centered>
        <p className="text-ink">Perfil não encontrado.</p>
        <p>Corre os seeds no Supabase (SQL Editor): 01_profile.sql, 02_chapters.sql e 03_exercise_catalog.sql.</p>
      </Centered>
    )
  }
  if (status === 'needs-migration') {
    return (
      <Centered>
        <p className="text-[17px] font-semibold text-ink">Falta um passo no Supabase</p>
        <p>
          A app nova precisa de uma atualização da base de dados. No Supabase, abre o SQL Editor,
          cola o ficheiro <code className="text-ink">supabase/migrations/20260928000000_fase1.sql</code> e
          carrega em Run. Demora segundos e não apaga nada.
        </p>
        <button onClick={() => void reload()} className="mt-2 rounded-xl bg-eat px-4 py-3 font-semibold text-bg">
          Já corri, tentar outra vez
        </button>
      </Centered>
    )
  }
  if (status === 'error') {
    return (
      <Centered>
        <p>Não consegui ligar ao Supabase.</p>
        <button onClick={() => void reload()} className="rounded-xl bg-eat px-4 py-3 font-semibold text-bg">
          Tentar outra vez
        </button>
      </Centered>
    )
  }

  const loading = <p className="pt-8 text-center text-[15px] text-dim">A carregar…</p>
  return (
    <div className="min-h-dvh bg-bg">
      <Header />
      <main className="mx-auto max-w-md px-4 pb-32">
        <Suspense fallback={loading}>
          <Switch>
            <Route path="/">
              <Redirect to="/hoje" replace />
            </Route>
            <Route path="/hoje" component={Hoje} />
            <Route path="/hoje/:date" component={Hoje} />
            <Route path="/balanco" component={Balanco} />
            <Route path="/treino" component={Treino} />
            <Route path="/corpo" component={Corpo} />
            <Route path="/favoritos" component={Favoritos} />
            <Route path="/registar" component={Registar} />
            <Route path="/definicoes" component={Definicoes} />
            <Route path="/definicoes/avancado" component={Avancado} />
            <Route path="/definicoes/arquivo" nest>
              <Arquivo />
            </Route>
            <Route>
              <Redirect to="/hoje" replace />
            </Route>
          </Switch>
        </Suspense>
      </main>
      <TabBar />
      <Sheets />
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!supabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <Centered>
        Faltam as variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.
        Configura o ambiente e volta a abrir a app.
      </Centered>
    )
  }
  if (session === undefined) return <div className="min-h-dvh bg-bg" />
  if (!session) return <Login />

  return (
    <PinGate>
      <ProfileProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </ProfileProvider>
    </PinGate>
  )
}
