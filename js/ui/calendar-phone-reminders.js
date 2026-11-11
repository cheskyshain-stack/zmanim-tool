import { calendarRequest } from '../calendar/api.js';
import { CALENDAR_REMINDER_TYPES, DEFAULT_CALENDAR_REMINDER_RULE } from '../calendar/reminder-date.js';

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

function showReminderSchedule(container, endpoint, initial) {
  container.innerHTML = `<form class="cal-form">
    <h3>Reminder times</h3>
    <label>Applies to<select name="category"><option value="all">All simcha categories</option>${CALENDAR_REMINDER_TYPES.map(type => `<option value="${type.id}">${type.label}</option>`).join('')}</select></label>
    <div data-reminder-inherit hidden><label class="cal-checkbox"><input type="checkbox" name="inherit"> Use the all-category schedule</label></div>
    <div data-reminder-times><div class="cal-form-row">
      <label>Weekday reminder<select name="day"><option value="day-of">Day of the simcha</option><option value="day-before">Day before the simcha</option></select></label>
      <label>Reminder time<input name="time" type="time" required></label>
    </div><label>Friday time for Shabbos (optional)<input name="fridayTime" type="time"></label>
    <p class="cal-form-note">Shabbos simchos use Friday. Leave the Friday time blank to use the same time. All times are New York time.</p></div>
    <button type="submit">Save reminder times</button><p data-reminder-saved role="status" aria-live="polite"></p>
  </form>`;
  let schedule = initial;
  const form = container.querySelector('form'), { category, inherit, day, time, fridayTime } = form.elements;
  const status = form.querySelector('[data-reminder-saved]'), save = form.querySelector('[type=submit]');
  const timing = form.querySelector('[data-reminder-times]');
  function displayTimes() {
    timing.hidden = inherit.checked;
    for (const field of [day, time, fridayTime]) field.disabled = inherit.checked;
  }
  function showCategory() {
    const all = category.value === 'all', custom = schedule.categories[category.value];
    const rule = custom || schedule.standard || DEFAULT_CALENDAR_REMINDER_RULE;
    form.querySelector('[data-reminder-inherit]').hidden = all;
    inherit.checked = !all && !custom;
    day.value = rule.day; time.value = rule.time; fridayTime.value = rule.fridayTime;
    status.textContent = '';
    displayTimes();
  }
  category.addEventListener('change', showCategory);
  inherit.addEventListener('change', displayTimes);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const updated = { ...schedule, categories: { ...schedule.categories } };
    const rule = { day: day.value, time: time.value, fridayTime: fridayTime.value };
    if (category.value === 'all') updated.standard = rule;
    else if (inherit.checked) delete updated.categories[category.value];
    else updated.categories[category.value] = rule;
    for (const control of [save, category, inherit, day, time, fridayTime]) control.disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = await calendarRequest('/api/phone-reminders/schedule', { method: 'PUT', body: { endpoint, schedule: updated } });
      schedule = result.schedule;
      status.textContent = 'Reminder times saved for this phone.';
    } catch (error) { status.textContent = error.message; }
    finally {
      save.disabled = category.disabled = inherit.disabled = false;
      displayTimes();
    }
  });
  showCategory();
}

export async function openCalendarPhoneReminders(dialog, publicKey, schedules = false) {
  const description = schedules ? 'Get phone alerts for simchos. The default is 9:00 a.m. New York time, on the day of the simcha or on Friday for Shabbos. These settings apply to this device.' : 'Get a phone notification at 9:00 a.m. New York time on mornings when a simcha reminder is scheduled. This setting applies to this device.';
  const view = dialog(`<div class="cal-form"><p>${description}</p><button type="button" class="cal-primary" disabled>Turn on phone reminders</button><p role="status" aria-live="polite"></p><div data-reminder-schedule></div></div>`);
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
    const current = subscription && await calendarRequest('/api/phone-reminders/status', { method: 'POST', body: { endpoint: subscription.endpoint } });
    let enabled = !!current?.enabled;
    if (!view.el.isConnected) return;
    const scheduleForm = view.el.querySelector('[data-reminder-schedule]');
    if (schedules && enabled && current.schedule) showReminderSchedule(scheduleForm, subscription.endpoint, current.schedule);
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
          scheduleForm.replaceChildren();
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
          if (schedules && enabled && result.schedule) showReminderSchedule(scheduleForm, subscription.endpoint, result.schedule);
        }
        paint();
      } catch (error) { paint(`${failure} ${error.message || ''}`.trim()); }
    });
  } catch (error) { status.textContent = error.message; }
}
