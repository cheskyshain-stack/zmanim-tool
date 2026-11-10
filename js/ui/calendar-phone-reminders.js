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
    function paint() {
      button.textContent = enabled ? 'Turn off phone reminders' : 'Turn on phone reminders';
      button.disabled = !enabled && Notification.permission === 'denied';
      status.textContent = enabled ? 'Phone reminders are on for this device.' : button.disabled ? 'Allow calendar notifications in your browser settings, then reopen this panel.' : '';
    }
    paint();
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (enabled) {
          await removePhoneReminder(subscription);
          enabled = false;
          try { await subscription.unsubscribe(); subscription = null; } catch { /* The server has already turned off reminders. */ }
        } else {
          subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: browserKey(publicKey) });
          const result = await calendarRequest('/api/phone-reminders', { method: 'PUT', body: { subscription: subscription.toJSON() } });
          enabled = result.enabled;
        }
        paint();
      } catch (error) { paint(); if (!status.textContent || enabled) status.textContent = error.message; }
    });
  } catch (error) { status.textContent = error.message; }
}
