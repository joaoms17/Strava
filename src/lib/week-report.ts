// Relatório da semana em imagem (1080 × 1350, PNG), desenhado no telemóvel
// com o canvas, para partilhar (WhatsApp, guardar nas fotos) sem servidor.

export interface WeekReport {
  range: string // «5–11 out»
  sentence: string | null // a frase da semana do Balanço
  eaten: number | null // média por dia
  plan: number | null // alvo médio
  out: number | null // gasto médio
  protein: number | null
  proteinTarget: number
  sessions: number
  minutes: number
  rateKgWeek: number | null
  completeDays: number // dias contados nesta semana
}

const W = 1080
const H = 1350
const INK = '#141414'
const DIM = '#6b6660'
const BG = '#f1eee8'
const CARD = '#ffffff'
const ACCENT = '#d9480f'
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

export function drawWeekReport(r: WeekReport): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = ACCENT
  ctx.font = `700 34px ${FONT}`
  ctx.fillText('A MINHA SEMANA', 80, 130)
  ctx.fillStyle = INK
  ctx.font = `800 88px ${FONT}`
  ctx.fillText(r.range, 80, 230)

  let y = 300
  if (r.sentence) {
    ctx.font = `600 40px ${FONT}`
    for (const line of wrap(ctx, r.sentence, W - 160).slice(0, 4)) {
      ctx.fillText(line, 80, (y += 54))
    }
    y += 30
  }

  const tiles: [string, string, string][] = [
    ['Comi por dia', r.eaten != null ? `${fmt(r.eaten)} kcal` : '—', r.plan != null ? `alvo ${fmt(r.plan)}` : ''],
    ['Gastei por dia', r.out != null ? `${fmt(r.out)} kcal` : '—', r.eaten != null && r.out != null ? `${r.eaten <= r.out ? 'défice' : 'excedente'} ${fmt(Math.abs(r.out - r.eaten))}` : ''],
    ['Proteína', r.protein != null ? `${fmt(r.protein)} g` : '—', `meta ${fmt(r.proteinTarget)} g`],
    ['Treino', `${r.sessions} ${r.sessions === 1 ? 'sessão' : 'sessões'}`, `${fmt(r.minutes)} min`],
    [
      'Peso médio',
      r.rateKgWeek == null ? '—' : Math.abs(r.rateKgWeek) < 0.05 ? 'estável' : `${r.rateKgWeek < 0 ? '−' : '+'}${fmt1(Math.abs(r.rateKgWeek))} kg`,
      r.rateKgWeek == null ? '' : 'por semana',
    ],
    ['Dias registados', `${r.completeDays} de 7`, ''],
  ]
  const colW = (W - 160 - 30) / 2
  const tileH = 190
  tiles.forEach(([label, value, sub], i) => {
    const x = 80 + (i % 2) * (colW + 30)
    const ty = y + Math.floor(i / 2) * (tileH + 30)
    ctx.fillStyle = CARD
    ctx.beginPath()
    ctx.roundRect(x, ty, colW, tileH, 28)
    ctx.fill()
    ctx.fillStyle = DIM
    ctx.font = `600 30px ${FONT}`
    ctx.fillText(label, x + 34, ty + 56)
    ctx.fillStyle = INK
    ctx.font = `800 56px ${FONT}`
    ctx.fillText(value, x + 34, ty + 124)
    ctx.fillStyle = DIM
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(sub, x + 34, ty + 166)
  })
  return canvas
}

// Partilha (folha do iPhone) ou, sem isso, descarrega o PNG.
export async function shareWeekReport(r: WeekReport): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canvas = drawWeekReport(r)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Não consegui criar a imagem.')
  const file = new File([blob], `semana-${r.range.replace(/\s+/g, '-')}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `A minha semana · ${r.range}` })
      return 'shared'
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
  return 'downloaded'
}
