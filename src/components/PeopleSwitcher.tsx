import { useState } from 'react'
import { switchTo, useAccounts } from '../lib/accounts'
import { useToast } from '../lib/toast'

// O separador no topo: de quem é a app agora (só aparece com duas ou mais
// pessoas neste telemóvel). Um toque troca de pessoa.
export default function PeopleSwitcher() {
  const toast = useToast()
  const { accounts, currentId } = useAccounts()
  const [busy, setBusy] = useState<string | null>(null)
  if (accounts.length < 2 || !currentId) return null

  async function pick(userId: string) {
    if (userId === currentId || busy) return
    setBusy(userId)
    try {
      await switchTo(userId)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui trocar.')
      setBusy(null)
    }
  }

  return (
    <nav
      aria-label="Pessoa"
      className="mx-auto flex max-w-md gap-1 px-4 pt-[calc(10px+env(safe-area-inset-top))]"
    >
      <div className="flex w-full gap-1 rounded-xl bg-surface2 p-1">
        {accounts.map((account) => {
          const active = account.user_id === currentId
          return (
            <button
              key={account.user_id}
              onClick={() => void pick(account.user_id)}
              aria-pressed={active}
              className={`min-h-9 flex-1 truncate rounded-lg px-2 text-[15px] ${
                active ? 'bg-eat font-semibold text-bg' : 'text-dim'
              }`}
            >
              {busy === account.user_id ? 'A mudar…' : account.name}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
