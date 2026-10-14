import { FAT_LABELS, fatCategory, fatCuts, fatScaleRange } from '../../api/_lib/rules/composicao'

const SEGMENT_CLASS = ['bg-attn/70', 'bg-ok/60', 'bg-ok', 'bg-attn/60', 'bg-attn', 'bg-pain']

// Corpo › barra da % de gordura: seis faixas (de «Muito seco» a «Muita
// gordura»), com os cortes de homem ou de mulher e a marca onde está agora.
export default function FatScale({ pct, sex }: { pct: number; sex: string | null }) {
  const [lo, hi] = fatScaleRange(sex)
  const edges = [lo, ...fatCuts(sex), hi]
  const at = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100
  const { index, label } = fatCategory(pct, sex)
  return (
    <div className="space-y-1.5">
      <div className="relative pt-3">
        <div
          className="absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-ink"
          style={{ left: `${at(pct)}%` }}
          aria-hidden
        />
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${label}, cerca de ${Math.round(pct)} %`}>
          {FAT_LABELS.map((name, i) => (
            <div
              key={name}
              className={`${SEGMENT_CLASS[i]} ${i === index ? '' : 'opacity-40'}`}
              style={{ width: `${at(edges[i + 1]!) - at(edges[i]!)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="relative h-4 text-[11px] text-dim tabular-nums">
        {fatCuts(sex).map((cut) => (
          <span key={cut} className="absolute -translate-x-1/2" style={{ left: `${at(cut)}%` }}>
            {cut}
          </span>
        ))}
      </div>
      <p className="text-[15px]">
        <span className="font-semibold">{label}</span>
        <span className="text-dim"> · cerca de {Math.round(pct)} % ({sex === 'f' ? 'escala de mulher' : 'escala de homem'})</span>
      </p>
    </div>
  )
}
