export interface MealItem {
  name: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  food_id: string | null
  estimated: boolean
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
}

export interface Meal {
  id: string
  date: string
  logged_at: string
  input_type: 'text' | 'photo' | 'barcode' | 'manual'
  raw_text: string | null
  items: MealItem[]
  kcal: number
  protein: number
  carbs: number
  fat: number
  is_estimate: boolean
}

export interface DayRow {
  date: string
  kcal_in: number
  kcal_exercise: number
  kcal_target: number
  is_complete: boolean
  flags: string[]
  tdee_est: number | null
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
}

export interface Workout {
  id: string
  date: string
  source: 'strava' | 'manual'
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
  raw: { calories?: number } | null
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
