import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { applyTheme } from './theme'
import { readScoped, writeScoped } from './scoped'
import { isTransientFailure } from '../../api/_lib/rules/falhas'
import { schemaCheck } from '../../api/_lib/rules/esquema'
import { cleanProfile, profileFromCache, profileToCache } from './profile-cache'
import type { Profile } from './types'

// O perfil carrega uma vez e fica disponível para todos os ecrãs. Fica
// também guardado no telemóvel (de cada pessoa): sem rede a app abre com ele
// (offline) para se poder registar, e volta a ler quando o token renova.
type Status = 'loading' | 'ready' | 'no-profile' | 'needs-migration' | 'error'
const CACHE = 'regresso.perfil'

interface ProfileState {
  profile: Profile | null
  status: Status
  offline: boolean
  missingMigrations: string[]
  // Migrações que faltam mas não param a app (só com a tabela schema_version).
  pendingMigrations: string[]
  reload: () => Promise<void>
  update: (patch: Partial<Profile>) => Promise<boolean>
}

const ProfileContext = createContext<ProfileState>({
  profile: null,
  status: 'loading',
  offline: false,
  missingMigrations: [],
  pendingMigrations: [],
  reload: async () => {},
  update: async () => false,
})

export function useProfile() {
  return useContext(ProfileContext)
}

// O ecrã que precisa do perfil só é mostrado com ele carregado.
export function useReadyProfile(): Profile {
  const { profile } = useContext(ProfileContext)
  if (!profile) throw new Error('Perfil ainda não carregado.')
  return profile
}

// Só uma coluna que o Postgres diz não existir (uma falha de rede não conta).
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42703' || /column .+ does not exist/i.test(error?.message ?? '')
}

export function ProfileProvider({ children, token }: { children: ReactNode; token?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [missingMigrations, setMissing] = useState<string[]>([])
  const [pendingMigrations, setPending] = useState<string[]>([])
  const [offline, setOffline] = useState(false)

  const reload = useCallback(async () => {
    const [{ data, error, status: httpStatus }, migration, sleep, version] = await Promise.all([
      supabase.from('profile').select('*').maybeSingle(),
      supabase.from('favorites').select('id', { count: 'exact', head: true }),
      // Migração 9 (coluna nova): sem ela o sono ficava
      // vazios sem aviso. Sem head: o Postgres só diz o erro com corpo.
      supabase.from('health_daily').select('sleep_score').limit(1),
      // Ideia 6: a versão do schema (migração 20261113000042). Sem a tabela
      // (ou com outro erro), os marcadores de baixo.
      supabase.from('schema_version').select('version').maybeSingle(),
    ])
    // Sem rede (ou sem sessão renovada): o último perfil deste telemóvel.
    const fromCache = async () => {
      // Uma falha de rede, ou nenhuma linha por a sessão ainda não ter renovado.
      const usable = error
        ? isTransientFailure({ message: error.message, status: httpStatus })
        : !(await supabase.auth.getSession()).data.session
      if (!usable) return false
      try {
        // Com tolerância: uma cópia estragada ou de antes da limpeza (L12) não parte.
        const saved = profileFromCache(readScoped(localStorage, CACHE))
        if (!saved) return false
        setProfile(saved)
        applyTheme(saved.theme)
        setOffline(true)
        setStatus('ready')
        return true
      } catch {
        return false
      }
    }
    if (error) {
      if (!(await fromCache())) setStatus('error')
      return
    }
    if (!data) {
      if (!(await fromCache())) setStatus('no-profile')
      return
    }
    const fresh = cleanProfile(data as Record<string, unknown>)
    // Com a tabela schema_version, a lista do que falta vem dela: só param a
    // app as migrações antigas sem as quais nada funciona; as outras ficam como
    // aviso em Avançado (o código lê as colunas novas com tolerância).
    const checked = version.error ? null : schemaCheck(version.data?.version)
    if (checked) {
      setPending(checked.pending)
      if (checked.blocking.length) {
        setProfile(fresh)
        setMissing(checked.blocking)
        setStatus('needs-migration')
        return
      }
      setMissing([])
      setProfile(fresh)
      applyTheme(fresh.theme)
      writeScoped(localStorage, CACHE, profileToCache(fresh))
      setOffline(false)
      setStatus('ready')
      return
    }
    setPending([])
    // Sem a tabela: cada fase nova do redesenho traz uma migração para correr
    // no Supabase, detetada por uma coluna que a app usa. Só falta a tabela
    // quando o Postgres o diz: uma falha de rede (no iPhone, ao voltar à app)
    // não é migração por correr.
    const noFavorites =
      migration.error != null &&
      (migration.error.code === '42P01' ||
        migration.error.code === 'PGRST205' ||
        /favorites/.test(migration.error.message ?? ''))
    const missing = [
      // Marcadores em colunas que a app usa (não em colunas mortas, que uma
      // limpeza da base de dados pode apagar).
      ...(noFavorites || !('dismissed_hints' in data) ? ['20260928000000_fase1.sql'] : []),
      ...(!('ai_monthly_cap_eur' in data) ? ['20260929000000_fase2.sql'] : []),
      ...(!('has_garmin_watch' in data) ? ['20260930000000_fase3.sql'] : []),
      ...(!('measure_interval_days' in data) ? ['20261001000000_fase4.sql'] : []),
      ...(!('integration_status' in data) ? ['20261004000000_fase7.sql'] : []),
      ...(missingColumn(sleep.error) ? ['20261005000000_sono.sql'] : []),
    ]
    if (missing.length) {
      setProfile(fresh)
      setMissing(missing)
      setStatus('needs-migration')
      return
    }
    setMissing([])
    setProfile(fresh)
    applyTheme(fresh.theme)
    writeScoped(localStorage, CACHE, profileToCache(fresh))
    setOffline(false)
    setStatus('ready')
  }, [])

  const update = useCallback(
    async (patch: Partial<Profile>) => {
      if (!profile) return false
      setProfile({ ...profile, ...patch })
      if (patch.theme) applyTheme(patch.theme)
      const { error } = await supabase.from('profile').update(patch).eq('id', profile.id)
      if (error) {
        setProfile(profile)
        if (patch.theme) applyTheme(profile.theme)
        return false
      }
      // A cópia deste telemóvel acompanha (sem rede abre com o tema e os alvos novos).
      writeScoped(localStorage, CACHE, profileToCache({ ...profile, ...patch }))
      return true
    },
    [profile],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  // Aberta sem rede: lê outra vez quando a rede volta ou o token renova.
  useEffect(() => {
    if (!offline) return
    void reload()
    const again = () => void reload()
    window.addEventListener('online', again)
    return () => window.removeEventListener('online', again)
  }, [token, offline])

  return (
    <ProfileContext.Provider value={{ profile, status, offline, missingMigrations, pendingMigrations, reload, update }}>
      {children}
    </ProfileContext.Provider>
  )
}
