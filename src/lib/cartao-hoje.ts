import type { NextStepId } from '../../api/_lib/rules/proximo-passo'

// H9: o Hoje tem uma hierarquia fixa — o cartão do plano, no máximo UM
// cartão de ação e logo a lista do dia. O cartão de ação sai desta fila
// única, por ordem de prioridade:
//
// Num dia passado: «Foi tudo neste dia?» e, já marcado, «Faltou algo».
// Hoje: refeição com erro, limite da IA, treino por confirmar, «Qual foi?»
// (um treino que chegou sozinho), a primeira pesagem de uma pessoa nova, o
// próximo passo (pesar, ontem, rever, pouco, proteína, medir), a primeira
// foto e, no fim, «O teu mês está pronto».
//
// Com o dia vazio, o cartão vazio do dia já convida a fotografar e a pesar:
// nenhum cartão de cima volta a pedir o mesmo (antes, no primeiro dia,
// pesar e fotografar eram pedidos três vezes cada um).
export type HojeCardId =
  | 'foi_tudo'
  | 'faltou_algo'
  | 'qual_foi'
  | 'primeira_pesagem'
  | 'primeira_foto'
  | 'mes'
  | NextStepId

export interface HojeCardInput {
  isToday: boolean
  offline: boolean // sem saber o dia não se pede nada
  askPastDay: boolean // «Foi tudo neste dia?»
  missingMarked: boolean // dia passado marcado «faltou algo»
  step: NextStepId | null // o próximo passo (regras de proximo-passo)
  qualFoi: number // treinos que chegaram sozinhos por responder
  monthReady: boolean
  hasAnyWeight: boolean
  hasAnyMeal: boolean
  dismissedHints: readonly string[]
  dayEmpty: boolean // a lista do dia está vazia (o cartão vazio aparece)
}

const URGENT: NextStepId[] = ['erro', 'limite', 'treino']

export function hojeActionCard(input: HojeCardInput): HojeCardId | null {
  if (input.offline) return null
  if (!input.isToday) {
    if (input.askPastDay) return 'foi_tudo'
    if (input.missingMarked) return 'faltou_algo'
    return null
  }
  const { step } = input
  if (step && URGENT.includes(step)) return step
  if (input.qualFoi > 0) return 'qual_foi'
  const firstWeigh = !input.hasAnyWeight && !input.dismissedHints.includes('primeira_pesagem')
  if (firstWeigh && !input.dayEmpty) return 'primeira_pesagem'
  // Pesar: com o dia vazio o cartão vazio já tem «Ou pesa-te primeiro»; a
  // primeira pesagem tem o cartão próprio (com «Saltar», de vez).
  if (step && !(step === 'pesar' && (input.dayEmpty || firstWeigh))) return step
  if (!input.hasAnyMeal && !input.dayEmpty && !input.dismissedHints.includes('primeira_foto')) return 'primeira_foto'
  if (input.monthReady) return 'mes'
  return null
}
