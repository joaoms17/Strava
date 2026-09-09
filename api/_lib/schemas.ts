import { z } from 'zod'

// JSON estrito devolvido pelo Claude nos parses de refeição.
// Macros em valores absolutos para os gramas do item, não por 100 g.
export const ParsedItemSchema = z.object({
  name: z.string(),
  grams: z.number(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  food_id: z.string().nullable(),
  estimated: z.boolean(),
})

export const ParsedMealSchema = z.object({
  items: z.array(ParsedItemSchema),
  confidence: z.number(),
  questions: z.array(z.string()),
})

export const ParsedPhotoMealSchema = z.object({
  items: z.array(ParsedItemSchema),
  confidence: z.number(),
  questions: z.array(z.string()),
  assumed_portions: z.array(z.string()),
})

export type ParsedItem = z.infer<typeof ParsedItemSchema>
export type ParsedMeal = z.infer<typeof ParsedMealSchema>
export type ParsedPhotoMeal = z.infer<typeof ParsedPhotoMealSchema>

// Corpo do POST /api/meal/save — validado no servidor antes de gravar.
export const SaveMealSchema = z.object({
  input_type: z.enum(['text', 'photo', 'barcode', 'manual']),
  raw_text: z.string().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  items: z.array(ParsedItemSchema).min(1),
  is_estimate: z.boolean(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  prompt_version: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  cost_usd: z.number().nullable().optional(),
  // Usado pela fila offline: a refeição conta para o dia em que foi comida.
  logged_at: z.string().nullable().optional(),
})

export type SaveMealBody = z.infer<typeof SaveMealSchema>

// Bloco de 4 semanas devolvido pelo Claude em /api/plan/generate.
// Restrições finas (day_index 0-6, 4 semanas, exercícios do catálogo,
// deload na semana 4) validam-se à parte em validatePlan.
export const PlanExerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int(),
  rep_min: z.number().int(),
  rep_max: z.number().int(),
  load_kg: z.number().nullable(),
  notes: z.string().nullable(),
})

export const PlanSessionSchema = z.object({
  day_index: z.number().int(), // 0 = segunda
  type: z.enum(['bike', 'strength']),
  name: z.string(),
  bike: z
    .object({
      watts: z.number().int(),
      minutes: z.number().int(),
      cadence_min: z.number().int(),
    })
    .nullable(),
  exercises: z.array(PlanExerciseSchema),
  notes: z.string().nullable(),
})

export const PlanWeekSchema = z.object({
  week: z.number().int(),
  focus: z.string().nullable(),
  sessions: z.array(PlanSessionSchema),
})

export const GeneratedPlanSchema = z.object({
  mission: z.object({
    title: z.string(),
    numbers: z.array(z.string()),
  }),
  weeks: z.array(PlanWeekSchema),
  rationale: z.string(),
})

export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>
export type PlanSession = z.infer<typeof PlanSessionSchema>

export function validatePlan(plan: GeneratedPlan, catalogNames: string[]): string[] {
  const errors: string[] = []
  const allowed = new Set(catalogNames.map((n) => n.toLowerCase()))

  if (plan.weeks.length !== 4) errors.push(`O bloco tem de ter 4 semanas (vieram ${plan.weeks.length}).`)
  plan.weeks.forEach((week, i) => {
    if (week.week !== i + 1) errors.push(`weeks[${i}].week devia ser ${i + 1}.`)
    if (week.sessions.length === 0) errors.push(`A semana ${i + 1} não tem sessões.`)
    for (const s of week.sessions) {
      if (s.day_index < 0 || s.day_index > 6)
        errors.push(`day_index ${s.day_index} inválido na semana ${week.week}.`)
      if (s.type === 'bike' && !s.bike)
        errors.push(`Sessão de bike sem alvo (semana ${week.week}, dia ${s.day_index}).`)
      if (s.type === 'strength' && s.exercises.length === 0)
        errors.push(`Sessão de força sem exercícios (semana ${week.week}, dia ${s.day_index}).`)
      for (const e of s.exercises) {
        if (!allowed.has(e.name.toLowerCase()))
          errors.push(`Exercício fora do catálogo: "${e.name}".`)
        if (e.sets < 1 || e.sets > 8) errors.push(`Séries inválidas em "${e.name}": ${e.sets}.`)
        if (e.rep_min > e.rep_max) errors.push(`rep_min > rep_max em "${e.name}".`)
      }
    }
  })

  // Deload: o volume de força da semana 4 tem de ficar bem abaixo da semana 3.
  const volume = (week: (typeof plan.weeks)[number]) =>
    week.sessions.flatMap((s) => s.exercises).reduce((acc, e) => acc + e.sets, 0)
  const week3 = plan.weeks[2]
  const week4 = plan.weeks[3]
  if (week3 && week4) {
    const v3 = volume(week3)
    const v4 = volume(week4)
    if (v3 > 0 && v4 > v3 * 0.7)
      errors.push(`A semana 4 é deload (-40% de volume): ${v4} séries vs ${v3} na semana 3.`)
  }
  return errors
}
