import { Link, useLocation } from 'wouter'
import { useSheet } from '../lib/sheet'
import Icon, { type IconName } from './ui/Icon'

const TABS: ({ href: string; label: string; icon: IconName } | null)[] = [
  { href: '/hoje', label: 'Hoje', icon: 'today' },
  { href: '/balanco', label: 'Balanço', icon: 'chart' },
  null,
  { href: '/treino', label: 'Treino', icon: 'dumbbell' },
  { href: '/corpo', label: 'Corpo', icon: 'body' },
]

// Barra de baixo: Hoje · Balanço · (+) · Treino · Corpo. O (+) abre a folha Registar.
export default function TabBar() {
  const [location] = useLocation()
  const sheet = useSheet()
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md items-start">
        {TABS.map((tab) =>
          tab == null ? (
            <div key="plus" className="flex flex-1 justify-center pt-1.5">
              <button
                onClick={() => sheet.open('registar')}
                className="flex h-[58px] w-[58px] items-center justify-center rounded-[18px] bg-cta text-on-cta active:scale-95"
                aria-label="Registar"
              >
                <Icon name="plus" size={30} stroke={2.6} />
              </button>
            </div>
          ) : (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 font-display text-[13px] tracking-[0.1em] uppercase ${
                location.startsWith(tab.href) ? 'font-bold text-cta' : 'font-semibold text-dim'
              }`}
              aria-current={location.startsWith(tab.href) ? 'page' : undefined}
            >
              <Icon name={tab.icon} />
              {tab.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  )
}
