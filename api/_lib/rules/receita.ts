// Importar uma receita (link ou texto colado) para uma favorita por dose:
// o link só pode apontar para a internet pública (https, nunca a rede local
// nem o próprio servidor), a página lê-se primeiro pelo schema.org Recipe
// (JSON-LD) e, sem ele, pelo texto visível. Sem supabase nem node.

// ---------------------------------------------------------------------
// Endereços: só a internet pública
// ---------------------------------------------------------------------
function ipv4Bytes(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255) ? bytes : null
}

function publicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false // «esta rede», privada, loopback
  if (a === 100 && b! >= 64 && b! <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false // link-local (metadados das clouds)
  if (a === 172 && b! >= 16 && b! <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // IETF, documentação
  if (a === 198 && (b === 18 || b === 19)) return false // testes de rede
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return a! < 224 // multicast e reservados
}

// Os 8 grupos de 16 bits de um IPv6 (aceita «::» e um IPv4 no fim).
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (tail) {
    const v4 = ipv4Bytes(tail[1]!)
    if (!v4) return null
    text = text.slice(0, -tail[1]!.length) + `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const read = (s: string) => (s ? s.split(':') : [])
  const head = read(halves[0]!)
  const rest = halves.length === 2 ? read(halves[1]!) : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...rest]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

export function isPublicAddress(ip: string): boolean {
  const v4 = ipv4Bytes(ip)
  if (v4) return publicIpv4(v4)
  const g = ipv6Groups(ip)
  if (!g) return false
  // IPv4 dentro de IPv6 (::ffff:a.b.c.d e ::a.b.c.d): decide o IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return publicIpv4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255])
  }
  // Só unicast global (2000::/3), sem documentação, 6to4 nem Teredo (levam
  // um IPv4 que pode ser privado) e sem NAT64.
  if (g[0]! < 0x2000 || g[0]! > 0x3fff) return false
  if (g[0] === 0x2001 && (g[1] === 0xdb8 || g[1] === 0)) return false
  if (g[0] === 0x2002) return false
  return true
}

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i

// O link pedido: https, sem utilizador nem palavra-passe, na porta normal e
// com um nome de domínio (ou um IP público). Devolve a frase do erro.
export function checkRecipeUrl(input: string): { url: URL } | { error: string } {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { error: 'Esse link não parece válido.' }
  }
  if (url.protocol !== 'https:') return { error: 'O link tem de começar por https://.' }
  if (url.username || url.password) return { error: 'Esse link não parece válido.' }
  if (url.port && url.port !== '443') return { error: 'Esse link não parece válido.' }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const literal = ipv4Bytes(host) != null || host.includes(':')
  if (literal ? !isPublicAddress(host) : !host.includes('.') || LOCAL_NAMES.test(host)) {
    return { error: 'Esse link não é de uma página pública.' }
  }
  url.hash = ''
  return { url }
}

// ---------------------------------------------------------------------
// A página: schema.org Recipe primeiro, o texto visível como recurso
// ---------------------------------------------------------------------
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°',
  frac12: '½', frac14: '¼', frac34: '¾', middot: '·', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', times: '×',
}
const MARKS: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    if (NAMED[code]) return NAMED[code]!
    // Letras com acento (&atilde; &Ccedil; …).
    const mark = /^([a-z])(acute|grave|circ|tilde|uml|cedil)$/i.exec(code)
    return mark ? (mark[1]! + MARKS[mark[2]!.toLowerCase()]!).normalize('NFC') : whole
  })
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? decodeEntities(v.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

export const MAX_DOSES = 30
export const MAX_INGREDIENTS = 60

// «4», «4 doses», «Para 6 pessoas», ["4", "4 porções"]: o primeiro número de doses.
export function parseServings(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = parseServings(v)
      if (n != null) return n
    }
    return null
  }
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(/(\d+)/.exec(value)?.[1]) : NaN
  return Number.isInteger(n) && n >= 1 && n <= MAX_DOSES ? n : null
}

export interface RecipeData {
  name: string | null
  ingredients: string[]
  servings: number | null
  // Por dose, como o site a escreve («350 kcal», «20 g»): só para conferir.
  nutrition: Record<string, string> | null
}

function isRecipe(node: Record<string, unknown>): boolean {
  const type = node['@type']
  const types = Array.isArray(type) ? type : [type]
  return types.some((t) => typeof t === 'string' && /(^|[/:])recipe$/i.test(t.trim()))
}

function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipe(child, depth + 1)
      if (found) return found
    }
    return null
  }
  const obj = node as Record<string, unknown>
  if (isRecipe(obj)) return obj
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const found = findRecipe(obj[key], depth + 1)
    if (found) return found
  }
  return null
}

function parseJson(raw: string): unknown {
  const text = raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .trim()
  try {
    return JSON.parse(text)
  } catch {
    // Alguns sites deixam mudanças de linha cruas dentro das strings.
    try {
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '))
    } catch {
      return null
    }
  }
}

// O primeiro schema.org Recipe da página com ingredientes; null sem nenhum.
export function extractRecipe(html: string): RecipeData | null {
  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)
  for (const block of blocks) {
    const recipe = findRecipe(parseJson(block[1] ?? ''))
    if (!recipe) continue
    const raw = recipe.recipeIngredient ?? recipe.ingredients
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\n|<br\s*\/?>/i) : []
    const ingredients = list
      .map((i) => clean(i, 200))
      .filter(Boolean)
      .slice(0, MAX_INGREDIENTS)
    if (ingredients.length === 0) continue
    const facts = recipe.nutrition && typeof recipe.nutrition === 'object' ? (recipe.nutrition as Record<string, unknown>) : null
    const nutrition: Record<string, string> = {}
    for (const key of ['calories', 'proteinContent', 'carbohydrateContent', 'fatContent', 'servingSize']) {
      const value = clean(typeof facts?.[key] === 'number' ? String(facts[key]) : facts?.[key], 40)
      if (value) nutrition[key] = value
    }
    return {
      name: clean(recipe.name, 120) || null,
      ingredients,
      servings: parseServings(recipe.recipeYield),
      nutrition: Object.keys(nutrition).length ? nutrition : null,
    }
  }
  return null
}

// O título da página (og:title ou <title>), para quando não há Recipe.
export function pageTitle(html: string): string | null {
  const og = /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*>/i.exec(html)?.[0]
  const content = og ? /content\s*=\s*["']([^"']*)["']/i.exec(og)?.[1] : null
  return clean(content ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '', 120) || null
}

// O texto que se vê na página (sem scripts, estilos nem menus), a começar um
// pouco antes dos «Ingredientes» quando aparecem, até `max` caracteres.
export function visibleText(html: string, max = 12_000): string {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr|\/ul|\/ol|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  const start = lines.search(/ingredientes/i)
  return lines.slice(start > 300 ? start - 300 : 0).slice(0, max)
}

// Os carateres de uma página que se leem (o resto não serve para a receita).
export const MAX_PAGE_BYTES = 2_000_000

export function charsetOf(contentType: string | null | undefined, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  const fromMeta = /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]
  return (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
}
