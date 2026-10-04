// Regra 9 (histórica): o check-in de dor (0-10) depois do treino deixou de
// ser pedido quando a app passou a ser de duas pessoas. Os treinos antigos
// guardam o estado: verde <= 2, amarelo 3-5, vermelho >= 6.

export type Semaforo = 'green' | 'yellow' | 'red'

export function painStatus(
  painDuring: number | null,
  painNextDay: number | null,
): Semaforo | null {
  const pains = [painDuring, painNextDay].filter((p): p is number => p != null)
  if (pains.length === 0) return null
  const worst = Math.max(...pains)
  if (worst <= 2) return 'green'
  if (worst <= 5) return 'yellow'
  return 'red'
}

// Recebe os estados das sessões por ordem cronológica (mais recente no fim).
export function canProgress(statuses: (Semaforo | null)[]): boolean {
  const known = statuses.filter((s): s is Semaforo => s != null)
  if (known.length < 2) return false
  return known[known.length - 1] === 'green' && known[known.length - 2] === 'green'
}
