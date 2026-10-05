// Campos de uma app Connect IQ no treino do Garmin (ex.: a app da bicicleta
// de casa: «Distância 12,88 km, Vel. média 31 km/h, Pico de potência 186 W,
// Calorias 506 kcal»). Não vêm nos campos normais do intervals.icu: lêem-se
// do ficheiro FIT original, como «developer fields». Cada app dá os nomes que
// quer (e na língua que quer), por isso decide-se primeiro pelas unidades e só
// depois pelo nome. Sem supabase nem node.

export interface DevField {
  name: string
  units: string | null
  value: number
}

export interface CiqExtras {
  distance_km: number | null
  speed_kmh: number | null
  max_speed_kmh: number | null
  power_w: number | null
  peak_power_w: number | null
  calories: number | null
}

const MAX = /m[aá]x|pico|peak|top|best|melhor/i
const AVG = /m[eé]di|avg|average|mean/i
const norm = (u: string | null) => (u ?? '').trim().toLowerCase().replace(/\s+/g, '')
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const inRange = (n: number | null, min: number, max: number) => (n != null && n >= min && n <= max ? n : null)

export function ciqExtras(fields: DevField[]): CiqExtras {
  const usable = fields.filter((f) => Number.isFinite(f.value))
  const pick = (test: (f: DevField) => boolean, prefer?: RegExp) => {
    const found = usable.filter(test)
    return (prefer ? found.find((f) => prefer.test(f.name)) : undefined) ?? found[0] ?? null
  }

  // Distância: km (ou milhas) primeiro, metros só com «dist» no nome.
  const km = pick((f) => ['km'].includes(norm(f.units)) && !MAX.test(f.name), /dist/i)
  const mi = pick((f) => ['mi', 'mile', 'miles'].includes(norm(f.units)), /dist/i)
  const m = pick((f) => norm(f.units) === 'm' && /dist/i.test(f.name))
  const distance = km ? km.value : mi ? mi.value * 1.609 : m ? m.value / 1000 : null

  const speedUnit = (f: DevField) => ['km/h', 'kph', 'kmh', 'mph'].includes(norm(f.units))
  const kmh = (f: DevField | null) => (f ? (norm(f.units) === 'mph' ? f.value * 1.609 : f.value) : null)
  const speed = pick((f) => speedUnit(f) && !MAX.test(f.name), AVG)
  const maxSpeed = pick((f) => speedUnit(f) && MAX.test(f.name))

  const powerUnit = (f: DevField) => ['w', 'watt', 'watts'].includes(norm(f.units))
  const power = pick((f) => powerUnit(f) && !MAX.test(f.name) && !/ftp|limiar|threshold|normali/i.test(f.name), AVG)
  const peak = pick((f) => powerUnit(f) && MAX.test(f.name))

  const kcal = pick((f) => norm(f.units) === 'kcal' || (/calor/i.test(f.name) && !norm(f.units)))

  return {
    distance_km: inRange(distance != null ? round(distance, 2) : null, 0.1, 400),
    speed_kmh: inRange(speed ? round(kmh(speed)!) : null, 1, 120),
    max_speed_kmh: inRange(maxSpeed ? round(kmh(maxSpeed)!) : null, 1, 150),
    power_w: inRange(power ? Math.round(power.value) : null, 20, 700),
    peak_power_w: inRange(peak ? Math.round(peak.value) : null, 20, 3000),
    calories: inRange(kcal ? Math.round(kcal.value) : null, 1, 5000),
  }
}

export const hasCiq = (e: CiqExtras) => Object.values(e).some((v) => v != null)
