import { useState } from 'react'
import { useSheet } from '../lib/sheet'
import { useToast } from '../lib/toast'
import { forgetAccount, renameCurrent, switchTo, useAccounts } from '../lib/accounts'
import { BusyButton } from '../lib/busy'
import { switchPath } from '../../api/_lib/rules/pessoas'

// Definições › Pessoas: quem usa a app neste telemóvel. Cada pessoa tem a
// sua conta e os seus registos; o separador do topo troca entre elas.
export default function PeopleSettings() {
  const sheet = useSheet()
  const toast = useToast()
  const { accounts, currentId } = useAccounts()
  const me = accounts.find((a) => a.user_id === currentId)
  const [name, setName] = useState<string | null>(null)
  const shownName = name ?? me?.name ?? ''

  async function saveName() {
    try {
      await renameCurrent(shownName)
      setName(null)
      toast('Nome guardado.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui.')
    }
  }

  async function change(userId: string) {
    try {
      await switchTo(userId, switchPath(window.location.pathname))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui trocar.')
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[13px] text-dim">O teu nome (aparece no separador)</span>
        <span className="flex gap-2">
          <input
            value={shownName}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[16px] focus:border-eat focus:outline-none"
          />
          {name != null && name.trim() !== me?.name && (
            <BusyButton busy="A guardar…" onClick={saveName} className="min-h-11 rounded-xl bg-cta px-4 font-semibold text-on-cta">
              Guardar
            </BusyButton>
          )}
        </span>
      </label>

      {accounts.length > 1 && (
        <ul className="divide-y divide-line rounded-xl bg-surface2">
          {accounts.map((account) => {
            const current = account.user_id === currentId
            return (
              <li key={account.user_id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">
                    {account.name}
                    {current && <span className="text-dim"> · agora</span>}
                  </span>
                  <span className="block truncate text-[13px] text-dim">{account.email}</span>
                </span>
                {!current && (
                  <>
                    <BusyButton busy="A mudar…" onClick={() => change(account.user_id)} className="min-h-10 px-2 text-[15px] text-eat">
                      Mudar
                    </BusyButton>
                    <button
                      onClick={() => {
                        forgetAccount(account.user_id)
                        toast(`${account.name} saiu deste telemóvel. Os registos continuam guardados.`)
                      }}
                      className="min-h-10 px-2 text-[15px] text-dim"
                      aria-label={`Tirar ${account.name} deste telemóvel`}
                    >
                      Tirar
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <button
        onClick={() => sheet.open('pessoa')}
        className="min-h-12 w-full rounded-xl border border-dashed border-line text-[15px]"
      >
        ＋ Juntar pessoa
      </button>
    </div>
  )
}
