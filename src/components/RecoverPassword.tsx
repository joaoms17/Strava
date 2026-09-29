import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { bootUrl } from '../lib/boot-url'
import { recoveryLinkError } from '../lib/auth-messages'
import NewPasswordForm from './NewPasswordForm'

// Página do link «Recuperar palavra-passe» do email (/nova-passe). O link
// abre no browser (no iPhone, fora da app instalada): aqui escolhe-se a nova
// palavra-passe e depois entra-se na app com ela.
export default function RecoverPassword({ onDone }: { onDone: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [done, setDone] = useState(false)
  const linkError = recoveryLinkError(bootUrl.errorCode, bootUrl.error)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive && next) setSession(next)
    })
    // O supabase-js lê o link em segundo plano; sem sessão ao fim de 6 s, o
    // link não serviu.
    const timer = setTimeout(() => alive && setSession((s) => s ?? null), 6000)
    return () => {
      alive = false
      clearTimeout(timer)
      sub.subscription.unsubscribe()
    }
  }, [])

  const box = 'w-full max-w-sm space-y-4'
  const title = <h1 className="font-display text-[28px] font-bold tracking-[0.02em] uppercase">Nova palavra-passe</h1>
  const back = (
    <button onClick={onDone} className="min-h-12 w-full rounded-xl border border-line text-[15px]">
      Voltar ao ecrã de entrada
    </button>
  )

  let body
  if (done) {
    body = (
      <div className={box}>
        {title}
        <p className="text-[17px]">Palavra-passe mudada.</p>
        <p className="text-[15px] text-dim">
          Se usas a app instalada no ecrã principal, abre-a e entra com a nova palavra-passe.
        </p>
        <button
          onClick={onDone}
          className="min-h-12 w-full rounded-xl bg-cta font-display text-[17px] font-bold tracking-[0.04em] text-on-cta uppercase"
        >
          Continuar
        </button>
      </div>
    )
  } else if (session) {
    body = (
      <div className={box}>
        {title}
        <p className="text-[15px] text-dim">{session.user.email}</p>
        <NewPasswordForm email={session.user.email ?? null} submitLabel="Guardar" onDone={() => setDone(true)} />
      </div>
    )
  } else if (session === null || linkError) {
    body = (
      <div className={box}>
        {title}
        <p className="text-[17px] text-eat">{linkError ?? 'O link expirou ou já foi usado. Pede outro no ecrã de entrada.'}</p>
        {back}
      </div>
    )
  } else {
    body = <p className="animate-pulse text-[15px] text-dim">A abrir o link…</p>
  }

  return <div className="flex min-h-dvh items-center justify-center bg-bg p-6 text-ink">{body}</div>
}
