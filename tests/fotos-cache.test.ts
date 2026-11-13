import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pickCachedUrls, pruneUrlCache } from '../src/lib/photo-url-cache'
import { favoriteThumb, thumbPathOf } from '../src/lib/favoritas-miniatura'

// P6: os URLs assinados guardam-se por caminho e só se pedem outra vez quando
// estão perto de expirar; as favoritas mostram a miniatura nas listas.

const DAY = 86_400_000

describe('P6 · cache dos URLs assinados', () => {
  const now = Date.parse('2026-11-13T10:00:00Z')
  const store = {
    'meal-photos/a.jpg': { url: 'https://x/a', until: now + 5 * DAY },
    'meal-photos/b.jpg': { url: 'https://x/b', until: now + DAY / 2 },
    'workout-shots/a.jpg': { url: 'https://x/wa', until: now + 5 * DAY },
  }

  it('reaproveita os que ainda valem mais de um dia, por bucket e caminho', () => {
    const { result, missing } = pickCachedUrls(store, 'meal-photos', ['a.jpg', 'b.jpg', 'c.jpg', 'a.jpg'], now, DAY)
    expect(result).toEqual({ 'a.jpg': 'https://x/a' })
    expect(missing).toEqual(['b.jpg', 'c.jpg'])
  })

  it('tira os expirados e fica com os que duram mais', () => {
    const pruned = pruneUrlCache({ ...store, 'meal-photos/old.jpg': { url: 'u', until: now - 1 } }, now, 2)
    expect(Object.keys(pruned).sort()).toEqual(['meal-photos/a.jpg', 'workout-shots/a.jpg'])
  })

  it('aguenta lixo no armazenamento', () => {
    const bad = { 'meal-photos/a.jpg': null } as unknown as Parameters<typeof pruneUrlCache>[0]
    expect(pruneUrlCache(bad, now, 10)).toEqual({})
    expect(pickCachedUrls(bad, 'meal-photos', ['a.jpg'], now, DAY).missing).toEqual(['a.jpg'])
  })
})

describe('P6 · miniaturas das favoritas', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/lib/favorites.ts'), 'utf8')

  it('a miniatura fica ao lado da foto, com «_t»', () => {
    expect(thumbPathOf('u/fav/abc-1.jpg')).toBe('u/fav/abc-1_t.jpg')
    expect(favoriteThumb({ photo_path: 'u/fav/a.jpg', thumb_path: 'u/fav/a_t.jpg' })).toBe('u/fav/a_t.jpg')
    // Favorita antiga (ou sem a migração): a foto.
    expect(favoriteThumb({ photo_path: 'u/fav/a.jpg' })).toBe('u/fav/a.jpg')
    expect(favoriteThumb({ photo_path: null, thumb_path: null })).toBeNull()
  })

  it('grava sem a coluna thumb_path quando a migração ainda não correu', () => {
    expect(src).toMatch(/missingThumbColumn\(error\)/)
  })

  it('a limpeza dos ficheiros sem dono guarda a miniatura da favorita', () => {
    const sql = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', 'supabase/migrations/20261113000060_favoritas_miniatura.sql'),
      'utf8',
    )
    expect(sql).toMatch(/f\.thumb_path = o\.name/)
  })
})
