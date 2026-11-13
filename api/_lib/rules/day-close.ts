// Regra 5: dia completo = >= 2 refeições registadas ou marcado "dia fechado"
// («Sim, foi tudo»). Dias com kcal_in < 800 sem marca são incompletos (ficam
// fora do adaptativo), e «Não, faltou algo» tira sempre o dia das contas.
// Uma foto ainda sem números (a analisar, com erro ou acima do limite da IA)
// também deixa o dia incompleto, até ter números ou até «Sim, foi tudo».
export function isDayComplete(input: {
  mealCount: number
  kcalIn: number
  manuallyClosed: boolean
  missingSomething?: boolean
  uncountedMeals?: number
}): boolean {
  if (input.missingSomething) return false
  if (input.manuallyClosed) return true
  if ((input.uncountedMeals ?? 0) > 0) return false
  return input.mealCount >= 2 && input.kcalIn >= 800
}

// Sequência de dias com tudo registado (Hoje): dias seguidos, para trás a
// partir de ontem, que contam como completos pela regra 5 — 2 refeições e
// 800 kcal, ou «Sim, foi tudo» (jejum, refeições saltadas). Um dia com
// refeições e «Não, faltou algo» não soma nem quebra (a resposta honesta não
// castiga); um dia sem nada, ou incompleto sem resposta, quebra. Hoje ainda
// vai a meio: soma 1 se já estiver completo, mas não quebra. streakFromDays
// conta pelos dias guardados, com as refeições de hoje à parte.
export interface StreakDay {
  mealCount: number
  kcalIn: number
  flags?: string[] | null
}

type StreakState = 'feito' | 'honesto' | 'quebra'

function streakState(d: StreakDay | undefined): StreakState {
  const flags = d?.flags ?? []
  if (
    isDayComplete({
      mealCount: d?.mealCount ?? 0,
      kcalIn: d?.kcalIn ?? 0,
      manuallyClosed: flags.includes('dia_fechado'),
      missingSomething: flags.includes('faltou_algo'),
    })
  ) {
    return 'feito'
  }
  return (d?.mealCount ?? 0) > 0 && flags.includes('faltou_algo') ? 'honesto' : 'quebra'
}

function countStreak(state: (date: string) => StreakState, today: string, maxDays: number): number {
  let streak = 0
  let day = new Date(`${today}T00:00:00Z`)
  for (let i = 0; i < maxDays; i++) {
    day = new Date(day.getTime() - 86_400_000)
    const s = state(day.toISOString().slice(0, 10))
    if (s === 'feito') streak++
    else if (s === 'quebra') break
  }
  return streak + (state(today) === 'feito' ? 1 : 0)
}

// A mesma sequência a partir dos dias guardados (H3): ler as refeições de 120
// dias passava das 1 000 linhas que a API devolve e a sequência caía para 0.
// Um dia fechado conta pelo `is_complete` guardado; hoje, ontem (o fecho pode
// ainda não ter corrido) e os dias por recalcular (`dirty`) contam pelas
// refeições (`fromMeals`, com as marcas do dia).
export interface StoredStreakDay {
  date: string
  is_complete?: boolean | null
  kcal_in?: number | string | null
  flags?: string[] | null
}

export function streakFromDays(
  days: StoredStreakDay[],
  fromMeals: Record<string, StreakDay>,
  today: string,
  maxDays = 365,
): number {
  const rows = new Map(days.map((d) => [d.date, d]))
  return countStreak(
    (date) => {
      if (fromMeals[date]) return streakState(fromMeals[date])
      const row = rows.get(date)
      if (row?.is_complete === true) return 'feito'
      return Number(row?.kcal_in ?? 0) > 0 && (row?.flags ?? []).includes('faltou_algo') ? 'honesto' : 'quebra'
    },
    today,
    maxDays,
  )
}
