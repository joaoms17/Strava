// Ideia 6: a versão do schema da base de dados (tabela schema_version,
// migração 20261113000042) contra a que este código conhece. Uma versão é o
// timestamp do nome da migração (20261113000042_schema_version.sql →
// 20261113000042). Sem supabase nem node: o telemóvel pode usar isto.

// A última migração do repositório que escreve schema_version. Sobe com cada
// migração nova (tests/guardas.test.ts confirma que o ficheiro existe).
export const SCHEMA_VERSION = 20261113000063

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

// As migrações do repositório, por ordem (tests/guardas.test.ts confirma que
// a lista é igual à pasta supabase/migrations). O telemóvel usa-a para dizer
// quais faltam, sem ler a pasta.
export const MIGRATIONS = [
  '20260908000000_initial_schema.sql',
  '20260908120000_storage_meal_photos.sql',
  '20260910000000_storage_chapter_photos.sql',
  '20260928000000_fase1.sql',
  '20260929000000_fase2.sql',
  '20260929120000_fase2_permissoes.sql',
  '20260930000000_fase3.sql',
  '20261001000000_fase4.sql',
  '20261002000000_fase5.sql',
  '20261003000000_fase6.sql',
  '20261004000000_fase7.sql',
  '20261005000000_sono.sql',
  '20261006000000_dietas.sql',
  '20261007000000_evolucao.sql',
  '20261015000000_agua.sql',
  '20261018110000_pesagens_apagadas.sql',
  '20261018110001_forma_intervals.sql',
  '20261018130000_alimentos_marca.sql',
  '20261018140000_dias_certos.sql',
  '20261018150000_notificacoes.sql',
  '20261018150001_fotos_capitulos.sql',
  '20261018150002_ia_reserva.sql',
  '20261018160000_partilhar_ao_registar.sql',
  '20261018200000_sobras.sql',
  '20261018210000_divisao_partilha.sql',
  '20261018220000_pedidos_entrega.sql',
  '20261113000020_etiquetas_analise.sql',
  '20261113000021_meals_counted_colunas.sql',
  '20261113000022_custo_ia_mes.sql',
  '20261113000030_cron_runs.sql',
  '20261113000031_push_so_servidor.sql',
  '20261113000040_nome_no_perfil.sql',
  '20261113000041_limites_buckets.sql',
  '20261113000042_schema_version.sql',
  '20261113000050_limpeza.sql',
  '20261113000060_quota_ia.sql',
  '20261113000061_token_atalho.sql',
  '20261113000062_dia_num_pedido.sql',
  '20261113000063_favoritas_miniatura.sql',
] as const

// A app só fica parada no «A app precisa de uma atualização» por migrações
// até esta (as fases do redesenho e o sono, que antes se detetavam pelas
// colunas); as seguintes são lidas com tolerância e ficam só como aviso em
// Avançado.
export const REQUIRED_SCHEMA_VERSION = 20261005000000

// Migrações que só se correm algum tempo depois de publicar o código (o
// porquê está no ficheiro): o aviso diz quando.
export const DEFERRED_MIGRATIONS: Readonly<Record<string, string>> = {
  '20261113000050_limpeza.sql': 'só uns dias depois de publicar esta versão, com cópia de segurança (irreversível)',
}

export interface SchemaCheck {
  // As que param a app (até REQUIRED_SCHEMA_VERSION).
  blocking: string[]
  // Todas as que faltam, por ordem.
  pending: string[]
}

// Com a versão da tabela schema_version, o que falta; sem ela (tabela por
// criar, valor estranho), null: o telemóvel usa os marcadores de antes.
export function schemaCheck(database: unknown, files: readonly string[] = MIGRATIONS): SchemaCheck | null {
  if (schemaVersionOf(database) == null) return null
  const pending = missingMigrations(database, files)
  return { blocking: pending.filter((f) => (schemaVersionOf(f) ?? 0) <= REQUIRED_SCHEMA_VERSION), pending }
}
