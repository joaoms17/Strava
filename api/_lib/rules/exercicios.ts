// Catálogo de exercícios de ginásio que vem com a app, por grupo muscular.
// Junta-se aos do exercise_catalog (os do João mandam: nome igual → o dele).
// knee_safe = false: força o joelho (artrose) — aparece com aviso, nunca
// escondido. Os de tempo levam «(segundos)» no nome: as repetições são os
// segundos. Sem imports: o telemóvel usa este ficheiro diretamente.

export const EXERCISE_GROUPS = ['Peito', 'Costas', 'Ombros', 'Braços', 'Pernas e glúteos', 'Core', 'Outros'] as const
export type ExerciseGroup = (typeof EXERCISE_GROUPS)[number]

export interface CatalogExerciseDef {
  name: string
  group: ExerciseGroup
  knee_safe: boolean
}

const g = (group: ExerciseGroup, knee_safe: boolean, names: string[]): CatalogExerciseDef[] =>
  names.map((name) => ({ name, group, knee_safe }))

export const DEFAULT_EXERCISES: CatalogExerciseDef[] = [
  ...g('Peito', true, [
    'Supino plano com barra',
    'Supino plano com halteres',
    'Supino no banco com halteres',
    'Supino inclinado com barra',
    'Supino inclinado com halteres',
    'Supino declinado',
    'Supino na máquina',
    'Supino inclinado na máquina',
    'Aberturas com halteres',
    'Aberturas inclinadas com halteres',
    'Crossover na polia',
    'Peck deck (máquina de aberturas)',
    'Flexões',
    'Flexões inclinadas',
    'Paralelas (dips)',
  ]),
  ...g('Costas', true, [
    'Puxada à frente',
    'Puxada com pega estreita',
    'Puxada com braços esticados na polia',
    'Elevações (pull-ups)',
    'Elevações assistidas',
    'Remada sentada na polia',
    'Remada com barra',
    'Remada com halteres',
    'Remada em T',
    'Remada na máquina',
    'Remada invertida',
    'Pullover com halter',
    'Hiperextensões (lombar)',
    'Encolhimentos (trapézio)',
  ]),
  ...g('Ombros', true, [
    'Press militar com barra',
    'Press de ombros com halteres',
    'Press de ombros na máquina',
    'Arnold press',
    'Elevações laterais',
    'Elevações laterais na polia',
    'Elevações frontais',
    'Aberturas invertidas (deltoide posterior)',
    'Peck deck invertido',
    'Face pull',
    'Remada alta',
  ]),
  ...g('Braços', true, [
    'Curl de bíceps',
    'Curl com barra',
    'Curl com barra EZ',
    'Curl martelo',
    'Curl na polia',
    'Curl concentrado',
    'Curl no banco Scott',
    'Curl inclinado com halteres',
    'Extensão de tríceps',
    'Tríceps na polia (corda)',
    'Tríceps na polia (barra)',
    'Tríceps francês',
    'Extensão de tríceps acima da cabeça',
    'Fundos no banco',
    'Supino pega fechada',
    'Kickback de tríceps',
    'Curl de pulso',
  ]),
  ...g('Pernas e glúteos', true, [
    'Leg press (amplitude curta)',
    'Agachamento para caixa alta',
    'Step-up baixo',
    'Extensão terminal do joelho com banda',
    'Curl de pernas deitado',
    'Curl de pernas sentado',
    'RDL com halteres',
    'Peso morto romeno com barra',
    'Peso morto convencional',
    'Peso morto com trap bar',
    'Good morning',
    'Hip thrust',
    'Hip thrust com barra',
    'Glute bridge',
    'Glute bridge com uma perna',
    'Kickback de glúteo na polia',
    'Abdução de anca com banda',
    'Abdutores na máquina',
    'Adutores na máquina',
    'Calf raise',
    'Gémeos em pé na máquina',
    'Gémeos sentado',
    'Isométrico de parede parcial (segundos)',
  ]),
  ...g('Pernas e glúteos', false, [
    'Agachamento com barra',
    'Agachamento goblet',
    'Agachamento frontal',
    'Agachamento búlgaro',
    'Agachamento profundo com carga',
    'Hack squat',
    'Leg press (amplitude completa)',
    'Extensão de pernas (máquina)',
    'Afundos',
    'Afundos profundos',
    'Afundos a andar',
    'Step-up alto',
    'Saltos',
    'Saltos para a caixa',
  ]),
  ...g('Core', true, [
    'Prancha (segundos)',
    'Prancha lateral (segundos)',
    'Dead bug',
    'Bird dog',
    'Pallof press com banda',
    'Abdominais (crunch)',
    'Crunch na polia',
    'Elevação de pernas deitado',
    'Elevação de pernas suspenso',
    'Russian twist',
    'Roda abdominal',
    'Hollow hold (segundos)',
    'Farmer walk (segundos)',
  ]),
  ...g('Outros', true, ['Kettlebell swing', 'Battle ropes (segundos)', 'Remo na máquina (segundos)', 'Sled push (segundos)']),
  ...g('Outros', false, ['Burpees', 'Corrida']),
]

// O padrão guardado no exercise_catalog → grupo muscular.
const PATTERN_GROUP: Record<string, ExerciseGroup> = {
  'empurrar-horizontal': 'Peito',
  'puxar-horizontal': 'Costas',
  'puxar-vertical': 'Costas',
  'empurrar-vertical': 'Ombros',
  'isolamento-ombro': 'Ombros',
  'isolamento-biceps': 'Braços',
  'isolamento-triceps': 'Braços',
  hinge: 'Pernas e glúteos',
  bridge: 'Pernas e glúteos',
  step: 'Pernas e glúteos',
  'isolamento-joelho': 'Pernas e glúteos',
  isometrico: 'Pernas e glúteos',
  abducao: 'Pernas e glúteos',
  gemeos: 'Pernas e glúteos',
  pernas: 'Pernas e glúteos',
  agachamento: 'Pernas e glúteos',
  afundo: 'Pernas e glúteos',
  pliometria: 'Outros',
  corrida: 'Outros',
  core: 'Core',
}

export function groupOfPattern(pattern: string | null | undefined): ExerciseGroup {
  return (pattern && PATTERN_GROUP[pattern]) || 'Outros'
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Catálogo completo para escolher: o da app mais os do João (os dele
// mandam quando o nome coincide, incluindo o aviso do joelho).
export function mergeCatalog(
  own: { name: string; pattern: string | null; knee_safe: boolean }[],
): CatalogExerciseDef[] {
  const byName = new Map<string, CatalogExerciseDef>()
  for (const d of DEFAULT_EXERCISES) byName.set(fold(d.name), d)
  for (const o of own) {
    if (o.pattern === 'bike') continue
    const key = fold(o.name)
    const base = byName.get(key)
    byName.set(key, {
      name: o.name,
      group: base && groupOfPattern(o.pattern) === 'Outros' ? base.group : groupOfPattern(o.pattern),
      knee_safe: o.knee_safe,
    })
  }
  return [...byName.values()]
}

export function searchExercises(catalog: CatalogExerciseDef[], query: string, group: ExerciseGroup | null): CatalogExerciseDef[] {
  const q = fold(query)
  return catalog
    .filter((c) => (!group || c.group === group) && (!q || fold(c.name).includes(q)))
    .sort((a, b) => Number(b.knee_safe) - Number(a.knee_safe) || a.name.localeCompare(b.name, 'pt'))
}

export function sameExercise(a: string, b: string): boolean {
  return fold(a) === fold(b)
}

// Ao criar um exercício com um grupo escolhido, o padrão que o representa.
export function patternOfGroup(group: ExerciseGroup | null): string {
  switch (group) {
    case 'Peito':
      return 'empurrar-horizontal'
    case 'Costas':
      return 'puxar-horizontal'
    case 'Ombros':
      return 'empurrar-vertical'
    case 'Braços':
      return 'isolamento-biceps'
    case 'Pernas e glúteos':
      return 'pernas'
    case 'Core':
      return 'core'
    default:
      return 'outro'
  }
}
