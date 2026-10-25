// «O teu mês» em imagem (1080 × 1350, PNG), com as cores e letras do
// relatório da semana; partilha com o ficheiro ou, sem isso, descarrega.
import type { MonthSummary } from '../../api/_lib/rules/mes'
import { ACCENT, BG, CARD, DIM, FONT, H, INK, W, fmt, fmt1, shareCanvas, wrap } from './week-report'

const signed = (n: number, unit: string) =>
  Math.abs(n) < 0.05 ? 'igual' : `${n < 0 ? '−' : '+'}${fmt1(Math.abs(n))} ${unit}`

export function drawMonthReport(s: MonthSummary): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = ACCENT
  ctx.font = `700 34px ${FONT}`
  ctx.fillText('O MEU MÊS', 80, 130)
  ctx.fillStyle = INK
  ctx.font = `800 80px ${FONT}`
  const title = s.label.charAt(0).toUpperCase() + s.label.slice(1)
  ctx.fillText(title, 80, 225)

  const tiles: [string, string, string][] = [
    ['Peso médio', s.kgChange != null ? signed(s.kgChange, 'kg') : '—', 'no mês'],
    ['Cintura', s.cmChange != null ? signed(s.cmChange, 'cm') : '—', s.cmChange != null ? 'entre medições' : 'sem medições'],
    ['Treinos', String(s.workouts), `${fmt(s.minutes)} min`],
    ['Kcal a treinar', s.workoutKcal ? fmt(s.workoutKcal) : '—', 'no mês'],
    ['Dias no alvo', `${s.daysOnTarget}`, `de ${s.countedDays} completos`],
    ['Melhor sequência', `${s.streak} ${s.streak === 1 ? 'dia' : 'dias'}`, 'no alvo seguidos'],
  ]
  const colW = (W - 160 - 30) / 2
  const tileH = 180
  const top = 290
  tiles.forEach(([label, value, sub], i) => {
    const x = 80 + (i % 2) * (colW + 30)
    const ty = top + Math.floor(i / 2) * (tileH + 26)
    ctx.fillStyle = CARD
    ctx.beginPath()
    ctx.roundRect(x, ty, colW, tileH, 28)
    ctx.fill()
    ctx.fillStyle = DIM
    ctx.font = `600 30px ${FONT}`
    ctx.fillText(label, x + 34, ty + 54)
    ctx.fillStyle = INK
    ctx.font = `800 56px ${FONT}`
    ctx.fillText(value, x + 34, ty + 120)
    ctx.fillStyle = DIM
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(sub, x + 34, ty + 160)
  })

  let y = top + 3 * (tileH + 26) + 20
  const lines: [string, string][] = []
  if (s.topMeal) lines.push(['Mais repetida', `${s.topMeal.name} (${s.topMeal.count}×)`])
  if (s.daysAboveSpent > 0) lines.push(['Acima do gasto', `${s.daysAboveSpent} ${s.daysAboveSpent === 1 ? 'dia' : 'dias'} (comeste mais do que gastaste)`])
  if (s.bestWeek) lines.push(['Melhor semana', `${s.bestWeek.label} · ${s.bestWeek.onTarget} dias no alvo`])
  for (const [label, text] of lines) {
    ctx.fillStyle = DIM
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(label, 80, (y += 40))
    ctx.fillStyle = INK
    ctx.font = `700 36px ${FONT}`
    const first = wrap(ctx, text, W - 160)[0] ?? ''
    ctx.fillText(first.length < text.length ? `${first}…` : first, 80, (y += 46))
    y += 10
  }
  if (s.projection) {
    ctx.fillStyle = ACCENT
    ctx.font = `700 36px ${FONT}`
    for (const line of wrap(ctx, s.projection, W - 160).slice(0, 2)) ctx.fillText(line, 80, (y += 52))
  }
  return canvas
}

export function shareMonthReport(s: MonthSummary) {
  return shareCanvas(drawMonthReport(s), `mes-${s.month}.png`, `O meu mês · ${s.label}`)
}
