import { gunzipSync, inflateRawSync } from 'node:zlib'
import { Decoder, Stream } from '@garmin/fitsdk'
import type { DevField } from './rules/ciq.js'

// O primeiro ficheiro de um ZIP (o Garmin às vezes entrega o FIT assim),
// pelo diretório central (os tamanhos no cabeçalho local podem vir a 0).
export function firstZipEntry(zip: Uint8Array): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  for (let eocd = zip.length - 22; eocd >= Math.max(0, zip.length - 65_557); eocd--) {
    if (view.getUint32(eocd, true) !== 0x06054b50) continue
    const central = view.getUint32(eocd + 16, true)
    if (view.getUint32(central, true) !== 0x02014b50) return null
    const method = view.getUint16(central + 10, true)
    const size = view.getUint32(central + 20, true)
    const local = view.getUint32(central + 42, true)
    if (view.getUint32(local, true) !== 0x04034b50) return null
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = zip.subarray(start, start + size)
    if (method === 0) return data
    if (method === 8) return new Uint8Array(inflateRawSync(data))
    return null
  }
  return null
}

// Lê os campos das apps Connect IQ (developer fields) do resumo de um ficheiro
// FIT: a sessão; sem eles, a última volta; sem ela, o último registo (onde as
// apps costumam ir acumulando a distância). null quando não é um FIT.
export function fitDeveloperFields(bytes: Uint8Array): DevField[] | null {
  let data = bytes
  // O intervals.icu pode entregar o ficheiro comprimido (gzip ou zip).
  if (data[0] === 0x1f && data[1] === 0x8b) data = new Uint8Array(gunzipSync(data))
  else if (data[0] === 0x50 && data[1] === 0x4b) data = firstZipEntry(data) ?? new Uint8Array()
  const stream = Stream.fromByteArray(Array.from(data))
  if (data.length < 12 || !Decoder.isFIT(stream)) return null
  const decoder = new Decoder(stream)
  const { messages } = decoder.read({ convertDateTimesToDates: false, includeUnknownData: false })
  return summaryDevFields(messages as FitMessages)
}

export interface FitMessages {
  fieldDescriptionMesgs?: unknown[]
  sessionMesgs?: unknown[]
  lapMesgs?: unknown[]
  recordMesgs?: unknown[]
}

type DevMesg = { developerFields?: Record<string, unknown>; totalTimerTime?: unknown; totalElapsedTime?: unknown }

const POWER_UNITS = ['w', 'watt', 'watts']
const PEAK = /max|peak|pico|m[aá]x/i

// O resumo das apps: a sessão manda. Sem ela, os valores acumulados
// (distância, calorias) são os da última volta ou do último registo, mas a
// potência média é a média dos registos (ou das voltas, pesadas pelo tempo),
// não a do fim do treino (T19).
export function summaryDevFields(messages: FitMessages): DevField[] {
  const descriptions = new Map<number, { name: string; units: string | null }>()
  for (const d of (messages.fieldDescriptionMesgs ?? []) as Record<string, unknown>[]) {
    if (typeof d.key !== 'number') continue
    descriptions.set(d.key, {
      name: String(d.fieldName ?? ''),
      units: d.units != null ? String(d.units) : null,
    })
  }
  if (descriptions.size === 0) return []
  const withDev = (list: unknown) =>
    ((list ?? []) as DevMesg[]).filter((m) => m.developerFields && Object.keys(m.developerFields).length > 0)
  const sessions = withDev(messages.sessionMesgs)
  const laps = withDev(messages.lapMesgs)
  const records = withDev(messages.recordMesgs)
  const source = sessions.at(-1) ?? laps.at(-1) ?? records.at(-1)
  if (!source?.developerFields) return []
  const valueOf = (m: DevMesg, key: string): number | null => {
    const raw = m.developerFields?.[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const averagePower = (key: string): number | null => {
    const fromRecords = records.map((r) => valueOf(r, key)).filter((v): v is number => v != null)
    if (fromRecords.length) return fromRecords.reduce((a, b) => a + b, 0) / fromRecords.length
    let total = 0
    let weight = 0
    for (const lap of laps) {
      const v = valueOf(lap, key)
      if (v == null) continue
      const t = Number(lap.totalTimerTime ?? lap.totalElapsedTime)
      const w = Number.isFinite(t) && t > 0 ? t : 1
      total += v * w
      weight += w
    }
    return weight > 0 ? total / weight : null
  }
  const fromSession = sessions.length > 0
  const out: DevField[] = []
  for (const key of Object.keys(source.developerFields)) {
    const desc = descriptions.get(Number(key))
    let value = valueOf(source, key)
    if (!desc || value == null) continue
    const unit = (desc.units ?? '').trim().toLowerCase()
    if (!fromSession && POWER_UNITS.includes(unit) && !PEAK.test(desc.name)) value = averagePower(key) ?? value
    out.push({ name: desc.name, units: desc.units, value })
  }
  return out
}
