import { calendarRequest } from '../calendar/api.js';
import { CALENDAR_REMINDER_TYPES, DEFAULT_CALENDAR_REMINDER_RULE } from '../calendar/reminder-date.js';

const calendarPath = '/admin/calendar/';
const workerPath = calendarPath + 'phone-reminders.js?v=4';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const browserKey = key => Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const reminderClock = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
const reminderDateTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });

async function removePhoneReminder(subscription, mode) {
  return calendarRequest('/api/phone-reminders', { method: 'DELETE', body: { endpoint: subscription.endpoint, mode }, signal: AbortSignal.timeout(4000) });
}

export async function refreshCalendarPhoneReminderWorker() {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration(calendarPath);
  if (registration?.scope === new URL(calendarPath, location.origin).href) await navigator.serviceWorker.register(workerPath);
}

export async function turnOffCalendarPhoneReminders() {
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration(calendarPath);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try { await removePhoneReminder(subscription, 'all'); }
  finally { await subscription.unsubscribe(); }
}

function reminderRow(id, label) {
  return `<div class="cal-reminder-row" data-reminder-rule="${id}">
    <div class="cal-reminder-time"><label for="cal-reminder-${id}">${label}</label><input id="cal-reminder-${id}" name="time" type="time" required></div>
    <details class="cal-extra cal-reminder-details"><summary></summary><div class="cal-form-row">
      <label>Weekday reminder<select name="day"><option value="day-of">Day of the simcha</option><option value="day-before">Day before the simcha</option></select></label>
      <label>Friday time (optional)<input name="fridayTime" type="time"></label>
    </div></details>
  </div>`;
}

function showReminderSchedule(container, endpoint, initial, onSaved) {
  container.innerHTML = `<form class="cal-form cal-reminder-schedule" aria-label="Reminder times">
    <label class="cal-reminder-toggle">All the same<input type="checkbox" name="sameTime" role="switch" aria-controls="cal-reminder-shared cal-reminder-categories"><span aria-hidden="true" class="cal-reminder-track"></span></label>
    <p class="cal-form-note">Times are New York time. Shabbos simchos use Friday.</p>
    <fieldset id="cal-reminder-shared" aria-label="All simcha categories">${reminderRow('all', 'Reminder time')}</fieldset>
    <fieldset id="cal-reminder-categories" aria-label="Simcha categories">${CALENDAR_REMINDER_TYPES.map(type => reminderRow(type.id, type.label)).join('')}</fieldset>
    <button class="cal-primary" type="submit">Save reminder times</button><p role="status" aria-live="polite"></p>
  </form>`;
  let schedule = initial, sharedEdited = false;
  const edited = new Set(Object.keys(initial.categories));
  const form = container.querySelector('form'), mode = form.elements.sameTime;
  const shared = form.querySelector('#cal-reminder-shared'), categories = form.querySelector('#cal-reminder-categories');
  const status = form.querySelector('[role=status]'), save = form.querySelector('[type=submit]');
  const rows = Object.fromEntries([...form.querySelectorAll('[data-reminder-rule]')].map(row => [row.dataset.reminderRule, {
    day: row.querySelector('select'), time: row.querySelector('[name=time]'), fridayTime: row.querySelector('[name=fridayTime]'), summary: row.querySelector('summary'),
  }]));
  const readRule = ({ day, time, fridayTime }) => ({ day: day.value, time: time.value, fridayTime: fridayTime.value });
  function summarize({ day, fridayTime, summary }) {
    const friday = fridayTime.value && reminderClock.format(new Date(`2000-01-01T${fridayTime.value}:00Z`));
    summary.textContent = `${day.value === 'day-before' ? 'Day before' : 'Day of'}${friday ? ` · Friday ${friday}` : ''}`;
  }
  function fillRule(row, rule) {
    row.day.value = rule.day; row.time.value = rule.time; row.fridayTime.value = rule.fridayTime;
    summarize(row);
  }
  function displayMode() {
    shared.disabled = shared.hidden = !mode.checked;
    categories.disabled = categories.hidden = mode.checked;
    const standard = readRule(rows.all);
    if (!mode.checked) for (const type of CALENDAR_REMINDER_TYPES) {
      if (!edited.has(type.id)) fillRule(rows[type.id], standard.time ? standard : schedule.standard || DEFAULT_CALENDAR_REMINDER_RULE);
    }
  }
  mode.checked = initial.sameTime ?? !edited.size;
  fillRule(rows.all, initial.standard || DEFAULT_CALENDAR_REMINDER_RULE);
  for (const type of CALENDAR_REMINDER_TYPES) fillRule(rows[type.id], initial.categories[type.id] || initial.standard || DEFAULT_CALENDAR_REMINDER_RULE);
  displayMode();
  mode.addEventListener('change', displayMode);
  form.addEventListener('input', event => {
    status.textContent = '';
    const id = event.target.closest('[data-reminder-rule]')?.dataset.reminderRule;
    if (!id) return;
    if (id === 'all') sharedEdited = true;
    else edited.add(id);
    summarize(rows[id]);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const sameTime = mode.checked, standard = readRule(rows.all);
    const updated = { revision: schedule.revision, sameTime,
      standard: sameTime || sharedEdited && standard.time ? standard : schedule.standard,
      categories: sameTime ? schedule.categories : Object.fromEntries([...edited].map(id => [id, readRule(rows[id])])),
    };
    save.disabled = mode.disabled = shared.disabled = categories.disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = await calendarRequest('/api/phone-reminders/schedule', { method: 'PUT', body: { endpoint, schedule: updated } });
      schedule = result.schedule;
      onSaved(result);
      status.textContent = 'Reminder times saved for this phone.';
    } catch (error) { status.textContent = error.message; }
    finally {
      save.disabled = mode.disabled = false;
      displayMode();
    }
  });
}

export async function openCalendarPhoneReminders(dialog, publicKey, schedules = false, mode = 'simcha') {
  const messages = mode === 'messages', setting = messages ? 'message alerts' : 'phone reminders';
  const description = messages ? 'Get a notification on this phone when the Shul posts a new message. Sound follows your phone’s notification settings.'
    : schedules ? 'Get phone alerts for simchos. The default is 9:00 a.m. New York time, on the day of the simcha or on Friday for Shabbos. These settings apply to this device.' : 'Get a phone notification at 9:00 a.m. New York time on mornings when a simcha reminder is scheduled. This setting applies to this device.';
  const view = dialog(`<div class="cal-form"><div data-reminder-schedule hidden></div><p data-reminder-description>${description}</p>
    <div data-reminder-delivery hidden><p data-reminder-next class="cal-form-note"></p><p data-reminder-last class="cal-form-note" hidden></p></div>
    <button type="button" data-reminder-test hidden>Send test alert</button><button type="button" class="cal-primary" disabled>Turn on ${setting}</button><p role="status" aria-live="polite"></p></div>`);
  view.title(messages ? 'Message alerts' : 'Phone reminders');
  const status = view.el.querySelector('[role=status]'), button = view.el.querySelector('.cal-primary');
  const test = view.el.querySelector('[data-reminder-test]'), delivery = view.el.querySelector('[data-reminder-delivery]');
  if (!supported()) {
    status.textContent = 'On iPhone or iPad, add the calendar to your Home Screen and open it from its icon. On Android, open it in Chrome.';
    return;
  }
  try {
    const registered = await navigator.serviceWorker.register(workerPath);
    const update = registered.installing || registered.waiting;
    if (update) await new Promise(resolve => {
      const check = () => {
        if (update.state !== 'activated' && update.state !== 'redundant') return;
        update.removeEventListener('statechange', check); resolve();
      };
      update.addEventListener('statechange', check); check();
    });
    const registration = registered.active ? registered : await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    const current = subscription && await calendarRequest('/api/phone-reminders/status', { method: 'POST', body: { endpoint: subscription.endpoint } });
    const key = browserKey(publicKey), existingKey = subscription?.options?.applicationServerKey;
    const wrongKey = existingKey && new Uint8Array(existingKey).toString() !== key.toString();
    let enabled = !!(messages ? current?.messageAlerts : current?.enabled) && !wrongKey;
    let previousEndpoint = wrongKey || !(current?.registered ?? current?.enabled) ? subscription?.endpoint : undefined;
    if (!view.el.isConnected) return;
    const scheduleForm = view.el.querySelector('[data-reminder-schedule]');
    function paintDelivery(result) {
      const next = delivery.querySelector('[data-reminder-next]'), last = delivery.querySelector('[data-reminder-last]');
      next.textContent = result.nextAt ? `Next alert for this phone: ${reminderDateTime.format(result.nextAt)} (New York time).` : 'No upcoming simcha alerts are scheduled for this phone.';
      if (!result.lastDelivery) return;
      const { at, status } = result.lastDelivery;
      last.textContent = `Last scheduled alert: ${reminderDateTime.format(at)} (New York time). ${status >= 200 && status < 300 ? 'Accepted by the notification service.' : status ? `Notification service returned HTTP ${status}.` : 'Could not reach the notification service.'}`;
      last.hidden = false;
    }
    if (enabled) {
      if (!messages) paintDelivery(current);
      if (schedules && current.schedule) showReminderSchedule(scheduleForm, subscription.endpoint, current.schedule, paintDelivery);
    }
    function paint(message = '') {
      scheduleForm.hidden = !scheduleForm.hasChildNodes();
      view.el.querySelector('[data-reminder-description]').hidden = !scheduleForm.hidden;
      test.hidden = !enabled;
      delivery.hidden = messages || !enabled;
      button.classList.toggle('cal-primary', scheduleForm.hidden);
      button.textContent = enabled ? `Turn off ${setting}` : previousEndpoint ? `Reconnect ${setting}` : `Turn on ${setting}`;
      button.disabled = false;
      status.textContent = message || (Notification.permission === 'denied' ? 'Your browser reports that notifications for this site are blocked.' : enabled ? `${messages ? 'Message alerts' : 'Phone reminders'} are on for this device.` : previousEndpoint ? 'Reconnect to get alerts on this phone.' : '');
    }
    paint();
    button.addEventListener('click', async () => {
      button.disabled = test.disabled = true;
      let failure = `Couldn’t turn off ${setting}.`;
      try {
        if (enabled) {
          status.textContent = `Turning off ${setting}…`;
          const result = await removePhoneReminder(subscription, mode);
          enabled = false;
          scheduleForm.replaceChildren();
          delivery.querySelector('[data-reminder-last]').hidden = true;
          if (!result.registered) try { await subscription.unsubscribe(); subscription = null; } catch { /* The server has already turned off alerts. */ }
        } else {
          if (Notification.permission !== 'granted') {
            failure = 'Couldn’t request notification permission.';
            status.textContent = 'Waiting for notification permission. Choose Allow if your browser asks.';
            const permission = await Notification.requestPermission();
            if (!view.el.isConnected) return;
            if (permission !== 'granted') {
              paint(permission === 'denied'
                ? 'The browser still blocks notifications. Reset this site’s notification permission in your browser, then try again.'
                : `Notification permission is still pending. Tap Turn on ${setting} and choose Allow when your browser asks.`);
              return;
            }
            if ((!subscription || previousEndpoint) && navigator.userActivation?.isActive === false) {
              paint(`Notifications are allowed. Tap ${button.textContent} once more to finish.`);
              return;
            }
          }
          failure = 'The browser couldn’t register this phone for notifications.';
          status.textContent = `Registering this phone for ${setting}…`;
          if (subscription && subscription.endpoint === previousEndpoint) {
            await subscription.unsubscribe(); subscription = null;
            if (navigator.userActivation?.isActive === false) {
              paint(`Tap Reconnect ${setting} once more to finish.`);
              return;
            }
          }
          subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
          failure = `The calendar couldn’t save ${setting} for this phone.`;
          const result = await calendarRequest('/api/phone-reminders', { method: 'PUT', body: { mode, subscription: subscription.toJSON(), ...(previousEndpoint ? { previousEndpoint } : {}) } });
          enabled = messages ? result.messageAlerts : result.enabled;
          previousEndpoint = undefined;
          if (!messages) paintDelivery(result);
          if (schedules && enabled && result.schedule) showReminderSchedule(scheduleForm, subscription.endpoint, result.schedule, paintDelivery);
        }
        paint();
      } catch (error) { paint(`${failure} ${error.message || ''}`.trim()); }
      finally { test.disabled = false; }
    });
    test.addEventListener('click', async () => {
      if (Notification.permission !== 'granted') {
        paint('Allow calendar notifications in this browser before sending a test alert.');
        return;
      }
      test.disabled = button.disabled = true;
      status.textContent = 'Sending a test alert…';
      try {
        const result = await calendarRequest('/api/phone-reminders/test', { method: 'POST', body: { endpoint: subscription.endpoint, mode } });
        if (result.expired) {
          previousEndpoint = subscription.endpoint; enabled = false;
          scheduleForm.replaceChildren();
          delivery.querySelector('[data-reminder-last]').hidden = true;
          paint(`The notification service says this registration expired. Tap Reconnect ${setting}.`);
        } else if (result.accepted) paint('Test alert accepted. Check this phone’s notifications.');
        else if (result.status === 404 || result.status === 410) paint('The new registration is still getting ready. Try again in a minute.');
        else paint(result.status ? `The notification service rejected the test alert (HTTP ${result.status}).` : 'Could not reach the notification service. Try again.');
      } catch (error) { paint(error.message); }
      finally { test.disabled = false; }
    });
  } catch (error) { status.textContent = error.message; }
}
