// Linha pequena com um ponto por medição (cintura no Corpo, zonas no
// histórico). Com menos de 2 valores não desenha nada.
export default function Sparkline({ values, width = 120 }: { values: number[]; width?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const w = width
  const h = 36
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0 text-body">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={(i / (values.length - 1)) * w} cy={h - ((v - min) / (max - min)) * h} r="3" fill="currentColor" />
      ))}
    </svg>
  )
}
