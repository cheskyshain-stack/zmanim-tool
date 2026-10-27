self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let message;
    try { message = event.data.json(); } catch { message = {}; }
    let url = new URL('/announcements/', self.location.origin);
    try {
      const requested = new URL(message.url, self.location.origin);
      if (requested.origin === url.origin && requested.pathname === '/announcements/') url = requested;
    } catch { /* Open the announcements list. */ }
    await self.registration.showNotification(typeof message.title === 'string' ? message.title.slice(0, 120) : 'Shul announcement', {
      body: typeof message.body === 'string' ? message.body.slice(0, 180) : 'A new message was posted.',
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: typeof message.tag === 'string' ? message.tag : 'shul-announcement', data: { url: url.href },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/announcements/', self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/announcements/') return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(window => new URL(window.url).pathname === '/announcements/');
    if (existing) { await existing.navigate(target.href); await existing.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
