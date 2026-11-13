import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFERRED_MIGRATIONS,
  MIGRATIONS,
  REQUIRED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  compareSchema,
  missingMigrations,
  schemaCheck,
  schemaVersionOf,
} from '../api/_lib/rules/esquema'
import { DEAD_PROFILE_COLUMNS, cleanProfile, profileFromCache, profileToCache } from '../src/lib/profile-cache'

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

describe('migrações em falta no telemóvel (ideia 6)', () => {
  const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', 'supabase', 'migrations')

  it('MIGRATIONS é a pasta supabase/migrations, por ordem', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect([...MIGRATIONS]).toEqual(files)
  })

  it('as migrações para correr mais tarde existem e escrevem schema_version', () => {
    for (const file of Object.keys(DEFERRED_MIGRATIONS)) {
      expect(MIGRATIONS).toContain(file)
      expect(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')).toMatch(/insert into public\.schema_version/)
    }
  })

  it('sem a tabela schema_version não se sabe: null (ficam os marcadores)', () => {
    expect(schemaCheck(null)).toBeNull()
    expect(schemaCheck(undefined)).toBeNull()
    expect(schemaCheck('lixo')).toBeNull()
  })

  it('com a tabela em dia, nada falta e nada para a app', () => {
    expect(schemaCheck(MIGRATIONS[MIGRATIONS.length - 1])).toEqual({ blocking: [], pending: [] })
  })

  it('migrações novas em falta são só aviso; as antigas essenciais param a app', () => {
    const files = ['20261005000000_sono.sql', '20261113000042_schema_version.sql', '20261120000000_seguinte.sql']
    expect(schemaCheck(20261113000042, files)).toEqual({ blocking: [], pending: ['20261120000000_seguinte.sql'] })
    expect(schemaCheck(20261004000000, files)).toEqual({
      blocking: ['20261005000000_sono.sql'],
      pending: files,
    })
    expect(REQUIRED_SCHEMA_VERSION).toBeLessThan(20261113000042)
  })
})

describe('perfil guardado no telemóvel (L12)', () => {
  const base = { id: 'p1', theme: 'dark', base_kcal: 2000, dismissed_hints: [] }

  it('lê uma cópia de antes da limpeza sem as colunas mortas', () => {
    const old = { ...base, pin_mode: '12h', trend_method: 'sma7', bike_min_cadence: 85, console_shows_watts: true }
    const read = profileFromCache(JSON.stringify(old)) as unknown as Record<string, unknown>
    expect(read).toEqual(base)
    for (const column of DEAD_PROFILE_COLUMNS) expect(column in read).toBe(false)
  })

  it('uma cópia estragada ou que não é um perfil não parte: null', () => {
    expect(profileFromCache(null)).toBeNull()
    expect(profileFromCache('')).toBeNull()
    expect(profileFromCache('{ estragado')).toBeNull()
    expect(profileFromCache('[1,2]')).toBeNull()
    expect(profileFromCache('"texto"')).toBeNull()
    expect(profileFromCache(JSON.stringify({ theme: 'dark' }))).toBeNull()
  })

  it('a cópia gravada e o perfil lido da base de dados já não levam as colunas mortas', () => {
    const row = { ...base, equipment: [], constraints: {}, carbs_ref_g: 200 }
    expect(JSON.parse(profileToCache(row))).toEqual(base)
    expect(cleanProfile(row)).toEqual(base)
  })
})
