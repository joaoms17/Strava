import { Link, useLocation } from 'wouter'
import { useSheet } from '../lib/sheet'

const TABS = [
  { href: '/hoje', label: 'Hoje', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/balanco', label: 'Balanço', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  null,
  { href: '/treino', label: 'Treino', icon: 'M4 9v6M8 6v12M16 6v12M20 9v6M8 12h8' },
  { href: '/corpo', label: 'Corpo', icon: 'M12 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm-5 7h10l-1.5 9h-7L7 11Z' },
] as const

// Barra de baixo: Hoje · Balanço · (+) · Treino · Corpo. O (+) abre a folha Registar.
export default function TabBar() {
  const [location] = useLocation()
  const sheet = useSheet()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md items-end">
        {TABS.map((tab) =>
          tab == null ? (
            <div key="plus" className="flex flex-1 justify-center">
              <button
                onClick={() => sheet.open('registar')}
                className="-mt-4 mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-eat text-bg shadow-lg"
                aria-label="Registar"
              >
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
          ) : (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-[13px] ${
                location.startsWith(tab.href) ? 'text-ink' : 'text-dim'
              }`}
              aria-current={location.startsWith(tab.href) ? 'page' : undefined}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
              {tab.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  )
}
