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
  nutrition_day_cutoff_hour: number
  bike_watts_options: number[]
  bike_min_cadence: number
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
  raw: { calories?: number } | null
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
}
