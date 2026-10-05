import { describe, expect, it } from 'vitest'
import {
  isEmptyStravaCopy,
  mapActivity,
  mapIcuType,
  mapWellness,
  mergeDailyHealth,
  syncMatch,
  syncedAgo,
  historyWindows,
  retryableImportError,
  splitWindow,
  windowDays,
} from '../api/_lib/rules/intervals'

// Fase 7 — intervals.icu: mapeamento defensivo das atividades e do bem-estar.
const garminRide = {
  id: 'i123456',
  name: 'Ciclismo indoor',
  type: 'VirtualRide',
  start_date: '2026-09-29T06:10:00Z',
  start_date_local: '2026-09-29T07:10:00',
  moving_time: 2700,
  elapsed_time: 2760,
  distance: 0,
  average_heartrate: 132.4,
  max_heartrate: 141,
  icu_average_watts: 139,
  icu_weighted_avg_watts: 142,
  average_cadence: 88.2,
  calories: 520,
  icu_training_load: 48,
  trainer: true,
  source: 'GARMIN_CONNECT',
}

describe('tipos', () => {
  it('Ride, VirtualRide e trainer → bicicleta; WeightTraining → ginásio; o resto → outro', () => {
    expect(mapIcuType('Ride', false).type).toBe('bike')
    expect(mapIcuType('VirtualRide', null).type).toBe('bike')
    expect(mapIcuType('Workout', true).type).toBe('strength')
    expect(mapIcuType('WeightTraining', false).type).toBe('strength')
    expect(mapIcuType('Walk', false)).toEqual({ type: 'other', sport: 'caminhada' })
    expect(mapIcuType('Swim', false)).toEqual({ type: 'other', sport: 'natacao' })
    expect(mapIcuType('Kayaking', false)).toEqual({ type: 'other', sport: 'outro' })
    expect(mapIcuType(null, true).type).toBe('bike')
  })
})

describe('atividade', () => {
  it('bicicleta do Garmin: minutos em movimento, watts do dispositivo, batimentos', () => {
    expect(mapActivity(garminRide)).toMatchObject({
      external_id: 'i123456',
      type: 'bike',
      minutes: 45,
      watts: 139,
      watts_source: 'device',
      np_w: 142,
      avg_hr: 132,
      max_hr: 141,
      cadence: 88,
      kcal_device: 520,
      distance_km: null,
      started_at: '2026-09-29T06:10:00.000Z',
    })
  })

  it('sem watts nem batimentos ficam a null (nunca zeros)', () => {
    const walk = mapActivity({ id: 7, type: 'Walk', moving_time: 2400, elapsed_time: 2500, distance: 3200 })
    expect(walk).toMatchObject({ type: 'other', sport: 'caminhada', minutes: 40, watts: null, avg_hr: null, distance_km: 3.2 })
  })

  it('ginásio conta o tempo total', () => {
    expect(mapActivity({ id: 9, type: 'WeightTraining', moving_time: 1500, elapsed_time: 3000 }).minutes).toBe(50)
  })

  it('valores impossíveis não entram', () => {
    const odd = mapActivity({ ...garminRide, average_heartrate: 20, icu_average_watts: 1500 })
    expect(odd.avg_hr).toBeNull()
    expect(odd.watts).toBeNull()
  })

  it('cópias vazias do Strava ficam de fora', () => {
    expect(isEmptyStravaCopy({ id: 1, source: 'STRAVA' })).toBe(true)
    expect(isEmptyStravaCopy(garminRide)).toBe(false)
  })
})

describe('fusão silenciosa', () => {
  const habitual = { id: 'fav', type: 'bike' as const, date: '2026-09-29', minutes: 45, started_at: '2026-09-29T06:12:00Z' }

  it('junta à Bicicleta habitual (início ±15 min, duração ±5 %)', () => {
    const a = { type: 'bike' as const, date: '2026-09-29', minutes: 44, started_at: '2026-09-29T06:10:00Z' }
    expect(syncMatch(a, [habitual])?.id).toBe('fav')
  })

  it('não junta com início a mais de 15 min ou duração muito diferente', () => {
    expect(syncMatch({ type: 'bike', date: '2026-09-29', minutes: 45, started_at: '2026-09-29T06:40:00Z' }, [habitual])).toBeNull()
    expect(syncMatch({ type: 'bike', date: '2026-09-29', minutes: 55, started_at: '2026-09-29T06:10:00Z' }, [habitual])).toBeNull()
  })
})

describe('bem-estar', () => {
  it('peso, FC em repouso, sono em minutos e passos', () => {
    expect(mapWellness({ id: '2026-09-29', weight: 84.63, restingHR: 52, sleepSecs: 25200, steps: 8421 })).toEqual({
      date: '2026-09-29',
      weightKg: 84.6,
      bodyFatPct: null,
      restingHr: 52,
      sleepMinutes: 420,
      sleepScore: null,
      sleepQuality: null,
      hrv: null,
      avgSleepHr: null,
      steps: 8421,
    })
  })

  it('sono do Garmin: pontuação, qualidade, HRV e FC durante o sono', () => {
    expect(
      mapWellness({ id: '2026-09-29', sleepSecs: 26100, sleepScore: 78, sleepQuality: 2, hrv: 47.64, avgSleepingHR: 54 }),
    ).toMatchObject({ sleepMinutes: 435, sleepScore: 78, sleepQuality: 2, hrv: 47.6, avgSleepHr: 54 })
    expect(mapWellness({ id: '2026-09-29', sleepScore: 0, sleepQuality: 7, hrv: 900 })).toMatchObject({
      sleepScore: null,
      sleepQuality: null,
      hrv: null,
    })
  })

  it('valores em falta ou impossíveis ficam a null', () => {
    expect(mapWellness({ id: '2026-09-29', weight: 0, sleepSecs: null })).toMatchObject({ weightKg: null, sleepMinutes: null })
  })

  it('«sincronizado há …»', () => {
    const now = new Date('2026-09-29T10:00:00Z')
    expect(syncedAgo('2026-09-29T09:56:00Z', now)).toBe('há 4 min')
    expect(syncedAgo('2026-09-29T07:00:00Z', now)).toBe('há 3 h')
    expect(syncedAgo(null, now)).toBeNull()
  })
})

describe('importar o histórico', () => {
  it('blocos de 30 dias, do mais recente para trás, sem buracos nem sobreposições', () => {
    const w = historyWindows('2026-06-01', '2026-09-29')
    expect(w[0]).toEqual({ oldest: '2026-08-31', newest: '2026-09-30' })
    expect(w[1]).toEqual({ oldest: '2026-07-31', newest: '2026-08-30' })
    expect(w[w.length - 1]!.oldest).toBe('2026-06-01')
    for (let i = 1; i < w.length; i++) expect(w[i]!.newest).toBe(
      new Date(Date.parse(`${w[i - 1]!.oldest}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
    )
    for (const x of w) expect(Date.parse(x.newest) - Date.parse(x.oldest)).toBeLessThanOrEqual(31 * 86_400_000)
  })
})

describe('importação resistente', () => {
  it('um bloco divide-se ao meio sem buracos', () => {
    const w = { oldest: '2025-12-26', newest: '2026-01-25' }
    expect(windowDays(w)).toBe(31)
    const [newer, older] = splitWindow(w)
    expect(newer).toEqual({ oldest: '2026-01-11', newest: '2026-01-25' })
    expect(older).toEqual({ oldest: '2025-12-26', newest: '2026-01-10' })
    expect(windowDays(newer) + windowDays(older)).toBe(31)
  })

  it('«Load failed» e erros do servidor repetem-se; uma chave errada não', () => {
    expect(retryableImportError(new TypeError('Load failed'))).toBe(true)
    expect(retryableImportError(new Error('Erro 504'))).toBe(true)
    expect(retryableImportError(new Error('O intervals.icu respondeu com erro (429).'))).toBe(true)
    expect(retryableImportError(new Error('A chave do intervals.icu não é válida.'))).toBe(false)
    expect(retryableImportError(new Error('Pedido inválido.'))).toBe(false)
  })
})

describe('mais desportos', () => {
  it('corrida, remo, futebol, ténis, yoga e aulas têm o seu desporto', () => {
    expect(mapIcuType('Run', false)).toEqual({ type: 'other', sport: 'corrida' })
    expect(mapIcuType('VirtualRun', false)).toEqual({ type: 'other', sport: 'corrida' })
    expect(mapIcuType('Rowing', false)).toEqual({ type: 'other', sport: 'remo' })
    expect(mapIcuType('Soccer', false)).toEqual({ type: 'other', sport: 'futebol' })
    expect(mapIcuType('Tennis', false)).toEqual({ type: 'other', sport: 'tenis' })
    expect(mapIcuType('Yoga', false)).toEqual({ type: 'other', sport: 'yoga' })
    expect(mapIcuType('HighIntensityIntervalTraining', false)).toEqual({ type: 'other', sport: 'aula' })
  })
})

describe('passos, sono e FC em repouso do dia', () => {
  it('a sincronização da madrugada já não fica para sempre: os passos sobem', () => {
    const early = mergeDailyHealth(null, { steps: 38, sleepMinutes: 410, restingHr: 57 })
    expect(early).toEqual({ steps: 38, sleep_minutes: 410, resting_hr: 57, source: 'intervals' })
    expect(mergeDailyHealth(early, { steps: 9120, sleepMinutes: 415, restingHr: 55 })).toEqual({
      steps: 9120,
      sleep_minutes: 415,
      resting_hr: 55,
      source: 'intervals',
    })
    // Um valor mais baixo ou em falta não apaga o que já havia.
    expect(mergeDailyHealth({ steps: 9120, sleep_minutes: 415, resting_hr: 55, source: 'intervals' }, { steps: 8000, sleepMinutes: null, restingHr: null })).toEqual({
      steps: 9120,
      sleep_minutes: 415,
      resting_hr: 55,
      source: 'intervals',
    })
  })

  it('o Atalho do iPhone manda nas horas e na FC que preencheu', () => {
    expect(mergeDailyHealth({ steps: 5000, sleep_minutes: 400, resting_hr: null, source: 'shortcut' }, { steps: 7000, sleepMinutes: 380, restingHr: 54 })).toEqual({
      steps: 7000,
      sleep_minutes: 400,
      resting_hr: 54,
      source: 'shortcut',
    })
  })
})
