// Limites da IA: um teto mensal suave em euros e um limite diário de
// análises de fotos (proteção contra repetições em ciclo).

// Taxa fixa para mostrar e comparar em euros (aproximado).
export const USD_TO_EUR = 0.92

// O que conta como «análise de foto» para o limite diário: os pedidos ao
// modelo das fotos (também o áudio do «Dizer o treino», que vai para ele, a
// foto do que sobrou, comparada com a do prato cheio, a análise da evolução e
// o plano da semana de treino).
export const VISION_KINDS = [
  'meal_photo',
  'meal_parse_photo',
  'workout_shot',
  'menu_pick',
  'label_read',
  'workout_said_audio',
  'meal_leftovers',
  // Também vão para o modelo das fotos (com o Gemini, a mesma quota, S6).
  'evolution',
  'training_week',
]

// Com o Gemini (plano gratuito) a chave e a quota são uma só para a casa:
// o limite diário de fotos conta as de todas as pessoas, e não há custos em
// euros (o teto mensal não se aplica). Com o Claude, cada pessoa tem os
// seus limites e o teto mensal.
export function aiLimitsFor(provider: 'anthropic' | 'gemini'): { sharedDaily: boolean; monthlyEur: boolean } {
  return provider === 'gemini' ? { sharedDaily: true, monthlyEur: false } : { sharedDaily: false, monthlyEur: true }
}

export function monthlyCapReached(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= capEur
}

export function dailyVisionCapReached(visionCallsToday: number, cap: number): boolean {
  return cap > 0 && visionCallsToday >= cap
}

// «Pergunta à app»: no máximo 60 perguntas por dia (com o Gemini, as de toda
// a casa, como as fotos; com o Claude, por pessoa). Uma conversa a correr
// não pode gastar a quota gratuita do dia nem o teto do mês.
export const ASK_KIND = 'ask'
export const ASK_DAILY_CAP = 60

export function dailyAskCapReached(asksToday: number, cap = ASK_DAILY_CAP): boolean {
  return cap > 0 && asksToday >= cap
}

// M20: reserva atómica antes de cada chamada (função ai_reserve_call,
// migração 20261113000060). O que conta para cada tipo de chamada: o limite
// diário (fotos ou perguntas, de toda a casa com o Gemini) e o teto do mês
// em euros (só com o Claude). A verificação de sistema ('ai_check', em
// Avançado) não tem limites: serve justamente para ver se a IA responde.
export const DEFAULT_MONTHLY_CAP_EUR = 10
export const DEFAULT_DAILY_VISION_CAP = 40

export interface QuotaPlan {
  countKinds: string[] // os tipos que contam para o limite diário deste
  dailyCap: number // 0 = sem limite diário
  sharedDaily: boolean // conta as chamadas de toda a casa
  monthlyCapEur: number // 0 = sem teto mensal
}

export function quotaPlan(
  kind: string,
  provider: 'anthropic' | 'gemini',
  profile: { ai_monthly_cap_eur?: number | string | null; ai_daily_vision_cap?: number | string | null } | null,
  // «Analisar esta mesmo assim»: a chamada regista-se (conta), sem limites.
  force = false,
): QuotaPlan {
  const limits = aiLimitsFor(provider)
  if (kind === 'ai_check' || force) return { countKinds: [], dailyCap: 0, sharedDaily: limits.sharedDaily, monthlyCapEur: 0 }
  const capOf = (value: unknown, fallback: number) => {
    const n = value == null || value === '' ? fallback : Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const vision = VISION_KINDS.includes(kind)
  const ask = kind === ASK_KIND
  return {
    countKinds: vision ? [...VISION_KINDS] : ask ? [ASK_KIND] : [],
    dailyCap: vision ? capOf(profile?.ai_daily_vision_cap, DEFAULT_DAILY_VISION_CAP) : ask ? ASK_DAILY_CAP : 0,
    sharedDaily: limits.sharedDaily,
    monthlyCapEur: limits.monthlyEur ? capOf(profile?.ai_monthly_cap_eur, DEFAULT_MONTHLY_CAP_EUR) : 0,
  }
}

// A resposta da função: a reserva feita (com o id da linha), recusada por um
// limite, ou null quando não serve (sem a função, resposta estranha): aí fica
// o comportamento de antes (verificar e registar depois).
export type QuotaOutcome = { ok: true; id: string } | { ok: false; reason: 'diario' | 'mensal' }

export function quotaOutcome(data: unknown): QuotaOutcome | null {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as { ok?: unknown; id?: unknown; reason?: unknown }
  if (d.ok === true) return typeof d.id === 'string' && d.id.length > 0 ? { ok: true, id: d.id } : null
  if (d.ok === false && (d.reason === 'diario' || d.reason === 'mensal')) return { ok: false, reason: d.reason }
  return null
}

// A frase para a app quando a reserva é recusada.
export function quotaMessage(reason: 'diario' | 'mensal', kind: string, sharedDaily: boolean): string {
  if (reason === 'mensal') return 'Chegaste ao limite mensal da IA (Definições › Avançado).'
  if (kind === ASK_KIND) {
    return sharedDaily ? 'A casa já fez muitas perguntas hoje. Amanhã há mais.' : 'Já fizeste muitas perguntas hoje. Amanhã há mais.'
  }
  return sharedDaily
    ? 'A casa chegou ao limite de fotos da IA de hoje. Amanhã há mais.'
    : 'Chegaste ao limite diário de fotos da IA (Definições › Avançado).'
}

// Aviso nas Definições › Avançado a partir de 80 % do teto.
export function nearMonthlyCap(monthUsd: number, capEur: number): boolean {
  return capEur > 0 && monthUsd * USD_TO_EUR >= 0.8 * capEur
}

// Os pedidos do mês por tipo, no Avançado: «1 menu», não «1 menus». Os
// rótulos vêm no plural; um que não esteja aqui fica sempre no plural.
const SINGULAR: Record<string, string> = {
  'refeições por texto': 'refeição por texto',
  fotos: 'foto',
  correções: 'correção',
  rótulos: 'rótulo',
  receitas: 'receita',
  menus: 'menu',
  'prints do relógio': 'print do relógio',
  'treinos ditos': 'treino dito',
  'treinos ditos (áudio)': 'treino dito (áudio)',
  'análises da evolução': 'análise da evolução',
  'planos da semana': 'plano da semana',
  verificações: 'verificação',
  planos: 'plano',
  resumos: 'resumo',
}

export function kindLabel(plural: string, count: number): string {
  return count === 1 ? (SINGULAR[plural] ?? plural) : plural
}
