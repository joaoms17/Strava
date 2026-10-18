import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link, Redirect, Route, Switch, useLocation } from 'wouter'
import { supabase, supabaseConfigured } from './lib/supabase'
import { ProfileProvider, useProfile } from './lib/profile'
import { ToastProvider, useToast } from './lib/toast'
import { useSheet } from './lib/sheet'
import { useQueueCount } from './lib/sync'
import { onDuplicate, useCaptureSync } from './lib/capture-queue'
import { checkPush, savedPushPrefs } from './lib/push'
import { isBusy } from './lib/busy'
import { fmtDayShort } from './lib/format'
import { nutritionalDay } from './lib/day'
import Login from './components/Login'
import Welcome from './components/Welcome'
import PeopleSwitcher from './components/PeopleSwitcher'
import { startAccountTracking, storedSession, useAccounts } from './lib/accounts'
import { setActiveUser } from './lib/scoped'
import { initialOf, sessionEnded } from '../api/_lib/rules/pessoas'
import RecoverPassword from './components/RecoverPassword'
import { bootUrl } from './lib/boot-url'
import TabBar from './components/TabBar'
import BusyLayer from './components/ui/BusyLayer'
import CaptureSheet from './components/sheets/CaptureSheet'
import WeighSheet from './components/sheets/WeighSheet'
import MealSheet from './components/sheets/MealSheet'
import GallerySheet from './components/sheets/GallerySheet'
import RepeatSheet from './components/sheets/RepeatSheet'
import NewFavoriteSheet from './components/sheets/NewFavoriteSheet'
import DietSheet from './components/sheets/DietSheet'
import PersonSheet from './components/sheets/PersonSheet'
import NoteSheet from './components/sheets/NoteSheet'
import BarcodeSheet from './components/sheets/BarcodeSheet'
import MenuSheet from './components/sheets/MenuSheet'
import ReviewSheet from './components/sheets/ReviewSheet'
import TreinoSheet from './components/sheets/TreinoSheet'
import LogWorkoutSheet from './components/sheets/LogWorkoutSheet'
import JaFizSheet from './components/sheets/JaFizSheet'
import TemplateSheet from './components/sheets/TemplateSheet'
import DizerTreinoSheet from './components/sheets/DizerTreinoSheet'
import ConfirmWorkoutSheet from './components/sheets/ConfirmWorkoutSheet'
import MedidasSheet, { ComoMedirSheet } from './components/sheets/MedidasSheet'
import Hoje from './screens/Hoje'
import Favoritos from './screens/Favoritos'
import Definicoes from './screens/Definicoes'

// Os ecrãs com gráficos carregam o recharts num chunk à parte. Com uma versão
// nova à espera (main.tsx só recarrega sem nada a meio), os ficheiros da
// antiga podem já não existir: recarrega uma vez em vez de falhar.
const RELOADED = 'regresso.recarregou'
function screen<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then(
      (module) => {
        try {
          sessionStorage.removeItem(RELOADED)
        } catch {
          // sem armazenamento
        }
        return module
      },
      (err: unknown) => {
        let again = true
        try {
          again = sessionStorage.getItem(RELOADED) === '1'
          sessionStorage.setItem(RELOADED, '1')
        } catch {
          // sem armazenamento: não arrisca recarregar sem parar
        }
        if (again) throw err
        window.location.reload()
        return new Promise<never>(() => {})
      },
    ),
  )
}
const Balanco = screen(() => import('./screens/Balanco'))
const Corpo = screen(() => import('./screens/Corpo'))
const Treino = screen(() => import('./screens/Treino'))
const Avancado = screen(() => import('./screens/Avancado'))
const Arquivo = screen(() => import('./screens/Arquivo'))
const MedidasHistorico = screen(() => import('./screens/MedidasHistorico'))
const Ginasio = screen(() => import('./screens/Ginasio'))

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <div className="max-w-sm space-y-3 text-center text-[15px] text-dim">{children}</div>
    </div>
  )
}

const PARENT: [RegExp, string][] = [
  [/^\/corpo\/.+/, '/corpo'],
  [/^\/treino\/.+/, '/treino'],
  [/^\/definicoes\/arquivo\/.+/, '/definicoes/arquivo'],
  [/^\/definicoes\/.+/, '/definicoes'],
  [/^\/(definicoes|favoritos)/, '/hoje'],
]

const TITLES: [RegExp, string][] = [
  [/^\/balanco/, 'Balanço'],
  [/^\/treino\/ginasio/, 'Ginásio'],
  [/^\/treino/, 'Treino'],
  [/^\/corpo\/medidas/, 'Medidas'],
  [/^\/corpo/, 'Corpo'],
  [/^\/favoritos/, 'Favoritas'],
  [/^\/definicoes\/avancado/, 'Avançado'],
  [/^\/definicoes\/arquivo/, 'Arquivo'],
  [/^\/definicoes/, 'Definições'],
]

function Header({ belowSwitcher = false }: { belowSwitcher?: boolean }) {
  const [location, navigate] = useLocation()
  const { accounts, currentId } = useAccounts()
  const me = accounts.find((a) => a.user_id === currentId)
  const { profile } = useProfile()
  const queued = useQueueCount()
  const parent = PARENT.find(([re]) => re.test(location))?.[1]
  const today = nutritionalDay(new Date(), profile?.nutrition_day_cutoff_hour ?? 4)
  const hojeDate = /^\/hoje\/(\d{4}-\d{2}-\d{2})/.exec(location)?.[1] ?? today
  const title = location.startsWith('/hoje')
    ? fmtDayShort(hojeDate)
    : (TITLES.find(([re]) => re.test(location))?.[1] ?? '')

  return (
    <header
      className={`mx-auto flex max-w-md items-end justify-between gap-3 px-4 pb-3 ${
        belowSwitcher ? 'pt-3' : 'pt-[calc(14px+env(safe-area-inset-top))]'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1">
        {parent && (
          <button onClick={() => navigate(parent)} className="-ml-2 px-2 py-1 text-[17px] font-medium text-ink">
            ‹ Voltar
          </button>
        )}
        {!parent && (
          <div className="min-w-0">
            {location.startsWith('/hoje') && <p className="label">{hojeDate === today ? 'Hoje' : 'A ver o dia'}</p>}
            <h1 className="truncate font-display text-[34px] leading-none font-extrabold uppercase">{title}</h1>
          </div>
        )}
      </div>
      {parent && <h1 className="truncate font-display text-[22px] font-bold uppercase">{title}</h1>}
      <div className="flex shrink-0 items-center gap-3">
        {queued.count > 0 && (
          <span className={`rounded-full bg-surface2 px-2.5 py-1 text-[13px] ${queued.failed > 0 ? 'text-eat' : 'text-dim'}`}>
            {!navigator.onLine
              ? `${queued.count} à espera de rede`
              : queued.failed > 0
                ? `${queued.count} por enviar`
                : `A enviar ${queued.count}`}
          </span>
        )}
        {!location.startsWith('/definicoes') && (
          <Link
            href="/definicoes"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface font-display text-[20px] font-bold"
            aria-label="Definições"
          >
            {initialOf(me?.name ?? 'J')}
          </Link>
        )}
      </div>
    </header>
  )
}

function Sheets() {
  const sheet = useSheet()
  if (sheet.name === 'registar') return <CaptureSheet key="registar" />
  if (sheet.name === 'peso') return <WeighSheet key={sheet.params.get('data') ?? ''} />
  if (sheet.name === 'refeicao' && sheet.params.get('id')) {
    return <MealSheet key={sheet.params.get('id')} />
  }
  if (sheet.name === 'galeria') return <GallerySheet />
  if (sheet.name === 'escrever') return <CaptureSheet key="escrever" focus />
  if (sheet.name === 'repetir') return <RepeatSheet />
  if (sheet.name === 'nova-favorita') return <NewFavoriteSheet key={sheet.params.get('momento') ?? ''} />
  if (sheet.name === 'dieta') return <DietSheet key={sheet.params.get('id') ?? 'nova'} />
  if (sheet.name === 'pessoa') return <PersonSheet />
  if (sheet.name === 'nota' && sheet.params.get('id')) return <NoteSheet key={sheet.params.get('id')} />
  if (sheet.name === 'barras') return <BarcodeSheet />
  if (sheet.name === 'menu') return <MenuSheet />
  if (sheet.name === 'rever') return <ReviewSheet />
  if (sheet.name === 'treino') return <TreinoSheet />
  if (sheet.name === 'registar-treino') return <LogWorkoutSheet key={sheet.params.get('fav') ?? ''} />
  if (sheet.name === 'ja-fiz') return <JaFizSheet key={sheet.params.get('fav') ?? ''} />
  if (sheet.name === 'confirmar-treino') return <ConfirmWorkoutSheet />
  if (sheet.name === 'medidas') return <MedidasSheet key={sheet.params.get('id') ?? ''} />
  if (sheet.name === 'como-medir') return <ComoMedirSheet />
  if (sheet.name === 'meu-treino') return <TemplateSheet key={sheet.params.get('id') ?? 'novo'} />
  if (sheet.name === 'dizer-treino') return <DizerTreinoSheet />
  return null
}

// Envia as capturas em fila e avisa quando uma foto já estava registada.
function CaptureSync() {
  const toast = useToast()
  const sheet = useSheet()
  useCaptureSync()
  useEffect(
    () =>
      onDuplicate((meal) =>
        toast(`Esta foto já estava registada (${fmtDayShort(meal.date)})`, [
          { label: 'Abrir', run: () => sheet.open('refeicao', { id: meal.id }) },
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  )
  return null
}

// Notificações: ao abrir a app (e ao voltar a ela, no máximo de hora a hora)
// confirma que a subscrição deste telemóvel continua viva, por trás. Tocar
// numa notificação com a app aberta muda de ecrã sem recarregar.
const PUSH_CHECK_MS = 3_600_000

function PushSync() {
  const [, navigate] = useLocation()
  useEffect(() => {
    let last = 0
    const check = () => {
      if (document.hidden || Date.now() - last < PUSH_CHECK_MS || !savedPushPrefs()) return
      last = Date.now()
      void checkPush().catch(() => undefined)
    }
    // Depois do arranque, para não atrasar o primeiro ecrã.
    const timer = setTimeout(check, 3000)
    document.addEventListener('visibilitychange', check)
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null
      // A meio de um «A guardar…» não se muda de ecrã (a app já está à frente).
      if (data?.type === 'abrir' && typeof data.url === 'string' && /^\/(?!\/)/.test(data.url) && !isBusy()) {
        navigate(data.url)
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [navigate])
  return null
}

function Shell() {
  const { status, reload, missingMigrations } = useProfile()
  const { accounts } = useAccounts()

  if (status === 'loading') return <div className="min-h-dvh bg-bg" />
  // Conta nova sem perfil: os dados para começar (alvos calculados).
  if (status === 'no-profile') return <Welcome onDone={() => void reload()} />
  if (status === 'needs-migration') {
    return (
      <Centered>
        <p className="text-[17px] font-semibold text-ink">Falta um passo no Supabase</p>
        <p>
          A app nova precisa de uma atualização da base de dados. No Supabase, abre o SQL Editor e corre,
          por esta ordem, {missingMigrations.length === 1 ? 'o ficheiro' : 'os ficheiros'}:
        </p>
        <ul className="space-y-1">
          {missingMigrations.map((file) => (
            <li key={file}>
              <code className="text-ink">supabase/migrations/{file}</code>
            </li>
          ))}
        </ul>
        <p>Cola cada um, carrega em Run. Demora segundos e não apaga nada.</p>
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
      <PeopleSwitcher />
      <Header belowSwitcher={accounts.length >= 2} />
      {/* Espaço em baixo para as últimas linhas nunca ficarem por baixo da barra nem de um aviso. */}
      <main className="mx-auto max-w-md px-4 pb-48">
        <Suspense fallback={loading}>
          <Switch>
            <Route path="/">
              <Redirect to="/hoje" replace />
            </Route>
            <Route path="/hoje" component={Hoje} />
            <Route path="/hoje/:date" component={Hoje} />
            <Route path="/balanco" component={Balanco} />
            <Route path="/treino" component={Treino} />
            <Route path="/treino/ginasio" component={Ginasio} />
            <Route path="/corpo" component={Corpo} />
            <Route path="/corpo/medidas" component={MedidasHistorico} />
            <Route path="/favoritos" component={Favoritos} />
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
      <CaptureSync />
      <PushSync />
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // Aberta pelo link «Recuperar palavra-passe» do email.
  const [recovering, setRecovering] = useState(bootUrl.recovery)

  useEffect(() => {
    if (!supabaseConfigured) return
    // Guarda a sessão de cada pessoa deste telemóvel (para o separador).
    const stopTracking = startAccountTracking()
    supabase.auth.getSession().then(({ data, error }) => {
      // Sem rede, a sessão guardada: não acabou, só falta renovar o token.
      const session = data.session ?? (error && !sessionEnded(error) ? storedSession() : null)
      setActiveUser(session?.user.id ?? null)
      setSession(session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      // Sem rede o supabase-js anuncia «sem sessão» ao começar; quem decide é o getSession acima.
      if (event === 'INITIAL_SESSION' && !next) return
      setActiveUser(next?.user.id ?? null)
      setSession(next)
    })
    return () => {
      sub.subscription.unsubscribe()
      stopTracking()
    }
  }, [])

  if (!supabaseConfigured) {
    return (
      <Centered>
        Faltam as variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.
        Configura o ambiente e volta a abrir a app.
      </Centered>
    )
  }
  if (recovering) {
    return (
      <RecoverPassword
        onDone={() => {
          window.history.replaceState(null, '', '/hoje')
          setRecovering(false)
        }}
      />
    )
  }
  if (session === undefined) return <div className="min-h-dvh bg-bg" />
  if (!session) return <Login />

  return (
    <ProfileProvider key={session.user.id} token={session.access_token}>
      <ToastProvider>
        <Shell />
        <BusyLayer />
      </ToastProvider>
    </ProfileProvider>
  )
}
