import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { applyTheme } from './theme'
import type { Profile } from './types'

// O perfil carrega uma vez e fica disponível para todos os ecrãs.
type Status = 'loading' | 'ready' | 'no-profile' | 'needs-migration' | 'error'

interface ProfileState {
  profile: Profile | null
  status: Status
  reload: () => Promise<void>
  update: (patch: Partial<Profile>) => Promise<boolean>
}

const ProfileContext = createContext<ProfileState>({
  profile: null,
  status: 'loading',
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
    if (migration.error || !('pin_mode' in data)) {
      setProfile(data as Profile)
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
    <ProfileContext.Provider value={{ profile, status, reload, update }}>
      {children}
    </ProfileContext.Provider>
  )
}
