// Notificações (Definições › Notificações), carregado pelo service worker da
// app (workbox.importScripts no vite.config.ts). O servidor manda
// {title, body, url, tag}; o iPhone exige que cada envio mostre uma.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Daily Track', {
      body: data.body || '',
      tag: data.tag || undefined,
      lang: 'pt-PT',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: typeof data.url === 'string' ? data.url : '/hoje' },
    }),
  )
})

// Tocar abre a app no sítio certo (o dia da refeição, o Balanço…). Com a app
// já aberta, muda de ecrã sem recarregar (não perde o que está a meio).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/hoje', self.location.origin)
  if (target.origin !== self.location.origin) return
  const path = target.pathname + target.search
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        await open.focus().catch(() => undefined)
        open.postMessage({ type: 'abrir', url: path })
        return
      }
      await self.clients.openWindow(path)
    })(),
  )
})
