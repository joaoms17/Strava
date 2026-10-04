import { useState } from 'react'
import PersonFields, { EMPTY_PERSON, personPayload } from './PersonFields'
import { postApi } from '../lib/api'
import { signOutCurrent } from '../lib/accounts'
import { supabase } from '../lib/supabase'

// Primeira vez de uma conta sem perfil: os dados para começar. Os alvos
// calculam-se a partir daqui e mudam-se depois nas Definições.
export default function Welcome({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState(EMPTY_PERSON)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const payload = personPayload(draft)

  async function save() {
    if (!payload || busy) return
    setBusy(true)
    setError(null)
    try {
      await postApi('/api/day/create-profile', payload)
      // O nome ficou na conta: a sessão nova já o traz (para o separador).
      await supabase.auth.refreshSession().catch(() => undefined)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui guardar.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg px-4 pt-[calc(24px+env(safe-area-inset-top))] pb-10 text-ink">
      <div className="mx-auto max-w-md space-y-5">
        <div className="space-y-1">
          <h1 className="font-display text-[30px] leading-none font-extrabold uppercase">Olá! Vamos começar</h1>
          <p className="text-[15px] text-dim">Só uns dados para começar. Os teus registos ficam só teus.</p>
        </div>
        <PersonFields value={draft} onChange={setDraft} />
        {error && <p className="text-[14px] text-eat">{error}</p>}
        <button
          disabled={!payload || busy}
          onClick={() => void save()}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[19px] font-bold tracking-[0.06em] text-on-cta uppercase disabled:opacity-40"
        >
          {busy ? 'A preparar…' : 'Começar'}
        </button>
        <button onClick={() => void signOutCurrent()} className="min-h-11 w-full text-[15px] text-dim">
          Sair desta conta
        </button>
      </div>
    </div>
  )
}
