import type { Workout } from './types'

// As colunas que o separador Treino e o «Qual foi?» usam (P5). Antes era
// `select('*')`, com os JSON em bruto (`raw` com a resposta inteira do
// relógio, `laps`) para usar ~20 colunas. Do `raw` só vêm as 5 chaves que as
// regras leem; `fromListRow` volta a pô-las num `raw` pequeno.
// Nenhuma destas colunas sai na limpeza (20261113000050).
export const WORKOUT_LIST_COLUMNS = [
  'id',
  'date',
  'source',
  'type',
  'minutes',
  'watts',
  'cadence',
  'avg_hr',
  'max_hr',
  'kcal_est',
  'pain_during',
  'pain_next_day',
  'status',
  'created_at',
  'deleted_at',
  'client_id',
  'started_at',
  'sport',
  'name',
  'moving_s',
  'elapsed_s',
  'distance_km',
  'np_w',
  'max_w',
  'max_cadence',
  'kcal_device',
  'kcal_rule',
  'kcal_estimated',
  'watts_source',
  'training_load',
  'aerobic_te',
  'anaerobic_te',
  'rpe',
  'hr_zones',
  'merged_from',
  'note',
  'favorite_id',
  'raw_sport:raw->>sport',
  'raw_calories:raw->calories',
  'raw_hora_estimada:raw->hora_estimada',
  'raw_qual_foi:raw->qual_foi',
  'raw_outro_treino:raw->outro_treino',
].join(',')

// Uma página de «Ver treinos mais antigos».
export const OLDER_PAGE = 100

type ListRow = Omit<Workout, 'raw'> & {
  raw_sport?: string | null
  raw_calories?: unknown
  raw_hora_estimada?: unknown
  raw_qual_foi?: unknown
  raw_outro_treino?: unknown
}

export function fromListRow(row: Record<string, unknown>): Workout {
  const { raw_sport, raw_calories, raw_hora_estimada, raw_qual_foi, raw_outro_treino, ...rest } = row as ListRow
  const raw: Record<string, unknown> = {}
  if (raw_sport != null) raw.sport = raw_sport
  if (typeof raw_calories === 'number') raw.calories = raw_calories
  if (raw_hora_estimada === true) raw.hora_estimada = true
  if (raw_qual_foi === true) raw.qual_foi = true
  if (raw_outro_treino === true || raw_outro_treino === false) raw.outro_treino = raw_outro_treino
  return { ...rest, raw: Object.keys(raw).length > 0 ? (raw as Workout['raw']) : null } as Workout
}

export const fromListRows = (rows: unknown[] | null | undefined): Workout[] =>
  (rows ?? []).map((r) => fromListRow(r as Record<string, unknown>))
