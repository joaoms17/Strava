// «Foi tudo neste dia?» (decisão 302): as marcas que cada resposta deixa no
// dia, o que o aviso diz (com Anular) e «Afinal foi tudo». Contas puras, com
// testes; quem grava é `src/lib/day-flag.ts`.

export type DayAnswer = 'dia_fechado' | 'faltou_algo'

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// A linha por baixo dos dois botões (a consequência de «Faltou algo»).
export const ANSWER_HINT = 'Se faltou algo, o dia fica fora das contas.'

// «3 out» (o espaço não parte a data a meio).
export function dayName(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTH_SHORT[Number(date.slice(5, 7)) - 1]}`
}

export const missingFlag = (flags: string[] | null | undefined): boolean => (flags ?? []).includes('faltou_algo')

// A resposta: tira a outra marca e põe esta (sem repetir).
export function answerFlags(current: string[], flag: DayAnswer): string[] {
  const other: DayAnswer = flag === 'dia_fechado' ? 'faltou_algo' : 'dia_fechado'
  return [...current.filter((f) => f !== other && f !== flag), flag]
}

// «Afinal foi tudo»: sai «faltou algo» e entra «Sim, foi tudo» (o que a
// pessoa diz agora); o `dia_incompleto` que vinha dele sai também, porque
// com «Sim, foi tudo» o dia conta sempre (regra 5).
export function clearMissingFlags(current: string[]): string[] {
  return answerFlags(
    current.filter((f) => f !== 'dia_incompleto'),
    'dia_fechado',
  )
}

// O que as marcas decidem sozinhas sobre o dia (regra 5): «faltou algo» tira
// sempre, «Sim, foi tudo» põe sempre; sem nenhuma, quem decide são as
// refeições (o recálculo). Assim o ecrã muda logo, sem esperar pelo servidor.
export function completeFromFlags(flags: string[]): boolean | null {
  if (flags.includes('faltou_algo')) return false
  if (flags.includes('dia_fechado')) return true
  return null
}

// O aviso depois de responder (com Anular): diz a consequência.
export function answerToast(date: string, flag: DayAnswer): string {
  return flag === 'faltou_algo'
    ? `Dia ${dayName(date)} marcado como incompleto — não conta no balanço`
    : `Dia ${dayName(date)} marcado como completo — conta no balanço`
}
