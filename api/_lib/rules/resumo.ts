// Resumo da semana (cron): só se escreve com dados e volta a escrever-se
// quando os dados da semana mudam depois de escrito (a resposta «Foi tudo?»
// de domingo, uma foto analisada mais tarde). Sem supabase nem node.

// Sem dias completos, refeições nem treinos não há nada a resumir (o fecho
// do dia cria as linhas dos dias mesmo sem nada registado).
export function weekHasData(input: { completeDays: number; meals: number; workouts: number }): boolean {
  return input.completeDays > 0 || input.meals > 0 || input.workouts > 0
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// Impressão digital dos dados enviados à IA: o JSON com as chaves por ordem
// (o jsonb do Postgres reordena-as) num hash curto (FNV-1a de 32 bits).
export function dataFingerprint(value: unknown): string {
  const text = stableJson(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
