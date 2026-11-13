// Ideia 6: a versão do schema da base de dados (tabela schema_version,
// migração 20261113000042) contra a que este código conhece. Uma versão é o
// timestamp do nome da migração (20261113000042_schema_version.sql →
// 20261113000042). Sem supabase nem node: o telemóvel pode usar isto.

// A última migração do repositório que escreve schema_version. Sobe com cada
// migração nova (tests/guardas.test.ts confirma que o ficheiro existe).
export const SCHEMA_VERSION = 20261113000042

// em_dia: igual; atrasada: faltam migrações na base de dados; adiantada: a
// base de dados tem migrações que este código ainda não conhece (um deploy
// atrasado, sem mal: o código lê colunas novas com tolerância);
// desconhecida: sem a tabela (antes da 20261113000042) ou com um valor estranho.
export type SchemaState = 'em_dia' | 'atrasada' | 'adiantada' | 'desconhecida'

// O número de uma versão (bigint do PostgREST, texto ou nome de ficheiro).
export function schemaVersionOf(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{14})(?:_|\.sql$|$)/.exec(text)
  return match ? Number(match[1]) : null
}

export function compareSchema(database: unknown, known: number = SCHEMA_VERSION): SchemaState {
  const db = schemaVersionOf(database)
  if (db == null) return 'desconhecida'
  if (db === known) return 'em_dia'
  return db < known ? 'atrasada' : 'adiantada'
}

// As migrações (nomes de ficheiro) que a base de dados ainda não tem, por
// ordem. Sem versão conhecida, não se sabe: lista vazia.
export function missingMigrations(database: unknown, files: readonly string[]): string[] {
  const db = schemaVersionOf(database)
  if (db == null) return []
  return files
    .filter((f) => {
      const v = schemaVersionOf(f)
      return v != null && v > db
    })
    .sort()
}
