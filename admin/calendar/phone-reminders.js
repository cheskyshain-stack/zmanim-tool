self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const url = new URL('/admin/calendar/', self.location.origin);
  if (payload?.messageAlert === true && (payload.test === true || Number.isSafeInteger(payload.sequence) && payload.sequence > 0)) {
    url.searchParams.set('messages', '1');
    event.waitUntil(self.registration.showNotification(payload.test ? 'Shul test alert' : 'New Shul message', {
      body: payload.test ? 'Message alerts can reach this device.' : 'Open Messages to read the update.',
      icon: '/icons/calendar/icon-192.png?v=1',
      tag: payload.test ? 'shul-message-test' : 'shul-message-' + payload.sequence, data: url.href,
    }));
    return;
  }
  if (payload?.test === true) {
    event.waitUntil(self.registration.showNotification('Calendar test alert', {
      body: 'Phone reminders can reach this device.', icon: '/icons/calendar/icon-192.png?v=1',
      tag: 'calendar-reminder-test', data: url.href,
    }));
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload?.date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(payload?.day || '')) return;
  url.searchParams.set('simcha', payload.date);
  if (typeof payload.eventId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(payload.eventId)) {
    url.searchParams.set('event', payload.eventId);
  }
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
  if (url.searchParams.has('event') || url.searchParams.has('messages')) {
    event.waitUntil(self.clients.openWindow(url.href));
    return;
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const same = clients.find(client => client.url === url.href);
    return same ? same.focus() : self.clients.openWindow(url.href);
  }));
});
