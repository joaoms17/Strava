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
}

export function chartColors(c: ThemeColors): ChartColors {
  return {
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
  }
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
    <figure id={id} className={`m-0 space-y-2 rounded-[18px] border border-line bg-surface p-4 ${className}`} aria-label={`${kicker}: ${reading}`}>
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

export type KeyShape = 'bar' | 'line' | 'dash' | 'dot' | 'ring' | 'hatch' | 'outline'

export function Key({ shape, color, label, faint = false }: { shape: KeyShape; color: string; label: string; faint?: boolean }) {
  const pid = useId()
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="10" aria-hidden className="shrink-0">
        {shape === 'bar' && <rect x="3" y="0" width="10" height="10" rx="2" fill={color} opacity={faint ? 0.45 : 1} />}
        {shape === 'hatch' && (
          <>
            <defs>
              <pattern id={pid} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="2" height="4" fill={color} />
              </pattern>
            </defs>
            <rect x="3" y="0" width="10" height="10" rx="2" fill={`url(#${pid})`} stroke={color} strokeWidth="1" />
          </>
        )}
        {shape === 'outline' && <rect x="3.5" y="0.5" width="9" height="9" rx="2" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="2 1.5" />}
        {shape === 'line' && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />}
        {shape === 'dash' && <line x1="1" x2="15" y1="5" y2="5" stroke={color} strokeWidth="2" strokeDasharray="3 3" />}
        {shape === 'dot' && <circle cx="8" cy="5" r="3.5" fill={color} />}
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

// Os pontos marcados (início, mais baixo, hoje…) com rótulos pequenos que
// nunca se sobrepõem nem saem do gráfico (rules/graficos.ts › placeLabels).
// Tem de estar dentro de um gráfico do recharts; `x` converte a data no
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
}: {
  marks: Mark[]
  color: string
  colors: ChartColors
  x: (date: string) => number | string
  extraObstacles?: Box[]
  topRoom?: number
  dots?: boolean // sem pontos: só o rótulo (em cima de uma barra)
  avoid?: { date: string; value: number }[] // pontos das linhas que os rótulos não tapam
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
  const obstacles = [...(dots ? pts.map((p) => ({ x: p.px - 6, y: p.py - 6, w: 12, h: 12 })) : []), ...line, ...extraObstacles]
  const placed = placeLabels(
    pts.map((p) => ({ id: p.m.id, x: p.px, y: p.py, w: labelWidth(p.m.label), h: LABEL_H, priority: p.m.priority, prefer: p.m.prefer })),
    { x: plot.x, y: plot.y - topRoom, w: plot.width, h: plot.height + topRoom },
    obstacles,
  )
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      {/* Os rótulos não apanham o toque: passa para o gráfico (a dica). */}
      <g aria-hidden pointerEvents="none">
        {dots &&
          pts.map((p) => (
            <circle key={`d-${p.m.id}`} cx={p.px} cy={p.py} r={p.m.strong ? 5 : 4} fill={color} stroke={colors.surface} strokeWidth={2} />
          ))}
        {placed.map((b, i) =>
          b.hidden ? null : (
            <g key={`t-${b.id}`}>
              <rect x={b.x} y={b.y} width={b.w} height={LABEL_H} rx={3} fill={colors.surface} fillOpacity={0.88} />
              <text
                x={b.x + b.w / 2}
                y={b.y + LABEL_H - 3.5}
                textAnchor="middle"
                fontSize={AXIS_FONT}
                fontWeight={pts[i]?.m.strong ? 600 : 500}
                fill={pts[i]?.m.strong ? colors.ink : colors.dim}
              >
                {pts[i]?.m.label}
              </text>
            </g>
          ),
        )}
      </g>
    </ZIndexLayer>
  )
}

// Um rótulo numa linha de referência (alvo, média), dentro do gráfico, à
// direita ou à esquerda, com um halo da cor do fundo.
export function RefLabel({
  y,
  text,
  colors,
  side = 'right',
  above = true,
}: {
  y: number
  text: string
  colors: ChartColors
  side?: 'left' | 'right'
  above?: boolean
}) {
  const yScale = useYAxisScale()
  const plot = usePlotArea()
  if (!yScale || !plot) return null
  const py = yScale(y)
  if (py == null || !Number.isFinite(py)) return null
  const px = side === 'right' ? plot.x + plot.width - 2 : plot.x + 4
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <text
        x={px}
        y={above ? py - 5 : py + 14}
        textAnchor={side === 'right' ? 'end' : 'start'}
        fontSize={AXIS_FONT}
        fill={colors.dim}
        stroke={colors.surface}
        strokeWidth={3}
        paintOrder="stroke"
        pointerEvents="none"
        aria-hidden
      >
        {text}
      </text>
    </ZIndexLayer>
  )
}

// --- Um toque para escolher (dia, semana) ------------------------------------

export function useSelection<T extends string>(initial: T | null = null) {
  const [selected, setSelected] = useState<T | null>(initial)
  return { selected, toggle: (v: T) => setSelected((cur) => (cur === v ? null : v)), clear: () => setSelected(null), set: setSelected }
}
