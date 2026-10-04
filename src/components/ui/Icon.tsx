// Ícones de traço (24 × 24, cor do texto). Substituem os emojis, que no
// iPhone ficam coloridos e fora do estilo.
const PATHS = {
  today: 'M4 6h16M4 12h16M4 18h10',
  chart: 'M5 20V11M12 20V5M19 20v-6',
  dumbbell: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  body: 'M8.5 10a5 5 0 0 1 7 0M12 10l1.2-2M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  gallery: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15l2.5-2.5L20 17M15.5 9.5h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  plate: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  scale: 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8.5 10a5 5 0 0 1 7 0M12 10l1.2-2',
  bike: 'M5.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 16.5 9 9h6.5l3 7.5M9 9 7.5 5.5H6M15.5 9 12 16.5H5.5M14 5.5h2.5',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9 21l2.5-6.5L14 17v4M8 12l2-4.5 3.5 1.5 1.5 3.5 2.5 1M11.5 14.5 12.5 9',
  watch: 'M7 7h10v10H7zM9 7V3h6v4M9 17v4h6v-4',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevron: 'M9 6l6 6-6 6',
  star: 'M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6-5-2.9-5 2.9 1.2-5.6L4 9.6 9.6 9z',
  alert: 'M12 8v5M12 16.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  barcode: 'M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12',
  close: 'M6 6l12 12M18 6 6 18',
  ruler: 'M3 17 17 3l4 4L7 21zM7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2',
  info: 'M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  retry: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3',
  send: 'M5 12h13M13 6l6 6-6 6',
} as const

export type IconName = keyof typeof PATHS

export default function Icon({
  name,
  size = 24,
  stroke = 2,
  className,
}: {
  name: IconName
  size?: number
  stroke?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
