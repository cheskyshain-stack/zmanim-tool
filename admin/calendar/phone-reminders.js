self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload?.date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(payload?.day || '')) return;
  const url = new URL('/admin/calendar/', self.location.origin);
  url.searchParams.set('simcha', payload.date);
  if (payload.post === true) url.searchParams.set('post', '1');
  event.waitUntil(self.registration.showNotification('Simcha reminder', {
    body: payload.post === true ? 'Open the calendar to post a simcha reminder.' : 'Open the calendar for the simcha details.',
    icon: '/icons/calendar/icon-192.png?v=1', tag: 'simcha-' + (Number.isSafeInteger(payload.slot) ? payload.slot : payload.day), data: url.href,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data, self.location.origin);
  if (url.origin !== self.location.origin || url.pathname !== '/admin/calendar/') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const same = clients.find(client => client.url === url.href);
    return same ? same.focus() : self.clients.openWindow(url.href);
  }));
});
