// Várias pessoas na mesma app (cada uma com a sua conta e os seus dados):
// os alvos de partida de um perfil novo e os nomes no separador. Sem imports
// de servidor: o telemóvel usa este ficheiro diretamente.
import { PLAN_DEFICIT_KCAL, mifflinBase } from './gasto.js'

export const MAX_PEOPLE = 4

export interface NewPerson {
  sex: 'm' | 'f'
  heightCm: number
  birthYear: number | null
  weightKg: number | null
  targetWeightKg: number
}

export interface StartingTargets {
  base_kcal: number
  protein_g: number
  protein_per_meal_g: number
  kcal_floor_week: number
  expected_tdee: number
}

const round = (n: number, step: number) => Math.round(n / step) * step

// Ponto de partida (muda-se depois nas Definições): gasto pela fórmula
// (Mifflin × 1,2) menos o défice do plano, nunca abaixo de 1 200 (mulher) ou
// 1 500 (homem); proteína 1,8 g por kg do peso alvo.
export function startingTargets(person: NewPerson, year: number): StartingTargets {
  const age = person.birthYear ? Math.min(90, Math.max(16, year - person.birthYear)) : 35
  const weightKg = person.weightKg ?? person.targetWeightKg
  const tdee = mifflinBase({ weightKg, heightCm: person.heightCm, age, sex: person.sex })
  const floor = person.sex === 'f' ? 1200 : 1500
  const base = Math.max(floor, round(tdee - PLAN_DEFICIT_KCAL, 50))
  const protein = Math.min(220, Math.max(60, round(1.8 * person.targetWeightKg, 5)))
  return {
    base_kcal: base,
    protein_g: protein,
    protein_per_meal_g: Math.max(20, round(protein / 4, 5)),
    kcal_floor_week: base - 100,
    expected_tdee: round(tdee, 10),
  }
}

// O nome no separador: o que a pessoa escolheu, senão o início do email.
export function personName(name: unknown, email: string | null | undefined): string {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 30) : ''
  if (clean) return clean
  const local = (email ?? '').split('@')[0]?.split(/[._+-]/)[0] ?? ''
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Eu'
}

export function initialOf(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase()
}
