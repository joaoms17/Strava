// A bicicleta só para quem a usa (T15). As potências para escolher num toque
// vêm das Definições (as tuas potências) ou, sem elas, das últimas sessões
// com watts confirmados; nunca de números fixos (eram 130 · 140 · 150 para
// toda a gente). Sem nenhuma, escreve-se.
export function wattsChoices(profileOptions: number[] | null | undefined, recentWatts: (number | null | undefined)[]): number[] {
  if (profileOptions?.length) return [...profileOptions].sort((a, b) => a - b)
  const seen: number[] = []
  for (const w of recentWatts) {
    if (w == null || !Number.isFinite(w) || w <= 0 || seen.includes(w)) continue
    seen.push(w)
    if (seen.length === 4) break
  }
  return seen.sort((a, b) => a - b)
}

// «Próxima bicicleta» só aparece a quem anda na bicicleta com potência: as
// tuas potências nas Definições, um dos teus treinos de bicicleta ou uma
// sessão com watts que não foram supostos. Uma volta de estrada do relógio
// (sem potência) não chega.
export function usesBikePower(input: {
  profileOptions?: number[] | null
  bikeFavorites: number
  bikes: { watts: number | null; watts_source?: string | null }[]
}): boolean {
  return (
    (input.profileOptions?.length ?? 0) > 0 ||
    input.bikeFavorites > 0 ||
    input.bikes.some((w) => w.watts != null && w.watts_source !== 'prefill')
  )
}

// Pedir os prints com a secção Connect IQ (a app da bicicleta que dá os km e
// a potência) só a quem já a usou: alguma bicicleta com watts vindos do
// relógio ou da consola. Quem só faz voltas de estrada sem potência não a tem.
export function usesConnectIq(bikes: { watts: number | null; watts_source?: string | null }[]): boolean {
  return bikes.some((w) => w.watts != null && (w.watts_source === 'device' || w.watts_source === 'console'))
}
