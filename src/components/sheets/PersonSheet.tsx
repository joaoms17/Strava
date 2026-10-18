import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import PersonFields, { EMPTY_PERSON, personPayload } from '../PersonFields'
import { useSheet } from '../../lib/sheet'
import { addExisting, createPerson } from '../../lib/accounts'
import { BusyButton } from '../../lib/busy'
import { SEGMENT_TRACK, segment as segmentStyle } from '../ui/Chips'

type Mode = 'nova' | 'existente'

// Juntar outra pessoa a este telemóvel: criar a conta dela (com os dados
// para começar) ou entrar com uma conta que já existe. Depois aparece o
// separador no topo para trocar.
export default function PersonSheet() {
  const sheet = useSheet()
  const [mode, setMode] = useState<Mode>(sheet.params.get('modo') === 'existente' ? 'existente' : 'nova')
  const [draft, setDraft] = useState(EMPTY_PERSON)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Correu bem: a app recarrega com a pessoa nova (nada a tocar até lá).
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const payload = personPayload(draft)
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const canSubmit = emailOk && password.length >= (mode === 'nova' ? 8 : 1) && (mode === 'existente' || payload != null)

  async function submit() {
    if (!canSubmit || leaving) return
    setError(null)
    try {
      if (mode === 'nova') await createPerson({ ...payload!, email: email.trim(), password })
      else await addExisting(email, password)
      // A app recarrega já com a pessoa nova.
      setLeaving(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui.')
    }
  }

  const field =
    'h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none'
  const segment = (m: Mode, label: string) => (
    <button
      onClick={() => {
        setMode(m)
        setError(null)
      }}
      aria-pressed={mode === m}
      className={`min-h-10 rounded-lg ${segmentStyle(mode === m)}`}
    >
      {label}
    </button>
  )

  return (
    <BottomSheet
      title="Juntar pessoa"
      onClose={sheet.close}
      footer={
        <BusyButton
          busy={mode === 'nova' ? 'A criar a conta…' : 'A entrar…'}
          disabled={!canSubmit || leaving}
          onClick={submit}
          className="min-h-14 w-full rounded-2xl bg-cta font-display text-[18px] font-bold tracking-[0.04em] text-on-cta uppercase disabled:opacity-40"
        >
          {leaving ? 'A mudar…' : mode === 'nova' ? 'Criar conta e mudar' : 'Entrar e mudar'}
        </BusyButton>
      }
    >
      <div className="space-y-4 pb-2">
        <div className={`grid grid-cols-2 ${SEGMENT_TRACK} text-[15px]`}>
          {segment('nova', 'Conta nova')}
          {segment('existente', 'Já tem conta')}
        </div>
        <p className="text-[14px] text-dim">
          Cada pessoa tem os seus registos (comida, peso, medidas, treinos) e trocas no separador do topo. Também pode
          entrar no telemóvel dela com o mesmo email.
        </p>
        {mode === 'nova' && <PersonFields value={draft} onChange={setDraft} />}
        <label className="block space-y-1">
          <span className="label">Email</span>
          <input
            type="email"
            autoCapitalize="none"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@exemplo.com"
            className={field}
          />
        </label>
        <label className="block space-y-1">
          <span className="label">{mode === 'nova' ? 'Palavra-passe (mín. 8)' : 'Palavra-passe'}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
        </label>
        {error && <p className="text-[14px] text-eat">{error}</p>}
      </div>
    </BottomSheet>
  )
}
