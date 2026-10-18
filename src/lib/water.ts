import { supabase } from './supabase'
import { emitDataChanged } from './events'
import { GLASS_ML } from '../../api/_lib/rules/extras'

// Copos de água fora do cartão do Hoje (a «Pergunta à app»): soma ao que está
// gravado em days.water_ml (migração 12) e devolve o valor de antes, para
// Anular. O cartão da água recarrega com o aviso de dados mudados.
async function userId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sessão expirada. Volta a entrar.')
  return user.id
}

async function setWater(date: string, ml: number): Promise<void> {
  const uid = await userId()
  const { error } = await supabase
    .from('days')
    .upsert({ user_id: uid, date, water_ml: Math.max(0, ml) }, { onConflict: 'user_id,date' })
  if (error) throw new Error('Não consegui guardar a água.')
  emitDataChanged()
}

export async function addWaterGlasses(date: string, glasses: number): Promise<number> {
  const { data, error } = await supabase.from('days').select('water_ml').eq('date', date).maybeSingle()
  if (error) throw new Error('Não consegui guardar a água.')
  const before = Number(data?.water_ml ?? 0)
  await setWater(date, before + glasses * GLASS_ML)
  return before
}

export async function restoreWater(date: string, ml: number): Promise<void> {
  await setWater(date, ml)
}
