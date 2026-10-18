// Aprendizagem dos alimentos (decisão 26): o que cada escrita numa refeição
// ensina à biblioteca pessoal (use_count, porção habitual e alimentos novos
// do texto). Nunca a estimativa crua de uma foto: as fotos só ensinam
// depois de «Está certo» ou de uma correção.
import type { MealItem } from './meal-totals.js'

export type LearnEvent = 'analisada' | 'confirmada' | 'editada'

const fold = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// - analisada: só refeições de texto, os itens com confiança alta (o texto
//   deu a quantidade ou é um alimento da biblioteca);
// - confirmada: o que ainda não tinha ensinado (no texto, as estimativas;
//   nas fotos, tudo);
// - editada: só o que a pessoa mudou ou juntou (outro nome ou outros gramas).
export function itemsToLearn(
  event: LearnEvent,
  inputType: string,
  items: MealItem[],
  previous: MealItem[] = [],
): MealItem[] {
  const real = items.filter((i) => i.grams > 0)
  if (event === 'analisada') return inputType === 'text' ? real.filter((i) => i.confidence === 'alta') : []
  if (event === 'confirmada') return inputType === 'text' ? real.filter((i) => i.confidence !== 'alta') : real
  const before = new Map(previous.map((i) => [fold(i.name), i.grams]))
  return real.filter((i) => before.get(fold(i.name)) !== i.grams)
}
