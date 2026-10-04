import { useLocation, useSearch } from 'wouter'

// Folhas abertas por URL (?folha=peso&data=…): recarregar mantém o ecrã e o
// botão de voltar fecha a folha. No máximo uma de cada vez.
export type SheetName =
  | 'registar'
  | 'peso'
  | 'refeicao'
  | 'galeria'
  | 'escrever'
  | 'repetir'
  | 'nota'
  | 'numeros'
  | 'barras'
  | 'rever'
  | 'treino'
  | 'joelho'
  | 'ja-fiz'
  | 'confirmar-treino'
  | 'medidas'
  | 'como-medir'
  | 'meu-treino'

export function useSheet() {
  const [location, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const name = params.get('folha') as SheetName | null

  function open(sheet: SheetName, extra: Record<string, string> = {}) {
    const query = new URLSearchParams({ folha: sheet, ...extra })
    const alreadyOpen = name != null
    // Trocar de folha mantém a entrada: se a primeira veio da URL (recarregar),
    // fechar a segunda não pode recuar para fora da app.
    const current = (window.history.state as { sheet?: boolean } | null)?.sheet === true
    navigate(`${location}?${query.toString()}`, {
      replace: alreadyOpen,
      state: alreadyOpen ? { sheet: current } : { sheet: true },
    })
  }

  function close() {
    if ((window.history.state as { sheet?: boolean } | null)?.sheet) window.history.back()
    else navigate(location, { replace: true })
  }

  return { name, params, open, close }
}
