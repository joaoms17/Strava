import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Guardas do deploy: os erros que já partiram a produção uma vez
// (funções a mais no Hobby, imports sem .js no ESM do Vercel, chamadas do
// cliente para caminhos que não existem) passam a falhar nos testes.

const ROOT = path.resolve(import.meta.dirname, '..')
const API = path.join(ROOT, 'api')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const apiFiles = walk(API).filter((f) => f.endsWith('.ts'))

// O Vercel trata como função cada .ts em /api cujo caminho não tem segmentos
// começados por "_" ou ".".
function isFunction(file: string): boolean {
  const segments = path.relative(API, file).split(path.sep)
  return segments.every((s) => !s.startsWith('_') && !s.startsWith('.'))
}
const functions = apiFiles.filter(isFunction)

function routeOf(file: string): string {
  return '/api/' + path.relative(API, file).split(path.sep).join('/').replace(/\.ts$/, '')
}

describe('guardas do deploy', () => {
  it('no máximo 10 funções (o Hobby aceita 12)', () => {
    expect(functions.length).toBeLessThanOrEqual(10)
  })

  it('imports relativos em /api terminam em .js (ESM no Vercel)', () => {
    const offenders: string[] = []
    for (const file of apiFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
        if (!match[1]!.endsWith('.js')) offenders.push(`${path.relative(ROOT, file)}: ${match[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('as regras de negócio são puras (sem Supabase nem node:)', () => {
    const rules = walk(path.join(API, '_lib', 'rules')).filter((f) => f.endsWith('.ts'))
    const offenders = rules.filter((file) =>
      /from\s+'(@supabase\/|node:)/.test(fs.readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('cada /api/... chamado no cliente existe (função ou rewrite)', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
      rewrites: { source: string }[]
    }
    const rewrites = vercel.rewrites
      .map((r) => r.source)
      .filter((s) => s.startsWith('/api/'))
      .map((s) => new RegExp('^' + s.replace(/:[a-z]+/g, '[^/]+') + '$'))
    const routes = new Set(functions.map(routeOf))

    const clientFiles = walk(path.join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))
    const missing: string[] = []
    for (const file of clientFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/['`](\/api\/[^'`?\s]*)/g)) {
        // troca interpolações ${...} por um segmento qualquer
        const url = match[1]!.replace(/\$\{[^}]*\}/g, 'x')
        if (!routes.has(url) && !rewrites.some((re) => re.test(url))) {
          missing.push(`${path.relative(ROOT, file)}: ${url}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('os destinos dos rewrites apontam para funções que existem', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
      rewrites: { destination: string }[]
      crons: { path: string }[]
    }
    const routes = new Set(functions.map(routeOf))
    const targets = [
      ...vercel.rewrites.map((r) => r.destination.split('?')[0]!),
      ...vercel.crons.map((c) => c.path),
    ].filter((d) => d.startsWith('/api/'))
    expect(targets.filter((t) => !routes.has(t))).toEqual([])
  })
})
