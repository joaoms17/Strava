import { supabase } from './supabase'
import { emitDataChanged } from './events'
import { recomputeFrom } from './recompute'

export type DayAnswer = 'dia_fechado' | 'faltou_algo'

// «Sim, foi tudo» (dia_fechado) ou «Não, faltou algo» (faltou_algo) num dia:
// tira a outra marca, grava, e recalcula esse dia e os seguintes. Usado no
// cartão «Ontem» do Hoje e nas perguntas da análise da IA.
export async function answerDay(date: string, flag: DayAnswer, today: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data: day } = await supabase.from('days').select('flags').eq('date', date).maybeSingle()
  const current = Array.isArray(day?.flags) ? (day.flags as string[]) : []
  const other: DayAnswer = flag === 'dia_fechado' ? 'faltou_algo' : 'dia_fechado'
  const flags = [...current.filter((f) => f !== other && f !== flag), flag]
  const { error } = await supabase
    .from('days')
    .upsert({ user_id: user.id, date, flags, dirty: true }, { onConflict: 'user_id,date' })
  if (error) return false
  emitDataChanged()
  recomputeFrom(date, today)
  return true
}
