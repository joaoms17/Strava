import { describe, expect, it } from 'vitest'
import { Encoder, Profile } from '@garmin/fitsdk'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { ciqExtras, hasCiq } from '../api/_lib/rules/ciq'
import { fitDeveloperFields } from '../api/_lib/fit'

// Um ZIP com um ficheiro (deflate), como o Garmin às vezes entrega o FIT;
// tamanhos a 0 no cabeçalho local (vêm só no diretório central).
function zipOf(file: Uint8Array): Uint8Array {
  const data = new Uint8Array(deflateRawSync(file))
  const name = new TextEncoder().encode('a.fit')
  const local = new Uint8Array(30 + name.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(8, 8, true)
  lv.setUint16(26, name.length, true)
  local.set(name, 30)
  const central = new Uint8Array(46 + name.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(10, 8, true)
  cv.setUint32(20, data.length, true)
  cv.setUint32(24, file.length, true)
  cv.setUint16(28, name.length, true)
  cv.setUint32(42, 0, true)
  central.set(name, 46)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length + data.length, true)
  const out = new Uint8Array(local.length + data.length + central.length + end.length)
  out.set(local, 0)
  out.set(data, local.length)
  out.set(central, local.length + data.length)
  out.set(end, local.length + data.length + central.length)
  return out
}

// A app da bicicleta de casa (Connect IQ) do João, a 5/10: 25 min.
const FIELDS = [
  { name: 'Máquina', units: null, value: NaN },
  { name: 'Distância', units: 'km', value: 12.88 },
  { name: 'Distância (Metros)', units: 'm', value: 12881 },
  { name: 'Vel. Média', units: 'km/h', value: 31 },
  { name: 'Vel. Máxima', units: 'km/h', value: 41 },
  { name: 'Pico de Potência', units: 'W', value: 186 },
  { name: 'Calorias', units: 'kcal', value: 506 },
  { name: 'VO2Max (Est)', units: 'ml/kg/min', value: 34 },
]

describe('Connect IQ', () => {
  it('a app da bicicleta: distância, velocidades, pico de potência e calorias', () => {
    expect(ciqExtras(FIELDS)).toEqual({
      distance_km: 12.88,
      speed_kmh: 31,
      max_speed_kmh: 41,
      power_w: null, // só o pico: sem potência média
      peak_power_w: 186,
      calories: 506,
    })
  })

  it('em inglês, em metros e milhas; potência média', () => {
    expect(
      ciqExtras([
        { name: 'Distance', units: 'm', value: 20500 },
        { name: 'Avg Speed', units: 'mph', value: 18 },
        { name: 'Avg Power', units: 'W', value: 142 },
        { name: 'Max Power', units: 'W', value: 410 },
      ]),
    ).toMatchObject({ distance_km: 20.5, speed_kmh: 29, power_w: 142, peak_power_w: 410, calories: null })
    expect(hasCiq(ciqExtras([{ name: 'Gear', units: null, value: 3 }]))).toBe(false)
  })

  it('lê os campos da sessão de um ficheiro FIT (também comprimido)', () => {
    const devId = { developerDataIndex: 0, applicationId: Array(16).fill(1), applicationVersion: 1 }
    const fd = (n: number, fieldName: string, units: string) => ({
      developerDataIndex: 0,
      fieldDefinitionNumber: n,
      fitBaseTypeId: 136, // float32
      fieldName,
      units,
    })
    const descriptions = [fd(0, 'Distância', 'km'), fd(1, 'Vel. Média', 'km/h'), fd(2, 'Calorias', 'kcal')]
    const encoder = new Encoder({
      fieldDescriptions: Object.fromEntries(
        descriptions.map((d, i) => [i, { developerDataIdMesg: devId, fieldDescriptionMesg: d }]),
      ),
    })
    const start = new Date('2026-10-05T15:03:50Z')
    const onMesg = (num: number | undefined, mesg: object) => encoder.onMesg(num as number, mesg as never)
    onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin', product: 0, timeCreated: start, serialNumber: 1 })
    onMesg(Profile.MesgNum.DEVELOPER_DATA_ID, devId)
    for (const d of descriptions) onMesg(Profile.MesgNum.FIELD_DESCRIPTION, d)
    onMesg(Profile.MesgNum.SESSION, {
      timestamp: new Date('2026-10-05T15:28:50Z'),
      startTime: start,
      sport: 'cycling',
      totalElapsedTime: 1500,
      totalTimerTime: 1500,
      developerFields: { 0: 12.88, 1: 31, 2: 506 },
    })
    const bytes = encoder.close()
    const read = fitDeveloperFields(bytes)!
    expect(ciqExtras(read)).toMatchObject({ distance_km: 12.88, speed_kmh: 31, calories: 506 })
    expect(ciqExtras(fitDeveloperFields(new Uint8Array(gzipSync(bytes)))!)).toMatchObject({ distance_km: 12.88 })
    expect(fitDeveloperFields(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(ciqExtras(fitDeveloperFields(zipOf(bytes))!)).toMatchObject({ distance_km: 12.88, calories: 506 })
  })
})
