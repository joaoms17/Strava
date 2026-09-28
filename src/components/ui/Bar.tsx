// Barra de 12 px: acima de 100 % o excesso fica âmbar e tracejado.
export default function Bar({
  value,
  max,
  tone,
  label,
}: {
  value: number
  max: number
  tone: 'eat' | 'protein' | 'burn'
  label: string
}) {
  const ratio = max > 0 ? value / max : 0
  const within = Math.min(ratio, 1)
  const over = ratio > 1 ? Math.min(ratio - 1, 1) / ratio : 0
  const fill = { eat: 'bg-eat', protein: 'bg-protein', burn: 'bg-burn' }[tone]
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full bg-surface2"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemax={Math.round(max)}
    >
      {ratio > 1 ? (
        <>
          <div className={`h-full ${fill}`} style={{ width: `${(1 - over) * 100}%` }} />
          <div className="bar-over h-full" style={{ width: `${over * 100}%` }} />
        </>
      ) : (
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${within * 100}%` }} />
      )}
    </div>
  )
}
