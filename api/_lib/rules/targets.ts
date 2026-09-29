// Regra 2: kcal_target(dia) = base_kcal + kcal_exercise(dia).
// kcal_exercise: bike = watts x minutos x 0,06; força = 150 por sessão >= 30 min;
// outros = calorias do dispositivo x 0,7 ou, sem elas, METs líquidos x peso x horas.
// Nunca usar kcal do relógio para bike ou força.

export type WorkoutType = 'bike' | 'strength' | 'other'

// Desportos além da bicicleta e do ginásio (ordem dos botões).
export const OTHER_SPORTS = [
  'corrida',
  'caminhada',
  'eliptica',
  'natacao',
  'remo',
  'futebol',
  'padel',
  'tenis',
  'aula',
  'yoga',
  'pilates',
  'outro',
] as const
export type OtherSport = (typeof OTHER_SPORTS)[number]

export const SPORT_LABEL: Record<OtherSport, string> = {
  corrida: 'Corrida',
  caminhada: 'Caminhada',
  eliptica: 'Elíptica',
  natacao: 'Natação',
  remo: 'Remo',
  futebol: 'Futebol',
  padel: 'Padel',
  tenis: 'Ténis',
  aula: 'Aula (HIIT, cycling…)',
  yoga: 'Yoga',
  pilates: 'Pilates',
  outro: 'Outro',
}

export function isOtherSport(value: unknown): value is OtherSport {
  return typeof value === 'string' && (OTHER_SPORTS as readonly string[]).includes(value)
}

// METs líquidos (acima do repouso, intensidade moderada, Compêndio de
// Atividades Físicas − 1): o gasto em repouso já está no gasto medido.
export const NET_METS: Record<OtherSport, number> = {
  corrida: 7.5,
  caminhada: 2.5,
  eliptica: 4,
  natacao: 5,
  remo: 5,
  futebol: 6,
  padel: 5,
  tenis: 6,
  aula: 5,
  yoga: 1.5,
  pilates: 2,
  outro: 3,
}

export interface WorkoutForKcal {
  type: WorkoutType
  minutes: number | null
  watts: number | null
  deviceCalories: number | null
  sport?: OtherSport | null
  weightKg?: number | null
}

export function workoutKcal(w: WorkoutForKcal): number {
  switch (w.type) {
    case 'bike':
      if (w.watts == null || w.minutes == null) return 0
      return Math.round(w.watts * w.minutes * 0.06)
    case 'strength':
      return (w.minutes ?? 0) >= 30 ? 150 : 0
    case 'other':
      if (w.deviceCalories != null) return Math.round(w.deviceCalories * 0.7)
      if (w.weightKg == null || w.minutes == null) return 0
      return Math.round(NET_METS[isOtherSport(w.sport) ? w.sport : 'outro'] * w.weightKg * (w.minutes / 60))
  }
}

export function dayExerciseKcal(workouts: WorkoutForKcal[]): number {
  return workouts.reduce((acc, w) => acc + workoutKcal(w), 0)
}

// Um treino guarda as kcal calculadas ao gravar; somam-se essas, para que
// mudanças futuras na regra nunca reescrevam dias passados.
export function storedExerciseKcal(
  workouts: (WorkoutForKcal & { kcal_est: number | null })[],
): number {
  return workouts.reduce((acc, w) => acc + (w.kcal_est ?? workoutKcal(w)), 0)
}

export function kcalTarget(baseKcal: number, exerciseKcal: number): number {
  return baseKcal + exerciseKcal
}

// Regra 8: >= protein_per_meal_g por refeição principal.
export function proteinMealOk(proteinG: number, perMealTargetG: number): boolean {
  return proteinG >= perMealTargetG
}
