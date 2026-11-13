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

  it('import() relativos em /api terminam em .js e o ficheiro existe (P7)', () => {
    const offenders: string[] = []
    for (const file of apiFiles) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(/import\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)) {
        const target = match[1]!
        const ts = path.resolve(path.dirname(file), target.replace(/\.js$/, '.ts'))
        if (!target.endsWith('.js') || !fs.existsSync(ts)) offenders.push(`${path.relative(ROOT, file)}: ${target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('cada ação dos routers aponta para um export que existe (P7)', async () => {
    const missing: string[] = []
    for (const router of ['meal', 'workout', 'day']) {
      const source = fs.readFileSync(path.join(API, `${router}.ts`), 'utf8')
      for (const match of source.matchAll(/import\('(\.\/[^']+)'\)\.then\(\(m\) => m\.([A-Za-z]+)\)/g)) {
        const file = path.join(API, match[1]!.replace(/\.js$/, '.ts'))
        const name = match[2]!
        const text = fs.readFileSync(file, 'utf8')
        const ok =
          name === 'default'
            ? /export default /.test(text)
            : new RegExp(`export (const|async function|function) ${name}\\b`).test(text)
        if (!ok) missing.push(`${router}: ${match[1]} → ${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('cada bucket usado pela app tem limite de tamanho e de tipo (G5)', () => {
    const used = new Set<string>()
    const files = [...apiFiles, ...walk(path.join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))]
    for (const file of files) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/storage\s*\.from\('([a-z-]+)'\)/g)) used.add(match[1]!)
    }
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261113000041_limites_buckets.sql'), 'utf8')
    const limited = new Set([...sql.matchAll(/allowed_mime_types[\s\S]*?where id = '([a-z-]+)'/g)].map((m) => m[1]!))
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((b) => !limited.has(b))).toEqual([])
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
