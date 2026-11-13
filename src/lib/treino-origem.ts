// De onde veio um treino, para o histórico do Treino (T21). Antes, qualquer
// junção (`merged_from`) dizia «print»: uma «Bicicleta habitual» junta ao
// relógio aparecia como print. Agora: a origem do registo e, à frente, o que
// se lhe juntou (o relógio, um print, o que disseste).
export interface OriginLike {
  source?: string | null
  favorite_id?: string | null
  merged_from?: unknown[] | null
}

function base(w: OriginLike): string {
  if (w.source === 'screenshot') return 'print'
  if (w.source === 'strava') return 'Strava'
  if (w.source === 'intervals') return 'Relógio (auto)'
  return w.favorite_id ? 'teu treino' : 'à mão'
}

export function workoutOrigin(w: OriginLike): string {
  const first = base(w)
  const added: string[] = []
  for (const entry of w.merged_from ?? []) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const what = e.import_id ? 'print' : e.intervals_id ? 'relógio' : e.said ? 'dito' : e.workout_id ? 'juntos' : null
    if (what && what !== first && !added.includes(what) && !(what === 'relógio' && w.source === 'intervals')) added.push(what)
  }
  return [first, ...added].join(' + ')
}
