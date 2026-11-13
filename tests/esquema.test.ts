import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, compareSchema, missingMigrations, schemaVersionOf } from '../api/_lib/rules/esquema'

// Ideia 6: a versão do schema explícita (tabela schema_version).
describe('versão do schema', () => {
  it('lê o número do bigint, do texto e do nome do ficheiro', () => {
    expect(schemaVersionOf(20261113000042)).toBe(20261113000042)
    expect(schemaVersionOf('20261113000042')).toBe(20261113000042)
    expect(schemaVersionOf('20261113000042_schema_version.sql')).toBe(20261113000042)
    expect(schemaVersionOf(null)).toBeNull()
    expect(schemaVersionOf('2026')).toBeNull()
    expect(schemaVersionOf('README.md')).toBeNull()
  })

  it('compara a base de dados com o código', () => {
    expect(compareSchema(SCHEMA_VERSION)).toBe('em_dia')
    expect(compareSchema(20261113000031, 20261113000042)).toBe('atrasada')
    expect(compareSchema(20261120000000, 20261113000042)).toBe('adiantada')
    expect(compareSchema(null)).toBe('desconhecida')
    expect(compareSchema('lixo')).toBe('desconhecida')
  })

  it('lista as migrações em falta, por ordem', () => {
    const files = [
      '20261113000042_schema_version.sql',
      '20261113000040_nome_no_perfil.sql',
      '20261113000031_push_so_servidor.sql',
      'README.md',
      '20261120000000_seguinte.sql',
    ]
    expect(missingMigrations(20261113000040, files)).toEqual([
      '20261113000042_schema_version.sql',
      '20261120000000_seguinte.sql',
    ])
    expect(missingMigrations(null, files)).toEqual([])
  })

  it('SCHEMA_VERSION é uma migração do repositório que escreve schema_version', () => {
    const dir = path.resolve(import.meta.dirname, '..', 'supabase', 'migrations')
    const file = fs.readdirSync(dir).find((f) => schemaVersionOf(f) === SCHEMA_VERSION)
    expect(file).toBeDefined()
    expect(fs.readFileSync(path.join(dir, file!), 'utf8')).toMatch(/insert into public\.schema_version/)
  })
})
