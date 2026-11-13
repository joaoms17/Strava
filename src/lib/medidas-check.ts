// B6: o que pede um toque de confirmação antes de gravar uma medição (como a
// pesagem): uma zona fora dos limites, a cintura igual ou menor do que o
// pescoço (trocados?), a %G fora de 5–45 % e um peso escrito muito longe da
// última pesagem. Puro: sem supabase.
import { checkZone, type Zone } from '../../api/_lib/rules/composicao'
import { checkWeighing } from '../../api/_lib/rules/weight'

export const PCT_MIN = 5
export const PCT_MAX = 45

const dec1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '')

export function oddMeasurement(input: {
  zones: Partial<Record<Zone, number | null>>
  pct: number | null
  typedKg?: number | null // o peso escrito (sem pesagem nos 7 dias)
  lastKg?: number | null // a última pesagem conhecida
}): string[] {
  const out: string[] = []
  for (const [zone, cm] of Object.entries(input.zones) as [Zone, number | null][]) {
    if (cm == null) continue
    const warning = checkZone(zone, cm)
    if (warning) out.push(warning.replace(/ Confirma\.$/, ''))
  }
  const neck = input.zones.neck
  const waist = input.zones.waist
  if (neck != null && waist != null && waist <= neck) {
    out.push(`A cintura (${dec1(waist)} cm) não chega ao pescoço (${dec1(neck)} cm): trocaste os dois?`)
  }
  if (input.pct != null && (input.pct < PCT_MIN || input.pct > PCT_MAX)) {
    out.push(`A gordura estimada fica em ${dec1(input.pct)} %, fora do habitual (${PCT_MIN}–${PCT_MAX} %).`)
  }
  if (input.typedKg != null && checkWeighing(input.typedKg, input.lastKg ?? null).kind !== 'ok') {
    out.push(`${dec1(input.typedKg)} kg está longe da última pesagem (${dec1(input.lastKg!)} kg).`)
  }
  return out
}
