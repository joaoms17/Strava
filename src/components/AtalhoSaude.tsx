import { useState } from 'react'
import { getApi } from '../lib/api'
import { useToast } from '../lib/toast'

// Definições › Atalho do iPhone: passos e sono do Apple Watch (ou de outro
// relógio que escreva no Saúde) para a conta de quem tem a sessão. Mostra o
// endereço e o token pessoal para pôr no Atalho, que corre todas as noites.
export default function AtalhoSaude() {
  const [data, setData] = useState<{ url: string; token: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  async function show() {
    setBusy(true)
    try {
      setData(await getApi<{ url: string; token: string }>('/api/day/ingest-token'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui obter o token.')
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(`${what} copiado.`)
    } catch {
      toast('Não consegui copiar. Toca e mantém no texto para copiar.')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-dim">
        Para quem tem Apple Watch: um Atalho do iPhone manda todas as noites os passos e as horas de sono do Saúde
        para esta conta. Cada pessoa usa o seu token.
      </p>
      {!data ? (
        <button
          disabled={busy}
          onClick={() => void show()}
          className="min-h-12 w-full rounded-xl bg-surface2 text-[15px] disabled:opacity-50"
        >
          {busy ? 'A obter…' : 'Mostrar endereço e token'}
        </button>
      ) : (
        <>
          {(
            [
              ['Endereço', data.url],
              ['Token', data.token],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="space-y-1">
              <p className="label">{label}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-lg bg-surface2 px-3 py-2 text-[12px] break-all select-all">
                  {value}
                </code>
                <button onClick={() => void copy(value, label)} className="min-h-10 shrink-0 px-2 text-[14px] text-eat">
                  Copiar
                </button>
              </div>
            </div>
          ))}
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-dim">
            <li>Atalhos › novo atalho: «Procurar amostras de saúde» de Passos de hoje e «Calcular estatísticas» › Soma.</li>
            <li>
              Outra vez para Análise do sono, desde ontem às 18:00, só «A dormir»; soma da duração em minutos.
            </li>
            <li>
              «Obter conteúdo do URL»: o endereço acima, método POST, cabeçalho Authorization = Bearer e o token,
              corpo JSON com steps e sleep_minutes (números).
            </li>
            <li>Automatização › Hora do dia, 23:30, todos os dias, sem perguntar.</li>
          </ol>
        </>
      )}
    </div>
  )
}
