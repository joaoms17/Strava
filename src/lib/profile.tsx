import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { applyTheme } from './theme'
import type { Profile } from './types'

// O perfil carrega uma vez e fica disponível para todos os ecrãs.
type Status = 'loading' | 'ready' | 'no-profile' | 'needs-migration' | 'error'

interface ProfileState {
  profile: Profile | null
  status: Status
  missingMigrations: string[]
  reload: () => Promise<void>
  update: (patch: Partial<Profile>) => Promise<boolean>
}

const ProfileContext = createContext<ProfileState>({
  profile: null,
  status: 'loading',
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

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [missingMigrations, setMissing] = useState<string[]>([])

  const reload = useCallback(async () => {
    const [{ data, error }, migration] = await Promise.all([
      supabase.from('profile').select('*').maybeSingle(),
      supabase.from('favorites').select('id', { count: 'exact', head: true }),
    ])
    if (error) {
      setStatus('error')
      return
    }
    if (!data) {
      setStatus('no-profile')
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
    ]
    if (missing.length) {
      setProfile(data as Profile)
      setMissing(missing)
      setStatus('needs-migration')
      return
    }
    setProfile(data as Profile)
    applyTheme((data as Profile).theme)
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
      return true
    },
    [profile],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <ProfileContext.Provider value={{ profile, status, missingMigrations, reload, update }}>
      {children}
    </ProfileContext.Provider>
  )
}
