import { useId, useState, type ReactNode } from 'react'
import { DefaultZIndexes, ZIndexLayer, usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'
import { useThemeColors, type ThemeColors } from '../../lib/colors'
import { fmtDayMonth, fmtInt } from '../../lib/format'
import { dateTicks, dayNum, fromDayNum, labelWidth, placeLabels, type Box } from '../../../api/_lib/rules/graficos'
import type { Mark } from '../../../api/_lib/rules/leituras'

// O kit dos gráficos do Corpo e do Balanço: o cartão (o nome pequeno em
// cima, a frase com os números como título), os eixos com poucas marcas, a
// dica, a legenda, os marcos com rótulos que não se sobrepõem e o estado de
// «poucos dados». As cores vêm só daqui, dos tokens do tema (index.css).

// --- Cores por função ------------------------------------------------------

export interface ChartColors {
  dark: boolean // o tema escuro (alguns pesos de opacidade mudam)
  ink: string
  dim: string
  grid: string
  surface: string
  surface2: string
  weight: string // Corpo (peso e cintura)
  eat: string
  burn: string // gasto
  attn: string // acima do alvo
  ok: string
  bike: string
  gym: string
  health: string // relógio
  onOk: string // o texto em cima do verde (o que tiver mais contraste)
}

// Contraste WCAG entre duas cores #rrggbb.
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.5
  const n = parseInt(m[1]!, 16)
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

export function chartColors(c: ThemeColors): ChartColors {
  return {
    dark: luminance(c.surface) < 0.2,
    ink: c.ink,
    dim: c.dim,
    grid: c.line,
    surface: c.surface,
    surface2: c.surface2,
    weight: c.body,
    eat: c.eat,
    burn: c.burn,
    attn: c.attn,
    ok: c.ok,
    bike: c['chart-bike'],
    gym: c['chart-gym'],
    health: c['chart-health'],
    onOk: contrast(c.ok, c.ink) >= contrast(c.ok, c.bg) ? c.ink : c.bg,
  }
}

// --- O resultado de cada dia contra o alvo (Semana e calendário do Mês) ----
//
// No alvo (decisão 289) é o verde de «a melhorar» (o mesmo do «Desde o
// início»); os dias bem abaixo do alvo também contam como no alvo e são o
// mesmo verde, mais claro e com contorno; acima é o âmbar de atenção, cheio
// e com riscas (a textura é a 2.ª pista, além da cor). Validado com o
// validador do dataviz: verde/âmbar ΔE 13 (deutan) no claro, 7,4 (protan) no
// escuro — dentro do mínimo só com a 2.ª pista (riscas e ✓/+), que existe.

export const BELOW_FILL_OPACITY = 0.38

// A faixa de anotação (semanas de água, melhor mês): o cinzento do texto
// secundário a 26 %, ≈ 1,5:1 contra o cartão nos dois temas (o surface2
// dava 1,1:1 no escuro).
export const BAND_OPACITY = 0.26

// As pesagens (pontos pequenos atrás da linha): mais visíveis no escuro.
export const dotOpacity = (colors: ChartColors) => (colors.dark ? 0.55 : 0.4)

// As riscas de «acima»: o âmbar cheio com riscas da cor do cartão por cima.
export function HatchDef({ id, colors, size = 5 }: { id: string; colors: ChartColors; size?: number }) {
  return (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={size} height={size} fill={colors.attn} />
      <rect width={size * 0.36} height={size} fill={colors.surface} fillOpacity={0.45} />
    </pattern>
  )
}

export function useChartColors(): ChartColors {
  return chartColors(useThemeColors())
}

// --- Eixos -------------------------------------------------------------------

export const AXIS_FONT = 12
export const TICK = (colors: ChartColors) => ({ fill: colors.dim, fontSize: AXIS_FONT })

// Os números do eixo: inteiros com espaço fino nos milhares; «8 mil» só
// quando poupa espaço.
export const axisInt = (v: number) => fmtInt(v)
export const axisThousands = (v: number) => (v === 0 ? '0' : v % 1000 === 0 ? `${v / 1000} mil` : `${String(v / 1000).replace('.', ',')} mil`)

// O eixo do tempo contínuo (dias como números): as marcas e o texto delas.
export function timeAxis(from: string, to: string, max = 4) {
  const { ticks, kind } = dateTicks(from, to, max)
  const years = from.slice(0, 4) !== to.slice(0, 4)
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const format = (n: number) => {
    const d = fromDayNum(n)
    if (kind === 'day') return fmtDayMonth(d)
    const m = MONTHS[Number(d.slice(5, 7)) - 1]!
    return years && d.slice(5, 7) === '01' ? `${m} ${d.slice(0, 4)}` : m
  }
  return { ticks: ticks.map(dayNum), domain: [dayNum(from), dayNum(to)] as [number, number], format }
}

// --- O cartão ----------------------------------------------------------------

export function ChartCard({
  id,
  kicker,
  reading,
  aside,
  children,
  legend,
  note,
  table,
  className = '',
  dimmed = false,
}: {
  id?: string
  kicker: string
  reading: string
  aside?: ReactNode
  children: ReactNode
  legend?: ReactNode
  note?: ReactNode
  table?: ReactNode
  className?: string
  dimmed?: boolean // a carregar outro período: fica o anterior, mais claro (sem saltos)
}) {
  return (
    // Sem m-0: o preflight já tira a margem da <figure>, e um m-0 ganhava ao
    // space-y-* da secção (cartões colados).
    <figure id={id} className={`space-y-2 rounded-[18px] border border-line bg-surface p-4 ${className}`}>
      <figcaption className="space-y-0.5">
        <p className="label">{kicker}</p>
        <p className="text-[17px] leading-snug font-semibold">{reading}</p>
      </figcaption>
      {aside}
      <div role="img" aria-label={`${kicker}: ${reading}`} className={`transition-opacity ${dimmed ? 'opacity-50' : ''}`}>
        {children}
      </div>
      {legend}
      {note && <div className="text-[13px] text-dim">{note}</div>}
      {table && (
        <details className="text-[13px] text-dim">
          <summary className="cursor-pointer py-1">Ver os números</summary>
          {table}
        </details>
      )}
    </figure>
  )
}

// «Ainda poucos dados»: a mesma altura do gráfico, para nada saltar.
export function EmptyChart({ text, height }: { text: string; height: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-surface2/60 px-6 text-center text-[15px] text-dim" style={{ height }}>
      {text}
    </div>
  )
}

// --- Legenda (a marca igual à do gráfico, o texto na cor do texto) ---------

export type KeyShape = 'bar' | 'line' | 'dash' | 'dot' | 'ring' | 'hatch' | 'outline' | 'band' | 'below'

export function Key({
  shape,
  color,
  label,
  faint = false,
  border,
}: {
  shape: KeyShape
  color: string
  label: string
  faint?: boolean
  border?: string // um contorno (a amostra quase da cor do cartão)
}) {
  const pid = useId()
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="10" aria-hidden className="shrink-0">
        {shape === 'bar' && (
          <rect x="3.5" y="0.5" width="9" height="9" rx="2" fill={color} opacity={faint ? 0.45 : 1} stroke={border ?? 'none'} strokeWidth={border ? 1 : 0} />
        )}
        {shape === 'band' && <rect x="2" y="0" width="12" height="10" rx="1.5" fill={color} fillOpacity={BAND_OPACITY} />}
        {shape === 'below' && (
          <rect x="3.75" y="0.75" width="8.5" height="8.5" rx="2" fill={color} fillOpacity={BELOW_FILL_OPACITY} stroke={color} strokeWidth="1.5" />
        )}
        {shape === 'hatch' && (
          <>
            <defs>
              <pattern id={pid} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill={color} />
                <rect width="1.5" height="4" style={{ fill: 'var(--color-surface)' }} fillOpacity={0.45} />
              </pattern>
            </defs>
            <rect x="3" y="0" width="10" height="10" rx="2" fill={`url(#${pid})`} />
          </>
        )}
        {shape === 'outline' && <rect x="3.5" y="0.5" width="9" height="9" rx="2" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="2 1.5" />}
        {shape === 'line' && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />}
        {shape === 'dash' && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="2" strokeDasharray="3 3" />}
        {shape === 'dot' && <circle cx="8" cy="5" r="3.5" fill={color} fillOpacity={faint ? 0.5 : 1} />}
        {shape === 'ring' && <circle cx="8" cy="5" r="3.5" fill="none" stroke={color} strokeWidth="1.6" />}
      </svg>
      {label}
    </span>
  )
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-dim">{children}</div>
}

// --- A dica (o valor primeiro, forte; o nome depois) -------------------------

export interface TipRow {
  label: string
  value: string
  color?: string
  dash?: boolean
}

export function TipBox({ title, rows, colors }: { title: string; rows: TipRow[]; colors: ChartColors }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-[13px] tabular-nums shadow"
      style={{ background: colors.surface, border: `1px solid ${colors.grid}`, color: colors.ink }}
    >
      <p style={{ color: colors.dim }}>{title}</p>
      {rows.map((r, i) => (
        <p key={`${r.label}-${i}`} className="flex items-center gap-1.5">
          {r.color && (
            <svg width="12" height="6" aria-hidden>
              <line x1="0" x2="12" y1="3" y2="3" stroke={r.color} strokeWidth="2" strokeDasharray={r.dash ? '3 2' : undefined} />
            </svg>
          )}
          <span className="font-semibold">{r.value}</span>
          {r.label && <span style={{ color: colors.dim }}>{r.label}</span>}
        </p>
      ))}
    </div>
  )
}

// Propriedades comuns da dica do recharts (o cursor discreto, sem animação).
export const tooltipBase = (colors: ChartColors) =>
  ({
    cursor: { stroke: colors.dim, strokeWidth: 1, fill: colors.surface2, fillOpacity: 0.5 },
    isAnimationActive: false,
    wrapperStyle: { outline: 'none', zIndex: 5 },
    allowEscapeViewBox: { x: false, y: true },
  }) as const

// --- Marcos no próprio gráfico ------------------------------------------------

const LABEL_H = 15

// Uma linha de referência com nome (meta, alvo, média): o texto fica dentro
// do gráfico, à esquerda ou à direita, e conta como obstáculo para os
// rótulos dos marcos (nunca se sobrepõem).
export interface RefText {
  y: number
  text: string
  side?: 'left' | 'right'
  above?: boolean
  bottom?: boolean // fora do eixo (um alvo muito abaixo): no fundo do gráfico, à esquerda
}

const LEADER_MIN_PX = 12

function refBox(r: RefText, py: number, plot: { x: number; y: number; width: number; height: number }): Box {
  const w = labelWidth(r.text)
  const x = (r.side ?? 'right') === 'right' && !r.bottom ? plot.x + plot.width - 2 - w : plot.x + 4
  const y = r.bottom ? plot.y + plot.height - 17 : (r.above ?? true) ? py - 5 - 12 : py + 2
  return { x, y, w, h: 15 }
}

// Os pontos marcados (início, mais baixo, hoje…) com rótulos pequenos que
// nunca se sobrepõem nem saem do gráfico (rules/graficos.ts › placeLabels),
// nem tapam os nomes das linhas de referência (`refs`, desenhados aqui).
// Um rótulo que teve de se afastar mais de 12 px do ponto leva um traço até
// ele. Tem de estar dentro de um gráfico do recharts; `x` converte a data no
// valor do eixo (o número do dia ou a categoria).
export function Marks({
  marks,
  color,
  colors,
  x,
  extraObstacles = [],
  topRoom = 16,
  dots = true,
  avoid = [],
  refs = [],
}: {
  marks: Mark[]
  color: string
  colors: ChartColors
  x: (date: string) => number | string
  extraObstacles?: Box[]
  topRoom?: number
  dots?: boolean // sem pontos: só o rótulo (em cima de uma barra)
  avoid?: { date: string; value: number }[] // pontos das linhas que os rótulos não tapam
  refs?: RefText[]
}) {
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  const plot = usePlotArea()
  if (!xScale || !yScale || !plot) return null
  const pts = marks
    .map((m) => ({ m, px: xScale(x(m.date), { position: 'middle' }), py: yScale(m.value) }))
    .filter((p): p is { m: Mark; px: number; py: number } => p.px != null && p.py != null && Number.isFinite(p.px) && Number.isFinite(p.py))
  const line = avoid
    .map((a) => ({ px: xScale(x(a.date), { position: 'middle' }), py: yScale(a.value) }))
    .filter((p): p is { px: number; py: number } => p.px != null && p.py != null && Number.isFinite(p.px) && Number.isFinite(p.py))
    .map((p) => ({ x: p.px - 2, y: p.py - 2, w: 4, h: 4 }))
  const refPlaced = refs
    .map((r) => ({ r, py: r.bottom ? 0 : yScale(r.y) }))
    .filter((q): q is { r: RefText; py: number } => q.py != null && Number.isFinite(q.py))
    .map((q) => ({ ...q, box: refBox(q.r, q.py, plot) }))
  const obstacles = [
    ...(dots ? pts.map((p) => ({ x: p.px - 6, y: p.py - 6, w: 12, h: 12 })) : []),
    ...line,
    ...refPlaced.map((q) => q.box),
    ...extraObstacles,
  ]
  const placed = placeLabels(
    pts.map((p) => ({ id: p.m.id, x: p.px, y: p.py, w: labelWidth(p.m.label), h: LABEL_H, priority: p.m.priority, prefer: p.m.prefer })),
    { x: plot.x, y: plot.y - topRoom, w: plot.width, h: plot.height + topRoom },
    obstacles,
  )
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      {/* Os rótulos não apanham o toque: passa para o gráfico (a dica). */}
      <g aria-hidden pointerEvents="none">
        {refPlaced.map(({ r, box }) => (
          <text
            key={`r-${r.text}`}
            x={(r.side ?? 'right') === 'right' && !r.bottom ? box.x + box.w : box.x}
            y={box.y + 12}
            textAnchor={(r.side ?? 'right') === 'right' && !r.bottom ? 'end' : 'start'}
            fontSize={AXIS_FONT}
            fill={colors.dim}
            stroke={colors.surface}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {r.text}
          </text>
        ))}
        {placed.map((b, i) => {
          const p = pts[i]
          if (b.hidden || !p) return null
          // O ponto mais perto da caixa do rótulo: longe → um traço fino até ao ponto.
          const nx = Math.min(Math.max(p.px, b.x), b.x + b.w)
          const ny = Math.min(Math.max(p.py, b.y), b.y + LABEL_H)
          const far = Math.hypot(nx - p.px, ny - p.py) > LEADER_MIN_PX
          return far ? <line key={`l-${b.id}`} x1={p.px} y1={p.py} x2={nx} y2={ny} stroke={colors.dim} strokeWidth={1} /> : null
        })}
        {dots &&
          pts.map((p) => (
            <circle key={`d-${p.m.id}`} cx={p.px} cy={p.py} r={p.m.strong ? 5 : 4} fill={color} stroke={colors.surface} strokeWidth={2} />
          ))}
        {placed.map((b, i) => {
          if (b.hidden) return null
          // Ao lado do ponto, o texto encosta ao lado do ponto (a largura da
          // caixa é uma estimativa: centrado, parecia solto).
          const p = pts[i]
          const anchor = p && b.x + b.w <= p.px + 1 ? 'end' : p && b.x >= p.px - 1 ? 'start' : 'middle'
          const tx = anchor === 'end' ? b.x + b.w - 2 : anchor === 'start' ? b.x + 2 : b.x + b.w / 2
          return (
            <g key={`t-${b.id}`}>
              <rect x={b.x} y={b.y} width={b.w} height={LABEL_H} rx={3} fill={colors.surface} fillOpacity={0.88} />
              <text
                x={tx}
                y={b.y + LABEL_H - 3.5}
                textAnchor={anchor}
                fontSize={AXIS_FONT}
                fontWeight={pts[i]?.m.strong ? 600 : 500}
                fill={pts[i]?.m.strong ? colors.ink : colors.dim}
              >
                {pts[i]?.m.label}
              </text>
            </g>
          )
        })}
      </g>
    </ZIndexLayer>
  )
}

// Um rótulo numa linha de referência (alvo, média) sem marcos no gráfico.
export function RefLabel({ y, text, colors, side = 'right', above = true }: RefText & { colors: ChartColors }) {
  return <Marks marks={[]} color={colors.dim} colors={colors} x={(d) => d} refs={[{ y, text, side, above }]} />
}

// Um eixo de valores que não começa exatamente no alvo (a linha tracejada
// ficava em cima da linha do eixo): meio passo de folga por baixo.
export function padBelowTarget(scale: { domain: [number, number]; ticks: number[]; step: number }, target: number | null) {
  if (target == null || Math.abs(scale.domain[0] - target) > 1e-9) return scale
  const lo = scale.domain[0] - scale.step
  return { ...scale, domain: [lo, scale.domain[1]] as [number, number], ticks: [lo, ...scale.ticks] }
}

// As marcas do eixo das datas, nas categorias que existem (dias ou
// segundas-feiras): com 8 semanas ou mais, os meses (o dia 1 mais perto),
// como nos gráficos de linha.
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export function categoryTicks(dates: string[], max = 5): { ticks: string[]; format: (d: string) => string } {
  if (dates.length < 2) return { ticks: dates, format: fmtDayMonth }
  const { ticks, kind } = dateTicks(dates[0]!, dates[dates.length - 1]!, max)
  const near = ticks.map((t) => dates.reduce((best, d) => (Math.abs(dayNum(d) - dayNum(t)) < Math.abs(dayNum(best) - dayNum(t)) ? d : best)))
  if (kind !== 'month') return { ticks: [...new Set(near)], format: fmtDayMonth }
  // O mês da data marcada (a segunda mais perto do dia 1 pode ser do mês anterior).
  const byTick = new Map(near.map((d, i) => [d, ticks[i]!]))
  return { ticks: [...new Set(near)], format: (d) => MONTHS_SHORT[Number((byTick.get(d) ?? d).slice(5, 7)) - 1]! }
}

// --- Um toque para escolher (dia, semana) ------------------------------------

export function useSelection<T extends string>(initial: T | null = null) {
  const [selected, setSelected] = useState<T | null>(initial)
  return { selected, toggle: (v: T) => setSelected((cur) => (cur === v ? null : v)), clear: () => setSelected(null), set: setSelected }
}
