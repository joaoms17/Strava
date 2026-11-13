import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// H16: o tamanho da letra em rem (text-[0.9375rem], não text-[15px]), para
// o tamanho de letra do navegador e o zoom se aplicarem ao texto. Os
// espaçamentos ficam em px. O Hoje.tsx ainda está em px (estava a ser mudado
// noutra frente): passa a rem com a mesma substituição.
const SRC = path.resolve(import.meta.dirname, '..', 'src')
const AINDA_EM_PX = new Set<string>([])

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return files(full)
    return /\.(tsx?|css)$/.test(e.name) ? [full] : []
  })
}

describe('H16 · letra em rem', () => {
  it('nenhum text-[Npx]', () => {
    const offenders = files(SRC)
      .filter((f) => !AINDA_EM_PX.has(path.relative(SRC, f).split(path.sep).join('/')))
      .filter((f) => /text-\[\d+(?:\.\d+)?px\]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })

  it('o CSS não fixa font-size em px', () => {
    expect(fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')).not.toMatch(/font-size:\s*\d+px/)
  })
})
