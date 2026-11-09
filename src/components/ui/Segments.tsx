// Barra de placar em segmentos. O último segmento enche em parte; acima do
// máximo, o excesso ocupa os últimos segmentos: âmbar e tracejado por omissão
// (`overStyle="warn"`, não depende só da cor), na cor da barra quando passar é
// bom ou não conta como passar (`"fill"`: a proteína, o comido até 100 kcal
// acima do plano) e vermelho cheio no grave (`"danger"`: acima do gasto).
export default function Segments({
  value,
  max,
  count = 15,
  tone,
  height = 12,
  label,
  overStyle = 'warn',
}: {
  value: number
  max: number
  count?: number
  tone: 'eat' | 'protein' | 'burn'
  height?: number
  label: string
  overStyle?: 'warn' | 'fill' | 'danger'
}) {
  const ratio = max > 0 ? Math.max(0, value / max) : 0
  const fill = { eat: 'bg-eat', protein: 'bg-protein', burn: 'bg-burn' }[tone]
  // Acima do máximo: a parte a mais ocupa os últimos segmentos, em proporção.
  const overSegments = ratio > 1 ? Math.max(1, Math.round(((ratio - 1) / ratio) * count)) : 0
  const filled = Math.min(ratio, 1) * count
  return (
    <div
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemax={Math.round(max)}
    >
      {Array.from({ length: count }, (_, i) => {
        const part = Math.max(0, Math.min(1, filled - i))
        const over = overSegments > 0 && i >= count - overSegments
        return (
          <div key={i} className="overflow-hidden rounded-[2px] bg-line" style={{ height }}>
            {over ? (
              <div
                className={`h-full w-full ${overStyle === 'warn' ? 'bar-over' : overStyle === 'danger' ? 'bg-pain' : fill}`}
              />
            ) : part > 0 ? (
              <div className={`h-full ${fill}`} style={{ width: `${part * 100}%` }} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
