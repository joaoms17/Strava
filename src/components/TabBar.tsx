import type { Page } from '../App'

export type Tab = 'registar' | 'hoje' | 'treino' | 'graficos'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'registar', label: 'Registar', icon: 'M12 5v14M5 12h14' },
  { id: 'hoje', label: 'Hoje', icon: 'M12 3v2m0 14v2M3 12h2m14 0h2m-3.3-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m0-13.4 1.4 1.4m10.6 10.6 1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z' },
  { id: 'treino', label: 'Treino', icon: 'M4 9v6M8 6v12M16 6v12M20 9v6M8 12h8' },
  { id: 'graficos', label: 'Gráficos', icon: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
]

export default function TabBar({
  active,
  onChange,
}: {
  active: Page
  onChange: (tab: Tab) => void
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-edge bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
                isActive ? 'text-accent' : 'text-dim'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
