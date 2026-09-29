import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

interface CatalogRow {
  name: string
  pattern: string
  knee_safe: boolean
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Escolher um exercício: pesquisa em todo o catálogo (os que forçam o joelho
// aparecem com aviso, no fim) e, se não existir, cria-o com o nome escrito.
export default function ExercisePicker({
  exclude = [],
  onPick,
  onClose,
}: {
  exclude?: string[]
  onPick: (name: string) => void
  onClose: () => void
}) {
  const toast = useToast()
  const [catalog, setCatalog] = useState<CatalogRow[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void supabase
      .from('exercise_catalog')
      .select('name,pattern,knee_safe')
      .order('name')
      .then(({ data }) => setCatalog(((data ?? []) as CatalogRow[]).filter((c) => c.pattern !== 'bike')))
  }, [])

  const taken = useMemo(() => new Set(exclude.map(fold)), [exclude])
  const q = fold(query)
  const matches = catalog
    .filter((c) => !taken.has(fold(c.name)) && (!q || fold(c.name).includes(q)))
    .sort((a, b) => Number(b.knee_safe) - Number(a.knee_safe) || a.name.localeCompare(b.name, 'pt'))
  const exact = catalog.some((c) => fold(c.name) === q)

  async function create() {
    const name = query.trim().replace(/\s+/g, ' ')
    if (!name) return
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      // Fica no catálogo para as próximas vezes (se já existir, não faz mal).
      const { error } = await supabase
        .from('exercise_catalog')
        .insert({ user_id: auth.user.id, name, pattern: 'outro', knee_safe: true })
      if (error && error.code !== '23505') toast('Não consegui guardar no catálogo, mas fica nesta sessão.')
    }
    onPick(name)
  }

  return (
    <div className="space-y-2 rounded-[18px] border border-line bg-surface p-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Procurar ou escrever um exercício"
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
      />
      {q && !exact && (
        <button
          onClick={() => void create()}
          className="min-h-11 w-full rounded-xl bg-surface2 px-3 text-left text-[15px]"
        >
          ＋ Adicionar «{query.trim()}»
        </button>
      )}
      <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
        {matches.map((c) => (
          <button
            key={c.name}
            onClick={() => onPick(c.name)}
            className={`min-h-10 rounded-full border px-3 text-[15px] ${c.knee_safe ? 'border-line' : 'border-attn/60 text-dim'}`}
          >
            {c.name}
            {!c.knee_safe && <span className="ml-1 text-[12px] text-attn">· cuidado joelho</span>}
          </button>
        ))}
        {matches.length === 0 && !q && <p className="text-[14px] text-dim">Escreve o nome de um exercício.</p>}
      </div>
      <button onClick={onClose} className="text-[14px] text-dim">
        Fechar
      </button>
    </div>
  )
}
