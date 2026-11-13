import { describe, expect, it } from 'vitest'
import {
  findMergeCandidate,
  joinPatch,
  kcalAfterMerge,
  pickJoinTarget,
  pickWatts,
  wattsChain,
} from '../api/_lib/rules/treino'
import { duplicatePairs, possibleDuplicates } from '../api/_lib/rules/sessoes'
import { syncMatch } from '../api/_lib/rules/intervals'
import { saveClientId, saveDone } from '../src/lib/client-id'

// Auditoria de novembro: deduplicação por sobreposição (T1), watts supostos
// só sem calorias do relógio (T2), o mesmo desporto nos «outros» (T4), as
// contas de um «outro» junto pelo relógio (T9) e o client_id estável (T24).

describe('T1 · possível duplicado por sobreposição no tempo', () => {
  const base = { date: '2026-11-10', sport: null, raw: null }
  const gymApp = { ...base, id: 'app', type: 'strength' as const, source: 'manual', external_id: null, started_at: '2026-11-10T18:00:00Z', minutes: 62 }
  const gymWatch = { ...base, id: 'rel', type: 'strength' as const, source: 'intervals', external_id: 'i9', started_at: '2026-11-10T18:03:00Z', minutes: 55 }

  it('ginásio do cronómetro (62 min, 18:00) e do relógio (55 min, 18:03): avisa', () => {
    expect([...possibleDuplicates([gymApp, gymWatch])].sort()).toEqual(['app', 'rel'])
  })

  it('bicicleta habitual de 45 min e a mesma volta no relógio com 52: avisa', () => {
    const habitual = { ...base, id: 'h', type: 'bike' as const, source: 'manual', external_id: null, started_at: '2026-11-10T07:05:00Z', minutes: 45 }
    const ride = { ...base, id: 'r', type: 'bike' as const, source: 'intervals', external_id: 'i1', started_at: '2026-11-10T07:00:00Z', minutes: 52 }
    expect(possibleDuplicates([habitual, ride]).size).toBe(2)
  })

  it('relógio partido em 20 + 25 e «Já fiz» de 45 sem hora: avisa nos três', () => {
    const a = { ...base, id: 'p1', type: 'bike' as const, source: 'intervals', external_id: 'i1', started_at: '2026-11-10T07:00:00Z', minutes: 20 }
    const b = { ...base, id: 'p2', type: 'bike' as const, source: 'intervals', external_id: 'i2', started_at: '2026-11-10T07:22:00Z', minutes: 25 }
    const jaFiz = { ...base, id: 'mao', type: 'bike' as const, source: 'manual', external_id: null, started_at: '2026-11-10T20:15:00Z', minutes: 45, raw: { hora_estimada: true } }
    expect([...possibleDuplicates([a, b, jaFiz])].sort()).toEqual(['mao', 'p1', 'p2'])
  })

  it('não avisa: horas conhecidas sem sobreposição e duração diferente, dois do relógio, ou «Não, é outro»', () => {
    const later = { ...gymApp, started_at: '2026-11-10T20:00:00Z', minutes: 30 }
    expect(possibleDuplicates([later, gymWatch]).size).toBe(0)
    expect(possibleDuplicates([{ ...gymApp, external_id: 'i8', source: 'intervals' }, gymWatch]).size).toBe(0)
    expect(possibleDuplicates([{ ...gymApp, raw: { outro_treino: true } }, gymWatch]).size).toBe(0)
  })

  it('«Juntar os dois»: os pares, com o do relógio em segundo', () => {
    expect(duplicatePairs([gymWatch, gymApp]).map(([a, b]) => [a.id, b.id])).toEqual([['app', 'rel']])
    const a = { ...base, id: 'p1', type: 'bike' as const, source: 'intervals', external_id: 'i1', started_at: '2026-11-10T07:00:00Z', minutes: 20 }
    const b = { ...base, id: 'p2', type: 'bike' as const, source: 'intervals', external_id: 'i2', started_at: '2026-11-10T07:22:00Z', minutes: 25 }
    const jaFiz = { ...base, id: 'mao', type: 'bike' as const, source: 'manual', external_id: null, started_at: '2026-11-10T20:15:00Z', minutes: 45, raw: { hora_estimada: true } }
    expect(duplicatePairs([a, b, jaFiz]).map(([x, y]) => `${x.id}+${y.id}`)).toEqual(['mao+p1', 'mao+p2'])
  })

  it('«É este treino?» pergunta quando os intervalos se sobrepõem, mesmo com durações diferentes', () => {
    const session = { id: 'rel', type: 'strength' as const, date: '2026-11-10', minutes: 55, started_at: '2026-11-10T18:03:00Z' }
    const draft = { type: 'strength' as const, date: '2026-11-10', minutes: 62, started_at: '2026-11-10T18:00:00Z' }
    expect(findMergeCandidate(draft, [session])?.id).toBe('rel')
    expect(findMergeCandidate({ ...draft, started_at: '2026-11-10T20:00:00Z' }, [session])).toBeNull()
  })
})

describe('T1 · «Juntar os dois»', () => {
  const watch = {
    id: 'rel',
    type: 'strength' as const,
    source: 'intervals',
    external_id: 'i9' as string | null,
    started_at: '2026-11-10T18:03:00Z',
    minutes: 55,
    watts: null as number | null,
    watts_source: null as string | null,
    kcal_device: 310 as number | null,
    avg_hr: 120 as number | null,
    name: 'Treino de força',
    favorite_id: null as string | null,
    note: null as string | null,
    raw: null,
    deleted_at: null as string | null,
  }
  const manual = {
    ...watch,
    id: 'app',
    source: 'manual',
    external_id: null as string | null,
    started_at: '2026-11-10T18:00:00Z',
    minutes: 62,
    kcal_device: null as number | null,
    avg_hr: null as number | null,
    name: 'Pernas A',
    favorite_id: 'fav-pernas' as string | null,
    note: 'Joelho bem' as string | null,
  }

  it('fica o do relógio, qualquer que seja a ordem', () => {
    expect(pickJoinTarget(manual, watch)).toMatchObject({ keep: { id: 'rel' }, drop: { id: 'app' } })
    expect(pickJoinTarget(watch, manual)).toMatchObject({ keep: { id: 'rel' }, drop: { id: 'app' } })
  })

  it('recusa o mesmo, tipos diferentes, dois do relógio ou um apagado', () => {
    expect(pickJoinTarget(watch, watch)).toHaveProperty('error')
    expect(pickJoinTarget(watch, { ...manual, type: 'bike' as never })).toHaveProperty('error')
    expect(pickJoinTarget(watch, { ...manual, external_id: 'i10' })).toHaveProperty('error')
    expect(pickJoinTarget(watch, { ...manual, deleted_at: '2026-11-10T20:00:00Z' })).toHaveProperty('error')
  })

  it('passa o teu treino e a nota; ficam a hora, os minutos e as calorias do relógio', () => {
    const { patch, filled } = joinPatch(watch, manual)
    expect(patch).toMatchObject({ favorite_id: 'fav-pernas', name: 'Pernas A', note: 'Joelho bem' })
    expect(patch).not.toHaveProperty('minutes')
    expect(patch).not.toHaveProperty('started_at')
    expect(patch).not.toHaveProperty('kcal_device')
    expect(filled).toContain('favorite_id')
  })

  it('o do relógio sem calorias ganha as do outro', () => {
    expect(joinPatch({ ...watch, kcal_device: null }, { ...manual, kcal_device: 280 }).patch).toMatchObject({ kcal_device: 280 })
  })

  it('bicicleta: os watts confirmados do registo à mão entram no do relógio sem potência', () => {
    const ride = { ...watch, kcal_device: 520 }
    const habitual = { ...manual, watts: 140, watts_source: 'favorite', favorite_id: null, note: null }
    expect(joinPatch(ride, habitual).patch).toMatchObject({ watts: 140, watts_source: 'favorite' })
    // Os supostos («≈ da última sessão») não passam.
    expect(joinPatch(ride, { ...habitual, watts_source: 'prefill' }).patch).not.toHaveProperty('watts')
  })
})

describe('T2 · watts supostos só sem calorias do relógio', () => {
  it('com calorias do relógio e sem potência não se supõem watts', () => {
    expect(pickWatts({ lastConfirmed: 140, deviceCalories: 450 })).toEqual({ watts: null, source: null })
    expect(pickWatts({ lastConfirmed: 140, deviceCalories: null })).toEqual({ watts: 140, source: 'prefill' })
    // Watts a sério continuam a mandar.
    expect(pickWatts({ manual: 150, lastConfirmed: 140, deviceCalories: 450 })).toEqual({ watts: 150, source: 'manual' })
  })

  it('a cadeia do pedido: origem dita, à mão ou do favorito', () => {
    expect(pickWatts(wattsChain({ watts: 150 }))).toEqual({ watts: 150, source: 'manual' })
    expect(pickWatts(wattsChain({ watts: 140, favoriteWatts: 140 }))).toEqual({ watts: 140, source: 'favorite' })
    expect(pickWatts(wattsChain({ watts: 160, wattsSource: 'console', favoriteWatts: 140 }))).toEqual({ watts: 160, source: 'console' })
    expect(pickWatts(wattsChain({ favoriteWatts: 140 }))).toEqual({ watts: 140, source: 'favorite' })
    expect(pickWatts(wattsChain({ watts: 140, wattsSource: 'prefill', deviceCalories: 450 }))).toEqual({ watts: null, source: null })
  })

  it('uma bicicleta com os watts supostos ganha as calorias do relógio ao juntar', () => {
    const target = { type: 'bike' as const, minutes: 45, watts: 140, watts_source: 'prefill', kcal_device: null }
    expect(kcalAfterMerge(target, { kcal_device: 450 })).toEqual({
      watts: null,
      watts_source: null,
      kcal_est: 450,
      kcal_rule: 'device',
      kcal_estimated: false,
    })
    // Com watts confirmados, as calorias do relógio não mudam as contas.
    expect(kcalAfterMerge({ ...target, watts_source: 'favorite' }, { kcal_device: 450 })).toBeNull()
    // Watts medidos que chegam: pela potência.
    expect(kcalAfterMerge({ ...target, watts: null, watts_source: null }, { watts: 150, watts_source: 'device' })).toMatchObject({
      kcal_est: 405,
      kcal_rule: 'watts',
    })
  })
})

describe('T4 · nos «outros», o mesmo desporto', () => {
  it('o pilates dito não se junta à caminhada do relógio', () => {
    const pilates = {
      id: 'p',
      type: 'other' as const,
      date: '2026-11-10',
      minutes: 60,
      started_at: '2026-11-10T19:00:00Z',
      start_guessed: true,
      sport: 'pilates' as string | null,
      raw: null as unknown,
    }
    const walk = { type: 'other' as const, date: '2026-11-10', minutes: 58, started_at: '2026-11-10T08:00:00Z', sport: 'caminhada' }
    expect(syncMatch(walk, [pilates])).toBeNull()
    expect(syncMatch({ ...walk, sport: 'pilates' }, [pilates])?.id).toBe('p')
    // O desporto guardado em raw.sport também conta.
    expect(syncMatch(walk, [{ ...pilates, sport: null, raw: { sport: 'caminhada' } }])?.id).toBe('p')
  })

  it('«É este treino?» também', () => {
    const walk = { id: 'w', type: 'other' as const, date: '2026-11-10', minutes: 58, started_at: null, sport: 'caminhada' }
    const draft = { type: 'other' as const, date: '2026-11-10', minutes: 60, started_at: null }
    expect(findMergeCandidate({ ...draft, sport: 'pilates' }, [walk])).toBeNull()
    expect(findMergeCandidate({ ...draft, sport: 'caminhada' }, [walk])?.id).toBe('w')
  })
})

describe('T9 · um «outro» junto ao relógio refaz as kcal', () => {
  it('caminhada dita (150 estimadas) + relógio (320): 70 % das do relógio', () => {
    const walk = { type: 'other' as const, minutes: 50, watts: null, watts_source: null, kcal_device: null, sport: 'caminhada' }
    expect(kcalAfterMerge(walk, { kcal_device: 320 })).toEqual({ kcal_est: 224, kcal_rule: 'device_x0.7', kcal_estimated: false })
    expect(kcalAfterMerge(walk, { avg_hr: 110 })).toBeNull()
  })

  it('ginásio: as calorias do relógio por inteiro', () => {
    const gym = { type: 'strength' as const, minutes: 50, watts: null, watts_source: null, kcal_device: null }
    expect(kcalAfterMerge(gym, { kcal_device: 300 })).toMatchObject({ kcal_est: 300, kcal_rule: 'device' })
    expect(kcalAfterMerge(gym, { kcal_device: 0 })).toBeNull()
  })
})

describe('T24 · client_id estável por gravação', () => {
  it('o mesmo pedido repetido leva o mesmo id até gravar; depois é outro', () => {
    const body = { type: 'bike', minutes: 45, favorite_id: 'f' }
    const first = saveClientId(body, 1_000)
    expect(saveClientId({ ...body }, 2_000).id).toBe(first.id)
    expect(saveClientId({ ...body, minutes: 46 }, 2_000).id).not.toBe(first.id)
    saveDone(first.key)
    expect(saveClientId(body, 3_000).id).not.toBe(first.id)
  })

  it('passados 10 minutos, um id novo', () => {
    const body = { type: 'other', minutes: 30 }
    const first = saveClientId(body, 0)
    expect(saveClientId(body, 11 * 60_000).id).not.toBe(first.id)
  })
})
