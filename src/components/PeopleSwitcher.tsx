import { switchTo, useAccounts } from '../lib/accounts'
import { useToast } from '../lib/toast'
import { BusyButton } from '../lib/busy'
import { SEGMENT_TRACK, segment } from './ui/Chips'
import { switchPath } from '../../api/_lib/rules/pessoas'

// O separador no topo: de quem é a app agora (só aparece com duas ou mais
// pessoas neste telemóvel). Um toque troca de pessoa e fica no mesmo
// separador (no Balanço, o Balanço da outra pessoa).
export default function PeopleSwitcher() {
  const toast = useToast()
  const { accounts, currentId } = useAccounts()
  if (accounts.length < 2 || !currentId) return null

  async function pick(userId: string) {
    if (userId === currentId) return
    try {
      await switchTo(userId, switchPath(window.location.pathname))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui trocar.')
    }
  }

  return (
    <nav
      aria-label="Pessoa"
      className="mx-auto flex max-w-md gap-1 px-4 pt-[calc(10px+env(safe-area-inset-top))]"
    >
      <div className={`flex w-full gap-1 ${SEGMENT_TRACK}`}>
        {accounts.map((account) => {
          const active = account.user_id === currentId
          return (
            <BusyButton
              key={account.user_id}
              busy="A mudar…"
              onClick={() => pick(account.user_id)}
              aria-pressed={active}
              className={`min-h-11 flex-1 truncate rounded-lg px-2 text-[15px] ${segment(active)}`}
            >
              {account.name}
            </BusyButton>
          )
        })}
      </div>
    </nav>
  )
}
