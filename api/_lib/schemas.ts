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
})

export type SaveMealBody = z.infer<typeof SaveMealSchema>
