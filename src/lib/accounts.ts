import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { postApi } from './api'
import { personName } from '../../api/_lib/rules/pessoas'

// Várias pessoas no mesmo telemóvel, cada uma com a sua conta: guarda-se a
// sessão de cada uma (só neste telemóvel) e troca-se num toque. Os dados de
// cada pessoa ficam separados pelo RLS, como sempre.

export interface StoredAccount {
  user_id: string
  email: string | null
  name: string
  access_token: string
  refresh_token: string
}

const KEY = 'regresso.contas'
const EVENT = 'regresso:contas'

function read(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as StoredAccount[]) : []
    return Array.isArray(list) ? list.filter((a) => a && a.user_id && a.refresh_token) : []
  } catch {
    return []
  }
}

function write(list: StoredAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // sem armazenamento: fica só a pessoa atual
  }
  window.dispatchEvent(new Event(EVENT))
}

export function listAccounts(): StoredAccount[] {
  return read()
}

// A sessão atual fica sempre guardada (o supabase-js renova os tokens: a
// cópia tem de acompanhar, senão a troca falharia com um token já usado).
export function rememberSession(session: Session): void {
  const list = read()
  const entry: StoredAccount = {
    user_id: session.user.id,
    email: session.user.email ?? null,
    name: personName(session.user.user_metadata?.name, session.user.email),
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }
  const i = list.findIndex((a) => a.user_id === entry.user_id)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  write(list)
}

export function forgetAccount(userId: string): void {
  write(read().filter((a) => a.user_id !== userId))
}

export function startAccountTracking(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (session && event !== 'SIGNED_OUT') rememberSession(session)
  })
  return () => data.subscription.unsubscribe()
}

// Trocar de pessoa: entra com a sessão guardada e recarrega a app (nada da
// pessoa anterior fica em memória).
export async function switchTo(userId: string): Promise<void> {
  const target = read().find((a) => a.user_id === userId)
  if (!target) throw new Error('Essa pessoa já não está neste telemóvel.')
  const { data, error } = await supabase.auth.setSession({
    access_token: target.access_token,
    refresh_token: target.refresh_token,
  })
  if (error || !data.session) {
    forgetAccount(userId)
    throw new Error(`A sessão de ${target.name} acabou. Junta-a outra vez com o email e a palavra-passe.`)
  }
  rememberSession(data.session)
  window.location.assign('/hoje')
}

// Juntar uma pessoa que já tem conta: entra com ela (a atual fica guardada).
export async function addExisting(email: string, password: string): Promise<void> {
  const { data: current } = await supabase.auth.getSession()
  if (current.session) rememberSession(current.session)
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error || !data.session) {
    // A pessoa atual continua (o supabase-js não a apaga num erro, mas por via das dúvidas).
    if (current.session) await supabase.auth.setSession(current.session)
    const message = error?.message.toLowerCase() ?? ''
    throw new Error(
      message.includes('invalid login') ? 'Email ou palavra-passe errados.' : (error?.message ?? 'Não consegui entrar.'),
    )
  }
  rememberSession(data.session)
  window.location.assign('/hoje')
}

export interface NewPersonForm {
  name: string
  email: string
  password: string
  sex: 'm' | 'f'
  height_cm: number
  birth_year: number | null
  weight_kg: number | null
  target_weight_kg: number
}

// Criar a conta de outra pessoa (com o perfil dela) e passar logo para ela.
export async function createPerson(form: NewPersonForm): Promise<void> {
  await postApi('/api/day/add-person', form)
  await addExisting(form.email, form.password)
}

// Sair só desta pessoa: se houver outra neste telemóvel, passa para ela.
export async function signOutCurrent(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const currentId = data.session?.user.id ?? null
  const others = read().filter((a) => a.user_id !== currentId)
  await supabase.auth.signOut({ scope: 'local' })
  if (currentId) forgetAccount(currentId)
  for (const other of others) {
    try {
      await switchTo(other.user_id)
      return
    } catch {
      // essa sessão acabou: tenta a seguinte
    }
  }
  window.location.assign('/')
}

export async function renameCurrent(name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 30)
  if (!clean) throw new Error('Escreve um nome.')
  const { error } = await supabase.auth.updateUser({ data: { name: clean } })
  if (error) throw new Error('Não consegui mudar o nome.')
}

export function useAccounts(): { accounts: StoredAccount[]; currentId: string | null } {
  const [accounts, setAccounts] = useState<StoredAccount[]>(read)
  const [currentId, setCurrentId] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () => setAccounts(read())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    void supabase.auth.getSession().then(({ data }) => setCurrentId(data.session?.user.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setCurrentId(session?.user.id ?? null))
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
      sub.subscription.unsubscribe()
    }
  }, [])
  return { accounts, currentId }
}
