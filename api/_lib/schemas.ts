import { z } from 'zod'

// Item de refeição (gravar, editar, anular): macros em valores absolutos
// para os gramas do item, não por 100 g.
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

// Análise em segundo plano (Fase 2): confiança por item e referências curtas
// aos alimentos pessoais (a1…a40) em vez de UUIDs.
export const Confidence = z.enum(['alta', 'media', 'baixa'])

export const AnalysedItemSchema = z.object({
  name: z.string(),
  grams: z.number(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  confidence: Confidence,
  food_ref: z.string().nullable(),
})

export const MealAnalysisSchema = z.object({
  title: z.string(),
  items: z.array(AnalysedItemSchema),
  meal_confidence: Confidence,
})

export type MealAnalysis = z.infer<typeof MealAnalysisSchema>

// A primeira análise das fotos (meal-photo v3) devolve também o pedido de
// entrega, quando uma das imagens é a captura do resumo (Glovo, Uber Eats,
// Bolt Food, um talão): a app, o restaurante e quantas pessoas serve. Só
// aqui: o texto, o «Juntar foto» e as correções continuam com o schema de cima.
export const OrderSchema = z.object({
  app: z.string().nullable(),
  restaurant: z.string().nullable(),
  people: z.number().int().nullable(),
})

export const MealPhotoAnalysisSchema = MealAnalysisSchema.extend({
  order: OrderSchema.nullable(),
})

export type MealPhotoAnalysis = z.infer<typeof MealPhotoAnalysisSchema>

// «Sobrou comida?»: a parte comida de cada item (0 a 1, por índice), se a
// foto do depois é o mesmo prato e se ficou vazio. Sem limites no schema (os
// structured outputs não os aceitam): a fração arruma-se em rules/sobras.ts.
export const LeftoversAnswerSchema = z.object({
  same_plate: z.boolean(),
  reason: z.string().nullable(),
  empty_plate: z.boolean(),
  items: z.array(
    z.object({
      index: z.number().int(),
      name: z.string(),
      eaten: z.number(),
      confidence: Confidence,
    }),
  ),
})

// Item de refeição vindo do telemóvel (edições, correções, anular).
export const MealItemInputSchema = ParsedItemSchema.extend({
  confidence: Confidence.optional(),
})

// Corpo do POST /api/meal/save — validado no servidor antes de gravar.
export const SaveMealSchema = z.object({
  // Repetir o mesmo envio (rede caiu depois de o servidor gravar) devolve o que já existe.
  client_id: z.string().uuid().optional(),
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
  // A refeição escolhida (a hora pode ter sido puxada para agora).
  slot: z.enum(['pequeno_almoco', 'almoco', 'lanche', 'jantar', 'ceia']).optional(),
})

// ---------------------------------------------------------------------
// Leitura dos prints de treino (Fase 3). Sem mapas abertos nem limites
// numéricos: os structured outputs não os aceitam; o servidor verifica
// os intervalos depois (rules/treino.ts).
// ---------------------------------------------------------------------
export const SHOT_FIELDS = [
  'sport',
  'date',
  'start_time',
  'total_time_s',
  'moving_time_s',
  'distance_km',
  'avg_hr',
  'max_hr',
  'avg_power_w',
  'max_power_w',
  'np_w',
  'avg_cadence',
  'max_cadence',
  'calories_device',
  'training_load',
] as const

const n = () => z.number().nullable()

export const WorkoutShotSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int(),
      app: z.enum(['garmin_connect', 'strava', 'bike_console', 'apple_fitness', 'other', 'not_workout']),
      screen: z.enum(['summary', 'stats', 'laps', 'zones', 'sets', 'charts', 'share_card', 'console', 'other']),
      date_shown: z.string().nullable(),
    }),
  ),
  same_activity: z.boolean(),
  mismatch_reason: z.string().nullable(),
  activity: z.object({
    sport: z.enum(['indoor_bike', 'outdoor_bike', 'strength', 'walk', 'run', 'elliptical', 'swim', 'other']),
    sport_label_raw: z.string().nullable(),
    title: z.string().nullable(),
    date: z.string().nullable(),
    start_time: z.string().nullable(),
    total_time_s: n(),
    moving_time_s: n(),
    distance_km: n(),
    avg_hr: n(),
    max_hr: n(),
    avg_power_w: n(),
    max_power_w: n(),
    np_w: n(),
    avg_cadence: n(),
    max_cadence: n(),
    calories_device: n(),
    elevation_gain_m: n(),
    aerobic_te: n(),
    anaerobic_te: n(),
    training_load: n(),
    training_load_kind: z.enum(['garmin_exercise_load', 'strava_relative_effort', 'tss', 'other']).nullable(),
    rpe: n(),
    hr_zones: z.array(z.object({ zone: z.number().int(), seconds: z.number() })),
    laps: z.array(
      z.object({
        n: z.number().int(),
        time_s: n(),
        avg_hr: n(),
        avg_power_w: n(),
        avg_cadence: n(),
      }),
    ),
    strength_sets: z.array(
      z.object({ exercise_raw: z.string(), reps: n(), weight_kg: n() }),
    ),
  }),
  field_confidence: z.array(
    z.object({
      field: z.enum(SHOT_FIELDS),
      confidence: z.enum(['alta', 'media', 'baixa']),
      image_index: z.number().int().nullable(),
    }),
  ),
  notes: z.string().nullable(),
})

export type WorkoutShot = z.infer<typeof WorkoutShotSchema>

// O que se pede à IA desde o workout-shot.v2 (T18): sem as voltas, o efeito
// anaeróbio, a potência normalizada, a potência máxima e a cadência máxima —
// eram lidos e nunca mostrados. As leituras guardadas continuam com a forma
// completa (`WorkoutShot`): `fullShot` põe esses campos vazios.
const SHOT_AI_OMIT = { np_w: true, max_power_w: true, max_cadence: true, anaerobic_te: true, laps: true } as const
export const SHOT_AI_FIELDS = SHOT_FIELDS.filter((f) => f !== 'np_w' && f !== 'max_cadence')
export const WorkoutShotAiSchema = WorkoutShotSchema.extend({
  activity: WorkoutShotSchema.shape.activity.omit(SHOT_AI_OMIT),
  field_confidence: z.array(
    z.object({
      field: z.enum(SHOT_AI_FIELDS as [string, ...string[]]),
      confidence: z.enum(['alta', 'media', 'baixa']),
      image_index: z.number().int().nullable(),
    }),
  ),
})
export type WorkoutShotAi = z.infer<typeof WorkoutShotAiSchema>

export function fullShot(shot: WorkoutShotAi): WorkoutShot {
  return {
    ...shot,
    activity: { ...shot.activity, np_w: null, max_power_w: null, max_cadence: null, anaerobic_te: null, laps: [] },
    field_confidence: shot.field_confidence as WorkoutShot['field_confidence'],
  }
}
