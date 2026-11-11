import { calendarRequest } from '../calendar/api.js';
import { CALENDAR_REMINDER_TYPES, DEFAULT_CALENDAR_REMINDER_RULE } from '../calendar/reminder-date.js';

const workerPath = '/admin/calendar/phone-reminders.js';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const browserKey = key => Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const reminderClock = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });

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

function reminderRow(id, label) {
  return `<div class="cal-reminder-row" data-reminder-rule="${id}">
    <div class="cal-reminder-time"><label for="cal-reminder-${id}">${label}</label><input id="cal-reminder-${id}" name="time" type="time" required></div>
    <details class="cal-extra cal-reminder-details"><summary></summary><div class="cal-form-row">
      <label>Weekday reminder<select name="day"><option value="day-of">Day of the simcha</option><option value="day-before">Day before the simcha</option></select></label>
      <label>Friday time (optional)<input name="fridayTime" type="time"></label>
    </div></details>
  </div>`;
}

function showReminderSchedule(container, endpoint, initial) {
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
      status.textContent = 'Reminder times saved for this phone.';
    } catch (error) { status.textContent = error.message; }
    finally {
      save.disabled = mode.disabled = false;
      displayMode();
    }
  });
}

export async function openCalendarPhoneReminders(dialog, publicKey, schedules = false) {
  const description = schedules ? 'Get phone alerts for simchos. The default is 9:00 a.m. New York time, on the day of the simcha or on Friday for Shabbos. These settings apply to this device.' : 'Get a phone notification at 9:00 a.m. New York time on mornings when a simcha reminder is scheduled. This setting applies to this device.';
  const view = dialog(`<div class="cal-form"><div data-reminder-schedule hidden></div><p data-reminder-description>${description}</p><button type="button" class="cal-primary" disabled>Turn on phone reminders</button><p role="status" aria-live="polite"></p></div>`);
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
      scheduleForm.hidden = !scheduleForm.hasChildNodes();
      view.el.querySelector('[data-reminder-description]').hidden = !scheduleForm.hidden;
      button.classList.toggle('cal-primary', scheduleForm.hidden);
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
