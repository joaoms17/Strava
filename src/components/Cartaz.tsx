// Cartaz do capítulo: componente SVG gerado na app, sem imagens externas.
interface Props {
  numero: string
  titulo: string
  patrono: string
  dado: string
}

export default function Cartaz({ numero, titulo, patrono, dado }: Props) {
  return (
    <svg viewBox="0 0 360 480" className="w-full rounded-2xl border border-edge" role="img" aria-label={`Cartaz: ${titulo}, ${patrono}`}>
      <rect width="360" height="480" fill="#101012" />
      <text
        x="180"
        y="300"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="bold"
        fontSize="240"
        fill="#f59e0b"
        opacity="0.92"
      >
        {numero}
      </text>
      <text
        x="180"
        y="366"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui"
        fontSize="21"
        letterSpacing="4"
        fill="#e7e5e4"
        style={{ textTransform: 'uppercase' }}
      >
        {titulo.toUpperCase()}
      </text>
      <text
        x="180"
        y="394"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui"
        fontSize="14"
        fill="#a1a1aa"
      >
        {patrono}
      </text>
      <line x1="120" y1="416" x2="240" y2="416" stroke="#26262b" strokeWidth="1" />
      <text
        x="180"
        y="444"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontSize="14"
        fill="#e7e5e4"
      >
        {dado}
      </text>
    </svg>
  )
}
