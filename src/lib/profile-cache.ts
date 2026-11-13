import type { Profile } from './types'

// Colunas do perfil que a app deixou de ler (L12 e os marcadores antigos do
// L13); a migração 20261113000050_limpeza.sql apaga-as. Um perfil guardado
// no telemóvel antes da limpeza ainda as traz: ficam de fora ao ler e ao
// gravar a cópia, para nada voltar a depender delas.
export const DEAD_PROFILE_COLUMNS = [
  'equipment',
  'constraints',
  'strava_athlete_id',
  'carbs_ref_g',
  'fat_ref_g',
  'body_comp_source',
  'trend_method',
  'trend_method_since',
  'bike_min_cadence',
  'console_shows_watts',
  'pin_mode',
] as const

function withoutDeadColumns(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }
  for (const column of DEAD_PROFILE_COLUMNS) delete copy[column]
  return copy
}

// O perfil lido da base de dados, sem as colunas mortas (antes da limpeza).
export function cleanProfile(row: Record<string, unknown>): Profile {
  return withoutDeadColumns(row) as unknown as Profile
}

// O perfil guardado no telemóvel, lido com tolerância: texto estragado, um
// valor que não é um perfil ou colunas que já não existem não partem a app
// (sem perfil válido, null: a app pede-o à base de dados).
export function profileFromCache(text: string | null | undefined): Profile | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) return null
    return withoutDeadColumns(record) as unknown as Profile
  } catch {
    return null
  }
}

// O texto a guardar no telemóvel (sem as colunas mortas).
export function profileToCache(profile: Profile | Record<string, unknown>): string {
  return JSON.stringify(withoutDeadColumns(profile as Record<string, unknown>))
}
