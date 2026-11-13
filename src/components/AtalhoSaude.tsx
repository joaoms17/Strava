import { useState } from 'react'
import { getApi, postApi } from '../lib/api'
import { useToast } from '../lib/toast'

// Definições › Atalho do iPhone: passos e sono do Apple Watch (ou de outro
// relógio que escreva no Saúde) para a conta de quem tem a sessão. Mostra o
// endereço e o token pessoal para pôr no Atalho, que corre todas as noites.
// G4: o token mostra quando foi gerado, e «Gerar novo token» troca-o (o
// anterior deixa de funcionar).
interface TokenInfo {
  url: string
  token: string
  created_at?: string | null // null: o token de origem
  can_rotate?: boolean // false sem a migração 20261113000061
}

function createdLabel(createdAt: string | null | undefined): string {
  if (!createdAt) return 'Token de origem (sem data).'
  const when = new Date(createdAt)
  if (Number.isNaN(when.getTime())) return 'Token de origem (sem data).'
  return `Gerado a ${when.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}.`
}

export default function AtalhoSaude() {
  const [data, setData] = useState<TokenInfo | null>(null)
  const [busy, setBusy] = useState(false)
  // «Gerar novo token» pede confirmação no próprio cartão.
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()

  async function show() {
    setBusy(true)
    try {
      setData(await getApi<TokenInfo>('/api/day/ingest-token'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui obter o token.')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    setBusy(true)
    try {
      setData(await postApi<TokenInfo>('/api/day/ingest-token', {}))
      setConfirming(false)
      toast('Token novo gerado. Põe-no no Atalho.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não consegui gerar outro token.')
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
                <button onClick={() => void copy(value, label)} className="min-h-11 shrink-0 px-2 text-[14px] text-eat">
                  Copiar
                </button>
              </div>
            </div>
          ))}
          <p className="text-[13px] text-dim">{createdLabel(data.created_at)}</p>
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
          {data.can_rotate &&
            (!confirming ? (
              <button
                disabled={busy}
                onClick={() => setConfirming(true)}
                className="min-h-11 w-full rounded-xl bg-surface2 text-[15px] disabled:opacity-50"
              >
                Gerar novo token
              </button>
            ) : (
              <div className="space-y-2 rounded-xl bg-surface2 p-3">
                <p className="text-[14px]">
                  O token atual deixa de funcionar: o Atalho só volta a mandar os dados quando lhe puseres o novo.
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => void rotate()}
                    className="min-h-11 flex-1 rounded-xl bg-cta text-[15px] font-semibold text-on-cta disabled:opacity-50"
                  >
                    {busy ? 'A gerar…' : 'Gerar'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                    className="min-h-11 flex-1 rounded-xl text-[15px] text-dim"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
        </>
      )}
    </div>
  )
}
