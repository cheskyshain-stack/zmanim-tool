import { announcementRequest } from './api.js';

const pushKey = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
export async function renderAnnouncementNotifications(host) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !installed) { host.textContent = 'To get phone notifications on iPhone, add this site to your Home Screen in Safari, then open it from there.'; return; }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || !isSecureContext) { host.textContent = 'Phone notifications are not supported in this browser. You can read every announcement here.'; return; }
  host.innerHTML = '<button type="button" id="announcement-notify">Notify me of new messages</button><p class="announcement-note" role="status" id="announcement-notify-status"></p>';
  const button = host.querySelector('button'), status = host.querySelector('[role=status]');
  let current = null;
  const show = () => {
    button.textContent = current ? 'Turn off notifications' : 'Notify me of new messages';
    button.disabled = Notification.permission === 'denied';
    status.textContent = current ? 'Notifications are on for this device.' : Notification.permission === 'denied' ? 'Notifications are blocked. You can change this in your browser or phone settings.' : 'Optional. You can turn them off here at any time.';
  };
  try {
    const registration = await navigator.serviceWorker.getRegistration('/announcements/');
    if (registration?.active?.scriptURL && new URL(registration.active.scriptURL).pathname === '/announcements-sw.js') current = await registration.pushManager.getSubscription();
    // A browser subscription without a successful server registration is not called on.
    if (current) await announcementRequest('/api/subscriptions', { method: 'POST', body: current.toJSON() });
    show();
  } catch { current = null; show(); }
  button.addEventListener('click', async () => {
    // Request permission directly from this user gesture, including on Safari.
    const permission = current ? null : Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    button.disabled = true;
    try {
      if (current) {
        const sub = current;
        try { await announcementRequest('/api/subscriptions', { method: 'DELETE', body: sub.toJSON() }); }
        catch { /* Unsubscribing in the browser invalidates the endpoint too. */ }
        const removed = await sub.unsubscribe();
        if (!removed) throw new Error('Notifications could not be turned off. Please try again.');
        current = null; show(); return;
      }
      if (await permission !== 'granted') { show(); return; }
      const info = await announcementRequest('/api/info');
      if (!info.ready || !info.publicKey) throw new Error('Notifications are not available yet.');
      const registration = await navigator.serviceWorker.register('/announcements-sw.js', { scope: '/announcements/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey(info.publicKey) });
      await announcementRequest('/api/subscriptions', { method: 'POST', body: sub.toJSON() });
      current = sub; show();
    } catch (error) {
      show(); status.textContent = error.message || 'Notifications could not be enabled. Please try again.';
    } finally { button.disabled = Notification.permission === 'denied'; }
  });
}
