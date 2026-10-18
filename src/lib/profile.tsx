import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { applyTheme } from './theme'
import { readScoped, writeScoped } from './scoped'
import { isTransientFailure } from '../../api/_lib/rules/falhas'
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
  reload: () => Promise<void>
  update: (patch: Partial<Profile>) => Promise<boolean>
}

const ProfileContext = createContext<ProfileState>({
  profile: null,
  status: 'loading',
  offline: false,
  missingMigrations: [],
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
  const [offline, setOffline] = useState(false)

  const reload = useCallback(async () => {
    const [{ data, error, status: httpStatus }, migration, sleep, water] = await Promise.all([
      supabase.from('profile').select('*').maybeSingle(),
      supabase.from('favorites').select('id', { count: 'exact', head: true }),
      // Migrações 9 e 12 (colunas novas): sem elas o sono e a água ficavam
      // vazios sem aviso. Sem head: o Postgres só diz o erro com corpo.
      supabase.from('health_daily').select('sleep_score').limit(1),
      supabase.from('days').select('water_ml').limit(1),
    ])
    // Sem rede (ou sem sessão renovada): o último perfil deste telemóvel.
    const fromCache = async () => {
      // Uma falha de rede, ou nenhuma linha por a sessão ainda não ter renovado.
      const usable = error
        ? isTransientFailure({ message: error.message, status: httpStatus })
        : !(await supabase.auth.getSession()).data.session
      if (!usable) return false
      try {
        const cached = readScoped(localStorage, CACHE)
        if (!cached) return false
        const saved = JSON.parse(cached) as Profile
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
    // Cada fase nova do redesenho traz uma migração para correr no Supabase.
    // Só falta a tabela quando o Postgres o diz: uma falha de rede (no
    // iPhone, ao voltar à app) não é migração por correr.
    const noFavorites =
      migration.error != null &&
      (migration.error.code === '42P01' ||
        migration.error.code === 'PGRST205' ||
        /favorites/.test(migration.error.message ?? ''))
    const missing = [
      ...(noFavorites || !('pin_mode' in data) ? ['20260928000000_fase1.sql'] : []),
      ...(!('ai_monthly_cap_eur' in data) ? ['20260929000000_fase2.sql'] : []),
      ...(!('has_garmin_watch' in data) ? ['20260930000000_fase3.sql'] : []),
      ...(!('measure_interval_days' in data) ? ['20261001000000_fase4.sql'] : []),
      ...(!('trend_method' in data) ? ['20261003000000_fase6.sql'] : []),
      ...(!('integration_status' in data) ? ['20261004000000_fase7.sql'] : []),
      ...(missingColumn(sleep.error) ? ['20261005000000_sono.sql'] : []),
      ...(missingColumn(water.error) ? ['20261015000000_agua.sql'] : []),
    ]
    if (missing.length) {
      setProfile(data as Profile)
      setMissing(missing)
      setStatus('needs-migration')
      return
    }
    setProfile(data as Profile)
    applyTheme((data as Profile).theme)
    writeScoped(localStorage, CACHE, JSON.stringify(data))
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
      writeScoped(localStorage, CACHE, JSON.stringify({ ...profile, ...patch }))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, offline])

  return (
    <ProfileContext.Provider value={{ profile, status, offline, missingMigrations, reload, update }}>
      {children}
    </ProfileContext.Provider>
  )
}
