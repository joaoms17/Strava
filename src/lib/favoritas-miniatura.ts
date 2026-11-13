import type { Favorite } from './types'

// A miniatura (256 px) de uma foto de favorita: ao lado, com «_t» (como as
// refeições). As listas mostram-na em vez da foto de 1 024 px (P6).
export const thumbPathOf = (path: string): string => path.replace(/(\.jpg)?$/, '_t.jpg')

// O que as listas mostram: a miniatura quando existe, senão a foto.
export const favoriteThumb = (f: Pick<Favorite, 'photo_path' | 'thumb_path'>): string | null =>
  f.thumb_path ?? f.photo_path
