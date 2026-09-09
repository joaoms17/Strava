import fs from 'node:fs'
import path from 'node:path'

export const PROMPT_MEAL_TEXT = 'meal-parse-text.v1.md'
export const PROMPT_MEAL_PHOTO = 'meal-parse-photo.v1.md'
export const PROMPT_PLAN = 'plan-generate.v1.md'
export const PROMPT_REVIEW = 'weekly-review.v1.md'

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

// A versão vem do nome do ficheiro (ex.: meal-parse-text.v1.md -> v1)
export function promptVersion(filename: string): string {
  return filename.replace(/\.md$/, '')
}
