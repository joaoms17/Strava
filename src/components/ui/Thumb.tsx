import Icon from './Icon'

// Foto pequena de uma refeição ou favorita; sem foto, um prato. Com `fill`,
// o tamanho vem da className (ex.: a largura toda de um cartão).
export default function Thumb({
  url,
  size = 48,
  fill = false,
  className = '',
}: {
  url?: string | null
  size?: number
  fill?: boolean
  className?: string
}) {
  const box = fill ? undefined : { width: size, height: size }
  return url ? (
    <img src={url} alt="" style={box} className={`shrink-0 rounded-xl object-cover ${className}`} />
  ) : (
    <span style={box} className={`flex shrink-0 items-center justify-center rounded-xl bg-surface2 text-dim ${className}`} aria-hidden>
      <Icon name="plate" size={Math.round(Math.min(size, 64) * 0.45)} />
    </span>
  )
}
