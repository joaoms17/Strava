// A foto escolhida na folha (+) passa para o ecrã Registar sem perder o
// gesto do utilizador (o iOS só abre a câmara dentro de um toque).
let pending: { file: File; source: 'camera' | 'gallery' } | null = null

export function setPendingPhoto(file: File, source: 'camera' | 'gallery'): void {
  pending = { file, source }
}

export function takePendingPhoto(): { file: File; source: 'camera' | 'gallery' } | null {
  const value = pending
  pending = null
  return value
}
