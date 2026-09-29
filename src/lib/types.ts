export interface MealItem {
  name: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  food_id: string | null
  estimated: boolean
  confidence?: 'alta' | 'media' | 'baixa'
}

export interface ParsedMealResponse {
  items: MealItem[]
  confidence: number
  questions: string[]
  assumed_portions?: string[]
  is_estimate: boolean
  prompt_version: string
  model: string
  cost_usd: number
}

export interface Profile {
  id: string
  target_weight_kg: number
  base_kcal: number
  protein_g: number
  protein_per_meal_g: number
  kcal_floor_week: number
  expected_tdee: number
  nutrition_day_cutoff_hour: number
  bike_watts_options: number[]
  bike_min_cadence: number
  bike_hr_avg_cap: number
  bike_hr_max_cap: number
  strava_athlete_id: number | null
  timeline: { label: string; when: string }[]
  height_cm: number
  // Migração 1 (Fase 1)
  sex: 'm' | 'f'
  birth_year: number | null
  theme: 'system' | 'dark' | 'light'
  calm_mode: boolean
  pin_mode: 'off' | '12h' | 'always'
  maintenance_enabled: boolean
  maintenance_anchor: string | null
  dismissed_hints: string[]
  nudge_state: Record<string, unknown>
  carbs_ref_g: number | null
  fat_ref_g: number | null
  scale_has_bodyfat: boolean
  // Migração 2 (Fase 2)
  ai_monthly_cap_eur: number
  ai_daily_vision_cap: number
  has_garmin_watch: boolean | null
  console_shows_watts: boolean | null
  measure_interval_days?: number
  thigh_landmark_cm?: number
}

export interface Meal {
  id: string
  date: string
  logged_at: string
  input_type: 'text' | 'photo' | 'barcode' | 'manual' | 'favorite' | 'repeat' | 'quick'
  raw_text: string | null
  photo_path: string | null
  items: MealItem[]
  kcal: number
  protein: number
  carbs: number
  fat: number
  is_estimate: boolean
  favorite_id: string | null
  portion_factor: number
  deleted_at: string | null
  created_at: string
  // Migração 2 (Fase 2)
  client_id: string | null
  photo_paths: string[]
  thumb_paths: string[]
  note: string | null
  analysis_note: string | null
  tags: string[]
  slot: Slot | null
  status: 'a_analisar' | 'por_rever' | 'ok' | 'erro' | 'sem_analise'
  analysis_started_at: string | null
  analysis_attempts: number
  analysis_error: string | null
}

export type Slot = 'pequeno_almoco' | 'almoco' | 'lanche' | 'jantar' | 'ceia'

export interface Favorite {
  id: string
  kind: 'meal' | 'workout'
  name: string
  items: MealItem[]
  kcal: number
  protein: number
  carbs: number
  fat: number
  photo_path: string | null
  default_slot: Slot | null
  source_meal_id: string | null
  use_count: number
  last_used_at: string | null
  archived: boolean
  workout: FavoriteWorkout | null
}

export interface FavoriteWorkout {
  type: 'bike' | 'strength' | 'other'
  minutes: number
  watts?: number | null
  sport?: string | null
  exercises?: { name: string; sets: number; rep_min: number; rep_max: number }[]
}

export interface DayRow {
  date: string
  kcal_in: number
  protein: number
  carbs: number
  fat: number
  kcal_exercise: number
  kcal_target: number
  is_complete: boolean
  flags: string[]
  tdee_est: number | null
  weight_trend: number | null
}

export interface WeeklyReview {
  week_start: string
  text: string
}

export interface Food {
  id: string
  name: string
  default_portion_g: number | null
  kcal_100g: number
  protein_100g: number
  carbs_100g: number
  fat_100g: number
  source: 'user' | 'off' | 'claude'
  barcode: string | null
}

export interface WeightRow {
  date: string
  kg: number
  body_fat_pct?: number | null
  measured_at?: string | null
  created_at?: string
}

export interface Workout {
  id: string
  date: string
  source: 'strava' | 'manual' | 'screenshot' | 'intervals' | 'health' | 'fit'
  strava_id: number | null
  type: 'bike' | 'strength' | 'other'
  minutes: number | null
  watts: number | null
  cadence: number | null
  avg_hr: number | null
  max_hr: number | null
  kcal_est: number | null
  pain_during: number | null
  pain_next_day: number | null
  status: 'green' | 'yellow' | 'red' | null
  planned_session_id: string | null
  raw: { calories?: number; sport?: string } | null
  created_at: string
  deleted_at: string | null
  // Fase 3
  client_id?: string | null
  started_at?: string | null
  sport?: string | null
  name?: string | null
  moving_s?: number | null
  elapsed_s?: number | null
  distance_km?: number | null
  np_w?: number | null
  max_w?: number | null
  max_cadence?: number | null
  kcal_device?: number | null
  kcal_rule?: string | null
  kcal_estimated?: boolean
  watts_source?: 'device' | 'console' | 'manual' | 'favorite' | 'prefill' | null
  training_load?: number | null
  aerobic_te?: number | null
  anaerobic_te?: number | null
  source_paths?: string[]
  image_hashes?: string[]
  merged_from?: unknown[] | null
  note?: string | null
  favorite_id?: string | null
}

export interface WorkoutImport {
  id: string
  client_id: string
  status: 'a_ler' | 'por_confirmar' | 'guardado' | 'descartado' | 'erro'
  source_paths: string[]
  thumb_paths: string[]
  image_hashes: string[]
  parsed: (import('../../api/_lib/schemas').WorkoutShot & { low_fields: string[] }) | null
  edited_fields: string[]
  analysis_started_at: string | null
  analysis_error: string | null
  workout_id: string | null
  created_at: string
}

export interface PlanExercise {
  name: string
  sets: number
  rep_min: number
  rep_max: number
  load_kg: number | null
  notes: string | null
}

export interface PlanBike {
  watts: number
  minutes: number
  cadence_min: number
}

export interface PlannedSession {
  id: string
  block_id: string
  week: number
  day_index: number
  type: 'bike' | 'strength'
  name: string | null
  details: { bike: PlanBike | null; exercises: PlanExercise[]; notes: string | null }
  status: 'planned' | 'done' | 'skipped' | 'swapped'
  workout_id: string | null
}

export interface PlanBlock {
  id: string
  chapter_id: string | null
  start_date: string
  weeks: number
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  plan: {
    mission: { title: string; numbers: string[] }
    weeks: { week: number; focus: string | null }[]
    rationale: string
  } | null
}

export interface ExerciseLogRow {
  workout_id: string
  exercise: string
  set_index: number
  reps: number | null
  load_kg: number | null
  rpe: number | null
  created_at: string
}

export interface Chapter {
  id: string
  order_index: number
  title: string
  patron: string
  sport: string
  jersey_number: number | null
  poster_stat: string | null
  facts: string[]
  theme: string | null
  honest_note: string | null
  photo_path: string | null
  photo_credit: string | null
}

export interface CatalogExercise {
  id: string
  name: string
  pattern: string
  knee_safe: boolean
  rep_min: number | null
  rep_max: number | null
  notes: string | null
}

export interface BodyMeasurement {
  id: string
  date: string
  measured_at: string
  method: 'tape'
  neck_cm: number | null
  waist_cm: number | null
  chest_cm: number | null
  hips_cm: number | null
  arm_cm: number | null
  thigh_cm: number | null
  calf_cm: number | null
  readings: Record<string, number[]> | null
  weight_used_kg: number
  fasted: boolean
  flags: string[]
  note: string | null
  created_at: string
}
