import { supabase } from './supabase'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'

export type DayAnswer = 'dia_fechado' | 'faltou_algo'

async function writeFlags(userId: string, date: string, flags: string[], today: string): Promise<boolean> {
  const { error } = await supabase
    .from('days')
    .upsert({ user_id: userId, date, flags, dirty: true }, { onConflict: 'user_id,date' })
  if (error) return false
  emitDataChanged()
  recomputeFrom(date, today)
  return true
}

// «Sim, foi tudo» (dia_fechado) ou «Não, faltou algo» (faltou_algo) num dia:
// tira a outra marca, grava, e recalcula esse dia e os seguintes. Devolve as
// marcas de antes (para Anular) ou null se não gravou.
export async function markDay(date: string, flag: DayAnswer, today: string): Promise<string[] | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: day } = await supabase.from('days').select('flags').eq('date', date).maybeSingle()
  const current = Array.isArray(day?.flags) ? (day.flags as string[]) : []
  const other: DayAnswer = flag === 'dia_fechado' ? 'faltou_algo' : 'dia_fechado'
  const flags = [...current.filter((f) => f !== other && f !== flag), flag]
  return (await writeFlags(user.id, date, flags, today)) ? current : null
}

// Usado no cartão «Ontem» do Hoje e nas perguntas da análise da IA.
export async function answerDay(date: string, flag: DayAnswer, today: string): Promise<boolean> {
  return (await markDay(date, flag, today)) != null
}

// Anular a resposta: volta às marcas que o dia tinha.
export async function restoreDayFlags(date: string, flags: string[], today: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  return writeFlags(user.id, date, flags, today)
}
