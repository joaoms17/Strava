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
  nutrition_day_cutoff_hour: number
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
  kcal_exercise: number
  kcal_target: number
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
