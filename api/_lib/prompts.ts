import fs from 'node:fs'
import path from 'node:path'

export const PROMPT_PLAN = 'plan-generate.v1.md'
export const PROMPT_REVIEW = 'weekly-review.v1.md'
export const PROMPT_REVIEW_NEUTRAL = 'weekly-review.v5.md'
export const PROMPT_MEAL_PHOTO_V3 = 'meal-photo.v3.md'
export const PROMPT_MEAL_TEXT_V2 = 'meal-text.v2.md'
export const PROMPT_MEAL_CORRECT = 'meal-correct.v1.md'
export const PROMPT_MEAL_PHOTO_ADD = 'meal-photo-add.v2.md'
export const PROMPT_MEAL_LEFTOVERS = 'meal-leftovers.v1.md'
export const PROMPT_LABEL_READ = 'label-read.v1.md'
export const PROMPT_RECIPE = 'recipe.v1.md'
export const PROMPT_WORKOUT_SHOT = 'workout-shot.v1.md'
export const PROMPT_TRAINING_WEEK = 'training-week.v1.md'
export const PROMPT_EVOLUTION = 'evolution.v4.md'
export const PROMPT_WORKOUT_SAID = 'workout-said.v2.md'
export const PROMPT_MENU_PICK = 'menu-pick.v1.md'
export const PROMPT_ASK = 'ask.v2.md'

export function readPrompt(filename: string): string {
  const candidates = [
    path.join(process.cwd(), 'prompts', filename),
    path.join(process.cwd(), '..', 'prompts', filename),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8')
  }
  throw new Error(`Prompt não encontrado: ${filename}`)
}

// A versão vem do nome do ficheiro (ex.: meal-text.v2.md -> meal-text.v2)
export function promptVersion(filename: string): string {
  return filename.replace(/\.md$/, '')
}
