import { describe, expect, it } from 'vitest'
import {
  LEFTOVERS_BLIND_WINDOW_MS,
  LEFTOVERS_WINDOW_MS,
  applyLeftovers,
  askLeftovers,
  canTakeLeftovers,
  clampFraction,
  eatenShares,
  leftoversCandidate,
  leftoversOutcome,
  offersLeftovers,
  ofSlot,
  plateSignature,
  platePhotos,
  signatureSimilarity,
  statusAfterLeftovers,
  type CandidateMeal,
} from '../api/_lib/rules/sobras'
import { mealTotals, type MealItem } from '../api/_lib/rules/meal-totals'
import { outputSchema, parseStructured } from '../api/_lib/rules/resposta-ia'
import { LeftoversAnswerSchema } from '../api/_lib/schemas'

const item = (name: string, grams: number, kcal: number, extra: Partial<MealItem> = {}): MealItem => ({
  name,
  grams,
  kcal,
  protein: grams / 10,
  carbs: grams / 5,
  fat: grams / 20,
  food_id: null,
  estimated: true,
  confidence: 'media',
  ...extra,
})

const plate = [item('Arroz branco', 180, 234), item('Frango grelhado', 150, 248), item('Salada mista', 80, 20)]

describe('fração comida', () => {
  it('fica entre 0 e 1, em passos de 5 %', () => {
    expect(clampFraction(0.5)).toBe(0.5)
    expect(clampFraction(0.33)).toBe(0.35)
    expect(clampFraction(0.62)).toBe(0.6)
    expect(clampFraction(1.4)).toBe(1)
    expect(clampFraction(-0.2)).toBe(0)
  })

  it('perto de tudo é tudo e perto de nada é nada; sem número, conta como tudo comido', () => {
    expect(clampFraction(0.96)).toBe(1)
    expect(clampFraction(0.95)).toBe(1)
    expect(clampFraction(0.04)).toBe(0)
    expect(clampFraction(Number.NaN)).toBe(1)
    expect(clampFraction(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('o que a IA disse → parte comida de cada item', () => {
  const answer = (items: { index: number; name: string; eaten: number }[], empty_plate = false) => ({
    empty_plate,
    items: items.map((i) => ({ ...i, confidence: 'media' as const })),
  })

  it('pelo índice; o que não foi referido fica todo comido', () => {
    const shares = eatenShares(plate, answer([{ index: 0, name: 'Arroz branco', eaten: 0.5 }]))
    expect(shares.map((s) => s.fraction)).toEqual([0.5, 1, 1])
    expect(shares[1]!.confidence).toBeNull()
  })

  it('um índice que não existe ou repetido procura-se pelo nome (sem acentos nem maiúsculas)', () => {
    const shares = eatenShares(
      plate,
      answer([
        { index: 7, name: 'salada MISTA', eaten: 0 },
        { index: 1, name: 'Frango grelhado', eaten: 0.5 },
        { index: 1, name: 'Arroz Branco', eaten: 0.7 },
      ]),
    )
    expect(shares.map((s) => s.fraction)).toEqual([0.7, 0.5, 0])
  })

  it('nada de novo entra: um item que não está na refeição fica de fora', () => {
    const shares = eatenShares(plate, answer([{ index: 9, name: 'Sobremesa', eaten: 0.5 }]))
    expect(shares).toHaveLength(3)
    expect(shares.every((s) => s.fraction === 1)).toBe(true)
  })

  it('prato vazio: tudo comido, seja o que for que venha nos itens', () => {
    const shares = eatenShares(plate, answer([{ index: 0, name: 'Arroz branco', eaten: 0.2 }], true))
    expect(shares.every((s) => s.fraction === 1)).toBe(true)
  })
})

describe('resposta da IA (zod)', () => {
  it('sem limites no schema que vai para a IA; uma fração fora de 0–1 passa e arruma-se depois', () => {
    const json = JSON.stringify(outputSchema(LeftoversAnswerSchema))
    expect(json).not.toMatch(/minimum|maximum/)
    const answer = parseStructured(
      JSON.stringify({
        same_plate: true,
        reason: null,
        empty_plate: false,
        items: [{ index: 0, name: 'Arroz branco', eaten: 1.3, confidence: 'média' }],
      }),
      LeftoversAnswerSchema,
    )
    expect(answer.items[0]!.confidence).toBe('media')
    expect(eatenShares(plate, answer)[0]!.fraction).toBe(1)
  })

  it('uma resposta sem os campos pedidos não passa', () => {
    expect(() => parseStructured(JSON.stringify({ items: [] }), LeftoversAnswerSchema)).toThrow()
  })
})

describe('resultado', () => {
  const share = (fraction: number) => ({ fraction, confidence: 'media' as const })

  it('outro prato não muda nada; tudo comido; igual ao antes; aplicado', () => {
    expect(leftoversOutcome({ same_plate: false }, [share(0.5)])).toBe('outro_prato')
    expect(leftoversOutcome({ same_plate: true }, [share(1), share(1)])).toBe('tudo')
    expect(leftoversOutcome({ same_plate: true }, [share(0), share(0)])).toBe('igual')
    expect(leftoversOutcome({ same_plate: true }, [share(0), share(1)])).toBe('aplicado')
    expect(leftoversOutcome({ same_plate: true }, [share(0.5), share(1)])).toBe('aplicado')
  })
})

describe('aplicar o que sobrou aos itens', () => {
  it('gramas, kcal e macros na mesma proporção, arredondados a 1 casa', () => {
    const { items, leftKcal } = applyLeftovers(plate, [
      { fraction: 0.35, confidence: 'media' },
      { fraction: 1, confidence: 'alta' },
      { fraction: 1, confidence: null },
    ])
    expect(items[0]).toMatchObject({ name: 'Arroz branco', grams: 63, kcal: 81.9, protein: 6.3, carbs: 12.6, fat: 3.2 })
    expect(items[1]).toEqual(plate[1])
    expect(items[2]).toEqual(plate[2])
    expect(leftKcal).toBe(152.1)
    expect(mealTotals(items).kcal).toBe(349.9)
  })

  it('um item que ficou todo no prato sai', () => {
    const { items, leftKcal } = applyLeftovers(plate, [
      { fraction: 1, confidence: null },
      { fraction: 1, confidence: null },
      { fraction: 0, confidence: 'alta' },
    ])
    expect(items.map((i) => i.name)).toEqual(['Arroz branco', 'Frango grelhado'])
    expect(leftKcal).toBe(20)
  })

  it('o que se descontou passa a estimado, com a confiança mais baixa das duas', () => {
    const exact = item('Iogurte grego', 125, 120, { estimated: false, confidence: 'alta', food_id: 'f1' })
    const [a, b, c] = applyLeftovers(
      [exact, exact, { ...exact, confidence: undefined }],
      [
        { fraction: 0.5, confidence: 'alta' },
        { fraction: 0.5, confidence: 'baixa' },
        { fraction: 0.5, confidence: null },
      ],
    ).items
    expect(a).toMatchObject({ grams: 62.5, estimated: true, confidence: 'alta', food_id: 'f1' })
    expect(b!.confidence).toBe('baixa')
    expect(c!.confidence).toBe('media')
    expect(statusAfterLeftovers('ok', [a!, b!])).toBe('por_rever')
    expect(statusAfterLeftovers('ok', [a!, c!])).toBe('ok')
    expect(statusAfterLeftovers('por_rever', [a!])).toBe('por_rever')
  })

  it('itens sem gramas (registo rápido) também escalam as kcal', () => {
    const quick = item('Registo rápido', 0, 500)
    const { items } = applyLeftovers([quick], [{ fraction: 0.5, confidence: 'media' }])
    expect(items[0]).toMatchObject({ grams: 0, kcal: 250 })
  })
})

const UID = 'u1'
const meal = (over: Partial<CandidateMeal> = {}): CandidateMeal => ({
  id: 'm1',
  user_id: UID,
  client_id: 'c1',
  status: 'ok',
  deleted_at: null,
  items: plate,
  photo_paths: [`${UID}/c1/0.jpg`],
  leftover_photo_path: null,
  date: '2026-10-18',
  logged_at: '2026-10-18T12:30:00.000Z',
  ...over,
})

describe('que refeições levam a foto do depois', () => {
  it('as fotos do prato são as da pasta da refeição', () => {
    expect(platePhotos(meal({ photo_paths: [`${UID}/c1/0.jpg`, `${UID}/c1/j1-0.jpg`, `${UID}/favoritos/f.jpg`] }))).toEqual([
      `${UID}/c1/0.jpg`,
      `${UID}/c1/j1-0.jpg`,
    ])
    // sem client_id, a pasta é o id (o «Juntar foto» de um texto)
    expect(platePhotos(meal({ client_id: null, photo_paths: [`${UID}/m1/j1-0.jpg`] }))).toHaveLength(1)
  })

  it('analisada, com itens, com a foto do prato e ainda sem a do depois', () => {
    expect(canTakeLeftovers(meal())).toBe(true)
    expect(canTakeLeftovers(meal({ status: 'por_rever' }))).toBe(true)
    expect(canTakeLeftovers(meal({ status: 'a_analisar' }))).toBe(false)
    expect(canTakeLeftovers(meal({ status: 'erro' }))).toBe(false)
    expect(canTakeLeftovers(meal({ items: [] }))).toBe(false)
    expect(canTakeLeftovers(meal({ deleted_at: '2026-10-18T13:00:00.000Z' }))).toBe(false)
    expect(canTakeLeftovers(meal({ leftover_photo_path: `${UID}/c1/d1.jpg` }))).toBe(false)
    // repetida de outro dia, de uma favorita ou partilhada: a foto é de outro prato
    expect(canTakeLeftovers(meal({ photo_paths: [`${UID}/outra/0.jpg`] }))).toBe(false)
    expect(canTakeLeftovers(meal({ photo_paths: [`${UID}/partilhada-m1/0.jpg`], client_id: null }))).toBe(false)
  })
})

describe('«Sobrou comida?» na folha', () => {
  it('só nas refeições de hoje e de ontem', () => {
    expect(offersLeftovers(meal({ date: '2026-10-18' }), '2026-10-18')).toBe(true)
    expect(offersLeftovers(meal({ date: '2026-10-17' }), '2026-10-18')).toBe(true)
    expect(offersLeftovers(meal({ date: '2026-10-16' }), '2026-10-18')).toBe(false)
    expect(offersLeftovers(meal({ date: '2026-10-18', leftover_photo_path: 'x' }), '2026-10-18')).toBe(false)
  })
})

describe('no ＋: a refeição de que a foto pode ser o que sobrou', () => {
  const at = (iso: string) => ({ date: '2026-10-18', at: new Date(iso) })

  it('do mesmo dia, entre 5 min e 3 h depois; a mais recente', () => {
    const lunch = meal({ id: 'almoco', logged_at: '2026-10-18T12:30:00.000Z' })
    const breakfast = meal({ id: 'pa', logged_at: '2026-10-18T08:30:00.000Z' })
    expect(leftoversCandidate([breakfast, lunch], at('2026-10-18T13:10:00.000Z'))?.id).toBe('almoco')
    expect(leftoversCandidate([lunch], at('2026-10-18T12:33:00.000Z'))).toBeNull()
    expect(leftoversCandidate([lunch], at('2026-10-18T15:40:00.000Z'))).toBeNull()
    // uma foto de antes da refeição (da galeria) não é o que sobrou
    expect(leftoversCandidate([lunch], at('2026-10-18T12:00:00.000Z'))).toBeNull()
    expect(leftoversCandidate([lunch], { date: '2026-10-19', at: new Date('2026-10-18T13:10:00.000Z') })).toBeNull()
  })

  it('salta as que já têm a foto do depois ou ainda estão a analisar', () => {
    const done = meal({ id: 'feita', logged_at: '2026-10-18T12:50:00.000Z', leftover_photo_path: 'x' })
    const analysing = meal({ id: 'a', logged_at: '2026-10-18T12:55:00.000Z', status: 'a_analisar' })
    const lunch = meal({ id: 'almoco' })
    expect(leftoversCandidate([done, analysing, lunch], at('2026-10-18T13:10:00.000Z'))?.id).toBe('almoco')
  })

  it('pergunta com as cores parecidas até 3 h; sem as comparar, só até 1 h 30', () => {
    const min = 60_000
    expect(askLeftovers({ gapMs: 40 * min, similarity: 0.8 })).toBe(true)
    expect(askLeftovers({ gapMs: LEFTOVERS_WINDOW_MS, similarity: 0.8 })).toBe(true)
    expect(askLeftovers({ gapMs: 40 * min, similarity: 0.6 })).toBe(false)
    expect(askLeftovers({ gapMs: 40 * min, similarity: 0.7 })).toBe(true)
    expect(askLeftovers({ gapMs: LEFTOVERS_BLIND_WINDOW_MS, similarity: null })).toBe(true)
    expect(askLeftovers({ gapMs: 2 * 60 * min, similarity: null })).toBe(false)
    expect(askLeftovers({ gapMs: 2 * min, similarity: 0.9 })).toBe(false)
    expect(askLeftovers({ gapMs: LEFTOVERS_WINDOW_MS + min, similarity: 0.9 })).toBe(false)
  })

  it('«do almoço», «do pequeno-almoço», «da ceia»', () => {
    expect(ofSlot('almoco')).toBe('do almoço')
    expect(ofSlot('pequeno_almoco')).toBe('do pequeno-almoço')
    expect(ofSlot('ceia')).toBe('da ceia')
  })
})

// Uma «foto» de 10×10: o fundo e um quadrado de comida ao centro (o centro
// de 60 % é o que conta), com as cores dadas por partes.
type Rgb = [number, number, number]
function photo(parts: [Rgb, number][], background: Rgb = [235, 235, 235]): Uint8ClampedArray {
  const size = 10
  const data = new Uint8ClampedArray(size * size * 4)
  const center: number[] = []
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) center.push(y * size + x)
  for (let p = 0; p < size * size; p++) data.set([...background, 255], p * 4)
  let k = 0
  for (const [colour, count] of parts) {
    for (let j = 0; j < count && k < center.length; j++, k++) data.set([...colour, 255], center[k]! * 4)
  }
  return data
}
const WHITE: Rgb = [240, 240, 236]
const BROWN: Rgb = [170, 110, 50] // frango
const GREEN: Rgb = [70, 150, 60] // salada
const PURPLE: Rgb = [110, 40, 140] // mirtilos
const PINK: Rgb = [220, 80, 120] // morangos

describe('cores do prato (sem IA)', () => {
  const before = plateSignature(photo([[BROWN, 14], [GREEN, 10], [WHITE, 12]]), 10, 10)!

  it('histograma da zona do meio: tons com cor e cinzentos à parte', () => {
    expect(before.chroma).toBeCloseTo(24 / 36, 5)
    expect(before.hues.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(before.greys.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(plateSignature(new Uint8ClampedArray(0), 0, 0)).toBeNull()
  })

  it('o que sobrou (parte do que lá estava, mais prato à vista) é parecido', () => {
    const leftovers = plateSignature(photo([[GREEN, 6], [BROWN, 2], [WHITE, 28]]), 10, 10)!
    expect(signatureSimilarity(before, leftovers)).toBe(1)
    // só a salada sobrou: continua parecido (é uma parte do que lá estava)
    const onlySalad = plateSignature(photo([[GREEN, 8], [WHITE, 28]]), 10, 10)!
    expect(signatureSimilarity(before, onlySalad)).toBe(1)
  })

  it('outra refeição, com outras cores, não é parecida', () => {
    const berries = plateSignature(photo([[PURPLE, 12], [PINK, 12], [WHITE, 12]]), 10, 10)!
    expect(signatureSimilarity(before, berries)).toBe(0)
  })

  it('as mesmas cores, mas mais comida do que o prato cheio tinha, também não', () => {
    const bigger = plateSignature(photo([[BROWN, 30], [GREEN, 6]]), 10, 10)!
    // castanho: 30 contra 14 × 1,25 → só 17,5 cabem; (17,5 + 6) / 36
    expect(signatureSimilarity(before, bigger)).toBe(0.65)
    expect(askLeftovers({ gapMs: 30 * 60_000, similarity: 0.65 })).toBe(false)
  })

  it('quase sem cor (prato vazio, comida toda clara): as cores não dizem nada', () => {
    const empty = plateSignature(photo([[WHITE, 36]]), 10, 10)!
    expect(empty.chroma).toBe(0)
    expect(signatureSimilarity(before, empty)).toBeNull()
  })
})
