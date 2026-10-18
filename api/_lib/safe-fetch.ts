import https from 'node:https'
import dns from 'node:dns'
import zlib from 'node:zlib'
import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'
import { HttpError } from './supabase.js'
import { MAX_PAGE_BYTES, charsetOf, checkRecipeUrl, isPublicAddress } from './rules/receita.js'

// Ler uma página que a pessoa colou (a receita), sem deixar o servidor ir à
// rede interna: só https, só endereços públicos — verificados na própria
// ligação, por isso um nome que resolve para 127.0.0.1 ou 169.254.169.254
// também falha —, no máximo 3 redirecionamentos (cada um verificado outra
// vez), 2 MB e 8 s no total.

const MAX_REDIRECTS = 3
const TOTAL_MS = 8_000

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

function publicLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, [])
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error(`endereço não público: ${hostname}`), { code: 'EPRIVATE' }), [])
    }
    if (options.all) return callback(null, list)
    callback(null, list[0]!.address, list[0]!.family)
  })
}

interface Page {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

function getOnce(url: URL, deadline: number): Promise<Page> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        lookup: publicLookup as unknown as typeof dns.lookup,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EpocaDoRegresso/0.2; receita pedida por quem usa a app)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'pt-PT,pt;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) })
          return
        }
        if (Number(res.headers['content-length']) > MAX_PAGE_BYTES) {
          req.destroy()
          reject(new HttpError(422, 'Essa página é grande demais. Copia o texto da receita e cola-o aqui.'))
          return
        }
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
        let stream: Readable = res
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip())
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress())
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          // Conta depois de descomprimir: uma página pequena não rebenta a memória.
          if (size > MAX_PAGE_BYTES) {
            req.destroy()
            stream.destroy()
            reject(new HttpError(422, 'Essa página é grande demais. Copia o texto da receita e cola-o aqui.'))
          } else chunks.push(chunk)
        })
        stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
        stream.on('error', reject)
        // A ligação cortada a meio (com gzip, o erro não passa pelo pipe).
        if (stream !== res) res.on('error', reject)
        res.on('close', () => {
          if (res.complete) return
          const err = new Error('ligação cortada')
          if (Date.now() >= deadline) err.name = 'TimeoutError'
          reject(err)
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function decode(body: Buffer, contentType: string | undefined): string {
  const charset = charsetOf(contentType, body.subarray(0, 2048).toString('latin1'))
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

// O HTML da página, ou um HttpError com a frase para a app.
export async function fetchPublicPage(input: string): Promise<{ url: string; html: string }> {
  const checked = checkRecipeUrl(input)
  if ('error' in checked) throw new HttpError(400, checked.error)
  let url = checked.url
  const deadline = Date.now() + TOTAL_MS
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let page: Page
    try {
      page = await getOnce(url, deadline)
    } catch (err) {
      if (err instanceof HttpError) throw err
      const e = err as { code?: string; name?: string }
      if (e.code === 'EPRIVATE') throw new HttpError(400, 'Esse link não é de uma página pública.')
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new HttpError(504, 'A página demorou demasiado a abrir. Copia o texto da receita e cola-o aqui.')
      }
      throw new HttpError(502, 'Não consegui abrir essa página. Copia o texto da receita e cola-o aqui.')
    }
    if (page.status >= 300 && page.status < 400) {
      const location = page.headers.location
      if (!location) throw new HttpError(422, 'Não consegui abrir essa página.')
      if (hop === MAX_REDIRECTS) break
      let target: string
      try {
        target = new URL(location, url).toString()
      } catch {
        throw new HttpError(422, 'Não consegui abrir essa página.')
      }
      const next = checkRecipeUrl(target)
      if ('error' in next) throw new HttpError(400, next.error)
      url = next.url
      continue
    }
    if (page.status === 403 || page.status === 429) {
      throw new HttpError(422, 'Esse site não deixa ler a receita. Copia o texto da receita e cola-o aqui.')
    }
    if (page.status < 200 || page.status >= 300) throw new HttpError(422, 'Não consegui abrir essa página.')
    const type = String(page.headers['content-type'] ?? '')
    if (type && !/html|xml|text\/plain/i.test(type)) throw new HttpError(422, 'Esse link não é de uma página de receita.')
    return { url: url.toString(), html: decode(page.body, type) }
  }
  throw new HttpError(422, 'Esse link redireciona demasiadas vezes.')
}
