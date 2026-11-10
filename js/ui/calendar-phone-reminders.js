import { calendarRequest } from '../calendar/api.js';

const workerPath = '/admin/calendar/phone-reminders.js';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const browserKey = key => Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));

async function removePhoneReminder(subscription) {
  await calendarRequest('/api/phone-reminders', { method: 'DELETE', body: { endpoint: subscription.endpoint }, signal: AbortSignal.timeout(4000) });
}

export async function turnOffCalendarPhoneReminders() {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/admin/calendar/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try { await removePhoneReminder(subscription); }
  finally { await subscription.unsubscribe(); }
}

export async function openCalendarPhoneReminders(dialog, publicKey) {
  const view = dialog('<div class="cal-form"><p>Get a phone notification at 9:00 a.m. New York time on mornings when a simcha reminder is scheduled. This setting applies to this device.</p><button type="button" class="cal-primary" disabled>Turn on phone reminders</button><p role="status" aria-live="polite"></p></div>');
  view.title('Phone reminders');
  const status = view.el.querySelector('[role=status]'), button = view.el.querySelector('.cal-primary');
  if (!supported()) {
    status.textContent = 'On iPhone or iPad, add the calendar to your Home Screen and open it from its icon. On Android, open it in Chrome.';
    return;
  }
  try {
    const registered = await navigator.serviceWorker.register(workerPath);
    const registration = registered.active ? registered : await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    let enabled = subscription && (await calendarRequest('/api/phone-reminders/status', { method: 'POST', body: { endpoint: subscription.endpoint } })).enabled;
    if (!view.el.isConnected) return;
    function paint(message = '') {
      button.textContent = enabled ? 'Turn off phone reminders' : 'Turn on phone reminders';
      button.disabled = false;
      status.textContent = message || (Notification.permission === 'denied' ? 'Your browser reports that notifications for this site are blocked.' : enabled ? 'Phone reminders are on for this device.' : '');
    }
    paint();
    button.addEventListener('click', async () => {
      button.disabled = true;
      let failure = 'Couldn’t turn off phone reminders.';
      try {
        if (enabled) {
          status.textContent = 'Turning off phone reminders…';
          await removePhoneReminder(subscription);
          enabled = false;
          try { await subscription.unsubscribe(); subscription = null; } catch { /* The server has already turned off reminders. */ }
        } else {
          if (Notification.permission !== 'granted') {
            failure = 'Couldn’t request notification permission.';
            status.textContent = 'Waiting for notification permission. Choose Allow if your browser asks.';
            const permission = await Notification.requestPermission();
            if (!view.el.isConnected) return;
            if (permission !== 'granted') {
              paint(permission === 'denied'
                ? 'The browser still blocks notifications. Reset this site’s notification permission in your browser, then try again.'
                : 'Notification permission is still pending. Tap Turn on phone reminders and choose Allow when your browser asks.');
              return;
            }
            if (!subscription && navigator.userActivation?.isActive === false) {
              paint('Notifications are allowed. Tap Turn on phone reminders once more to finish.');
              return;
            }
          }
          failure = 'The browser couldn’t register this phone for notifications.';
          status.textContent = 'Registering this phone for reminders…';
          subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: browserKey(publicKey) });
          failure = 'The calendar couldn’t save reminders for this phone.';
          const result = await calendarRequest('/api/phone-reminders', { method: 'PUT', body: { subscription: subscription.toJSON() } });
          enabled = result.enabled;
        }
        paint();
      } catch (error) { paint(`${failure} ${error.message || ''}`.trim()); }
    });
  } catch (error) { status.textContent = error.message; }
}
