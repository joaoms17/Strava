import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import {
  EXERCISE_GROUPS,
  mergeCatalog,
  patternOfGroup,
  sameExercise,
  searchExercises,
  type CatalogExerciseDef,
  type ExerciseGroup,
} from '../../api/_lib/rules/exercicios'

// Escolher um exercício: mais de 100 de origem mais os teus, por grupo
// muscular e com pesquisa. Se não existir, cria-o com o nome escrito, no
// grupo escolhido.
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
  const [catalog, setCatalog] = useState<CatalogExerciseDef[]>(() => mergeCatalog([]))
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ExerciseGroup | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Abre à vista (numa folha comprida ficava lá em baixo).
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    void supabase
      .from('exercise_catalog')
      .select('name,pattern')
      .then(({ data }) => setCatalog(mergeCatalog((data ?? []) as { name: string; pattern: string | null }[])))
  }, [])

  const available = useMemo(
    () => catalog.filter((c) => !exclude.some((e) => sameExercise(e, c.name))),
    [catalog, exclude],
  )
  const matches = searchExercises(available, query, group)
  const typed = query.trim().replace(/\s+/g, ' ')
  const exists = catalog.some((c) => sameExercise(c.name, typed))

  async function create() {
    if (!typed) return
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      // Fica no catálogo para as próximas vezes (se já existir, não faz mal).
      const { error } = await supabase
        .from('exercise_catalog')
        .insert({ user_id: auth.user.id, name: typed, pattern: patternOfGroup(group) })
      if (error && error.code !== '23505') toast('Não consegui guardar no catálogo, mas fica neste treino.')
    }
    onPick(typed)
  }

  const groupChip = (active: boolean) =>
    `min-h-9 shrink-0 rounded-full px-3 text-[14px] ${active ? 'bg-ink text-bg' : 'border border-line text-dim'}`

  return (
    <div ref={box} className="scroll-mt-4 space-y-2 rounded-[18px] border border-line bg-surface p-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Procurar ou escrever um exercício"
        className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] placeholder:text-dim focus:border-eat focus:outline-none"
      />
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
        <button onClick={() => setGroup(null)} className={groupChip(group == null)}>
          Todos
        </button>
        {EXERCISE_GROUPS.map((g) => (
          <button key={g} onClick={() => setGroup(group === g ? null : g)} className={groupChip(group === g)}>
            {g}
          </button>
        ))}
      </div>
      {typed && !exists && (
        <button onClick={() => void create()} className="min-h-11 w-full rounded-xl bg-surface2 px-3 text-left text-[15px]">
          ＋ Adicionar «{typed}»{group ? ` em ${group}` : ''}
        </button>
      )}
      <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto">
        {matches.map((c) => (
          <button
            key={c.name}
            onClick={() => onPick(c.name)}
            className="min-h-10 rounded-full border border-line px-3 text-left text-[15px]"
          >
            {c.name}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="text-[14px] text-dim">
            {typed ? 'Não encontrei. Carrega em «Adicionar» para o criar.' : 'Nada neste grupo.'}
          </p>
        )}
      </div>
      <button onClick={onClose} className="min-h-10 text-[14px] text-dim">
        Fechar
      </button>
    </div>
  )
}
