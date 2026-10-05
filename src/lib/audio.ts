// Gravar um áudio curto (o treino dito) e passá-lo a WAV de 16 kHz mono, o
// formato que a IA aceita sempre: o iPhone grava em MP4/AAC e o Android em
// WebM/Opus, e nem todos os modelos aceitam esses.

export const MAX_AUDIO_SECONDS = 60
const RATE = 16_000

export function canRecord(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

export interface Recording {
  stop: () => Promise<Blob>
  cancel: () => void
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop())
  recorder.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stopTracks()
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' }))
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = stopTracks
      if (recorder.state !== 'inactive') recorder.stop()
      else stopTracks()
    },
  }
}

// O áudio gravado → WAV 16 kHz mono (PCM 16 bits) em base64, no máximo 60 s.
export async function toWavBase64(blob: Blob): Promise<string> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
  const seconds = Math.min(decoded.duration, MAX_AUDIO_SECONDS)
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * RATE)), RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return bytesToBase64(encodeWav(rendered.getChannelData(0), RATE))
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // tamanho do bloco fmt
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes por segundo
  view.setUint16(32, 2, true) // bytes por amostra
  view.setUint16(34, 16, true) // bits
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
