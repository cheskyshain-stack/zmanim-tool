import { CALENDAR_TYPES, calendarMonth, calendarEvent, calendarEventsOn, calendarClock, calendarSerial, calendarISO, calendarStepMonth } from '../calendar/model.js';
import { calendarReadPreview, calendarWritePreview, CALENDAR_STORAGE_KEY } from '../calendar/storage.js';
import { calendarConfig, calendarRequest, calendarSession } from '../calendar/api.js';
import { shulNow } from '../zmanim/solar.js';
import { jewishDateString } from '../hebrew-calendar.js';
import { escText, escAttr } from '../util.js';
import { keepPosition } from './keep-position.js';

const calEscape = value => escText(String(value ?? ''));
const calFullDate = iso => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const calEventType = id => CALENDAR_TYPES.find(type => type.id === id) || CALENDAR_TYPES[6];

// The same view is used by the main admin and the restricted calendar account page.
// With no service configured, only the main admin gets a clearly labelled device preview.
export function renderCalendar(container, settings, tables, { standalone = false, setupToken = '', inviteToken = '' } = {}) {
  let today = calendarISO(shulNow(new Date(), settings).serial);
  let month = today.slice(0, 7), selected = today, events = [], endpoint = '', user = null;
  let disposed = false, requestNumber = 0, busy = false, examples = false, storageError = '', loadError = '', note = '';
  const dialogs = new Set();
  container.innerHTML = '<p class="hint" role="status">Opening calendar…</p>';

  function dialog(html, { onClose } = {}) {
    const previous = document.activeElement, el = document.createElement('dialog');
    el.className = 'cal-dialog no-print'; el.setAttribute('aria-labelledby', 'cal-dialog-title');
    el.innerHTML = `<header class="cal-dialog-header"><h2 id="cal-dialog-title">Calendar</h2><button type="button" data-cal-close aria-label="Close">×</button></header>${html}`;
    let focusFrame;
    const size = () => {
      const view = window.visualViewport;
      el.style.setProperty('--cal-dialog-top', `${(view?.offsetTop || 0) + 16}px`);
      el.style.setProperty('--cal-dialog-height', `${(view?.height || innerHeight) - 32}px`);
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!el.isConnected || !el.contains(field) || !field.matches('input,textarea,select')) return;
        const box = el.getBoundingClientRect(), active = field.getBoundingClientRect();
        if (active.bottom > box.bottom - 16) el.scrollTop += active.bottom - box.bottom + 16;
        else if (active.top < box.top + 12) el.scrollTop -= box.top + 12 - active.top;
      });
    };
    const close = () => {
      if (onClose && onClose() === false) return;
      el.close(); el.remove(); dialogs.delete(el);
      cancelAnimationFrame(focusFrame);
      window.visualViewport?.removeEventListener('resize', size);
      window.visualViewport?.removeEventListener('scroll', size);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
    el.querySelector('[data-cal-close]').addEventListener('click', close);
    el.addEventListener('cancel', event => { event.preventDefault(); close(); });
    el.addEventListener('click', event => {
      if (event.target !== el) return;
      const box = el.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    });
    el.calDispose = () => { onClose = null; close(); };
    dialogs.add(el); document.body.appendChild(el); size();
    window.visualViewport?.addEventListener('resize', size);
    window.visualViewport?.addEventListener('scroll', size);
    el.showModal();
    return { el, close, title: text => { el.querySelector('h2').textContent = text; } };
  }

  function sampleEvents() {
    if (!examples) return [];
    const info = calendarMonth(month, settings, tables);
    const firstShabbos = info.days.find(day => day.inMonth && day.shabbos)?.iso || info.first;
    const definitions = [['kiddush', 'Example Kiddush', firstShabbos], ['wedding', 'Example wedding', month + '-11'],
      ['bar-mitzvah', 'Example bar mitzvah', calendarISO(calendarSerial(firstShabbos) + 14)], ['announcement', 'Example shul announcement', month + '-18']];
    return definitions.map(([type, title, date], index) => ({ ...calendarEvent({ type, title, date, description: 'An example to try the calendar design. This event is not saved.' }), id: 'example-' + index, example: true }));
  }
  const visibleEvents = () => [...events, ...sampleEvents()];
  const canEdit = event => !event.example && (!endpoint || user?.role === 'owner' || event.createdBy === user?.id);
  const hebrewLabel = date => jewishDateString(calendarSerial(date), false, settings.useGregorianBefore1582);
  function eventCard(event) {
    const type = calEventType(event.type);
    return `<article class="cal-event-card cal-type-${type.id}"><div class="cal-event-meta"><span class="cal-tag">${calEscape(type.label)}</span>${event.example ? '<span class="cal-example-tag">Example</span>' : ''}</div>
      <h4 dir="auto">${calEscape(event.title)}</h4><p class="cal-event-clock">${calEscape(calendarClock(event.time))}${event.endTime ? ' - ' + calEscape(calendarClock(event.endTime)) : ''}</p>
      ${event.date !== event.endDate ? `<p class="cal-event-meta">${calEscape(calFullDate(event.date))} to ${calEscape(calFullDate(event.endDate))}</p>` : ''}
      ${event.location ? `<p class="cal-event-location" dir="auto">${calEscape(event.location)}</p>` : ''}
      ${event.description ? `<p class="cal-event-description" dir="auto">${calEscape(event.description)}</p>` : ''}
      ${canEdit(event) ? `<div class="cal-event-actions"><button type="button" data-cal-edit="${escAttr(event.id)}">Edit</button><button type="button" data-cal-delete="${escAttr(event.id)}">Delete</button></div>` : ''}</article>`;
  }
  function dayHtml(date) {
    const info = calendarMonth(date.slice(0, 7), settings, tables), day = info.days.find(item => item.iso === date);
    const list = calendarEventsOn(visibleEvents(), date);
    return `<div class="cal-day-heading"><p class="cal-eyebrow">${date === today ? 'Today' : 'Selected day'}</p><h3>${calEscape(calFullDate(date))}</h3><p lang="he" dir="rtl">${calEscape(day.hebrewLabel)}</p></div>
      ${day.facts.length || day.parsha ? `<div class="cal-day-facts">${day.facts.map(fact => `<p>${calEscape(fact)}</p>`).join('')}${day.parsha ? `<p lang="he" dir="rtl">פרשת ${calEscape(day.parsha)}${day.special ? ' · ' + calEscape(day.special) : ''}</p>` : ''}</div>` : ''}
      <div class="cal-day-events">${busy ? '<p class="cal-empty">Loading events…</p>' : loadError ? `<p class="cal-error">${calEscape(loadError)}</p><button type="button" data-cal-reload>Try again</button>` : list.length ? list.map(eventCard).join('') : '<p class="cal-empty">Nothing added yet.<br>Add a simcha, schedule or announcement.</p>'}</div>
      <p class="cal-error cal-day-status" role="status"></p><button type="button" class="cal-primary cal-day-add" data-cal-add="${date}" ${busy || storageError || loadError ? 'disabled' : ''}>+ Add an event</button>`;
  }
  function wireDay(scope, close = () => {}) {
    scope.querySelectorAll('[data-cal-reload]').forEach(button => button.addEventListener('click', () => { close(); loadEvents(); }));
    scope.querySelectorAll('[data-cal-add]').forEach(button => button.addEventListener('click', () => { close(); editEvent(null, button.dataset.calAdd); }));
    scope.querySelectorAll('[data-cal-edit]').forEach(button => button.addEventListener('click', () => { const item = events.find(event => event.id === button.dataset.calEdit); close(); if (item) editEvent(item); }));
    scope.querySelectorAll('[data-cal-delete]').forEach(button => button.addEventListener('click', async () => {
      const event = events.find(item => item.id === button.dataset.calDelete);
      if (!event || !confirm(`Delete “${event.title}” from the calendar?`)) return;
      button.disabled = true;
      try { await saveEvent(event, true); close(); note = 'Event deleted.'; redraw(); }
      catch (error) { note = error.message; button.disabled = false; if (scope.querySelector('.cal-day-status')) scope.querySelector('.cal-day-status').textContent = error.message; redraw(); }
    }));
  }
  function redraw() {
    if (disposed) return;
    keepPosition(container, draw);
  }
  function draw() {
    const info = calendarMonth(month, settings, tables), all = visibleEvents();
    const weeks = Array.from({ length: info.days.length / 7 }, (_, i) => info.days.slice(i * 7, i * 7 + 7));
    container.innerHTML = `<div class="cal-admin-heading"><div><h2>Calendar</h2><p class="hint">Simchas, shul events and announcements, all in one place.</p></div><button type="button" data-cal-access>Calendar access</button></div>
      <div class="cal-preview-banner"><strong>${endpoint ? 'Private calendar' : 'Admin preview'}</strong><span>${endpoint ? 'Visible only to signed-in calendar accounts.' : 'Not on the congregation website. Test events are saved only in this browser.'}</span></div>
      <section class="shul-calendar" aria-label="Community calendar"><header class="cal-brand"><div><p class="cal-eyebrow">Kahal Lev Menachem</p><h3>Community Calendar</h3></div><button type="button" class="cal-primary" data-cal-add="${selected}" ${busy || storageError || loadError ? 'disabled' : ''}>+ Add event</button></header>
        <div class="cal-toolbar"><div class="cal-month-nav"><button type="button" data-cal-step="-1" aria-label="Previous month" ${month === '1900-01' ? 'disabled' : ''}>‹</button><div><button type="button" class="cal-month-title" data-cal-jump aria-label="Choose month">${calEscape(info.title)} <span aria-hidden="true">⌄</span></button><p>${calEscape(info.hebrewRange)}</p></div><button type="button" data-cal-step="1" aria-label="Next month" ${month === '2299-12' ? 'disabled' : ''}>›</button></div><button type="button" data-cal-today>Today</button></div>
        <div class="cal-legend" aria-label="Event types">${CALENDAR_TYPES.map(type => `<span class="cal-type-${type.id}"><i aria-hidden="true"></i>${calEscape(type.label)}</span>`).join('')}</div>
        <div class="cal-content"><div class="cal-grid-wrap"><table class="cal-grid" aria-label="${escAttr(info.title)}"><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Shabbos'].map(day => `<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${weeks.map(week => `<tr>${week.map(day => {
          const list = calendarEventsOn(all, day.iso), labels = list.map(event => `${calEventType(event.type).label}: ${event.title}`);
          const label = [calFullDate(day.iso), day.hebrewLabel, ...day.facts, day.parsha ? 'Parshas ' + day.parsha : '', ...labels].filter(Boolean).join('. ');
          return `<td class="${day.inMonth ? '' : 'cal-outside'} ${day.shabbos ? 'cal-shabbos' : ''}"><button type="button" class="cal-day ${selected === day.iso ? 'is-selected' : ''} ${today === day.iso ? 'is-today' : ''}" data-cal-day="${day.iso}" tabindex="${selected === day.iso ? 0 : -1}" aria-pressed="${selected === day.iso}" ${day.iso < '1900-01-01' || day.iso > '2299-12-31' ? 'disabled' : ''} ${today === day.iso ? 'aria-current="date"' : ''} aria-label="${escAttr(label)}"><span class="cal-date-numbers"><span class="cal-english-day">${day.day}</span><span class="cal-hebrew-day" lang="he" dir="rtl">${calEscape(day.hebrewDay)}</span></span>
            ${day.hebrew.dayOfMonth === 1 ? `<span class="cal-hebrew-month" lang="he" dir="rtl">${calEscape(day.hebrewLabel.split(' ').slice(1).join(' ').replace(/,.*$/, ''))}</span>` : ''}
            <span class="cal-facts">${day.facts.slice(0, 2).map(fact => `<span>${calEscape(fact)}</span>`).join('')}${day.parsha ? `<span class="cal-parsha" lang="he" dir="rtl">${calEscape(day.parsha)}</span>` : ''}</span>
            <span class="cal-grid-events">${list.slice(0, 2).map(event => `<span class="cal-event-chip cal-type-${event.type}" title="${escAttr(event.title)}"><span class="cal-chip-type">${calEscape(calEventType(event.type).label)} · </span>${calEscape(event.title)}</span>`).join('')}${list.length > 2 ? `<span class="cal-more">+${list.length - 2} more</span>` : ''}</span>
            ${list.length ? `<span class="cal-mobile-events" aria-hidden="true"><span class="cal-type-${list[0].type}">${calEscape(calEventType(list[0].type).compact)}</span>${list.length > 1 ? `<small>+${list.length - 1}</small>` : ''}</span>` : ''}</button></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
        <aside class="cal-day-panel" aria-label="Selected day">${dayHtml(selected)}</aside></div>
        <footer class="cal-footer"><span>${endpoint ? `${calEscape(user.name)} · ${user.role === 'owner' ? 'Main admin' : 'Calendar editor'}` : 'Preview your own events or try examples.'}</span>${endpoint ? '<button type="button" data-cal-signout>Sign out</button>' : `<label class="cal-example-switch"><input type="checkbox" data-cal-examples ${examples ? 'checked' : ''}> Show example events</label>`}</footer>
      </section><p class="cal-status ${storageError ? 'cal-error' : ''}" role="status" aria-live="polite">${calEscape(storageError || note)}</p>${examples ? '<p class="hint cal-example-note">Example events are for testing the design. They are not saved.</p>' : ''}`;
    container.querySelectorAll('[data-cal-step]').forEach(button => button.addEventListener('click', () => changeMonth(calendarStepMonth(month, Number(button.dataset.calStep)))));
    container.querySelector('[data-cal-today]').addEventListener('click', () => { selected = today; changeMonth(today.slice(0, 7), false); });
    container.querySelector('[data-cal-jump]').addEventListener('click', chooseMonth);
    container.querySelector('[data-cal-access]').addEventListener('click', access);
    container.querySelector('[data-cal-examples]')?.addEventListener('change', event => { examples = event.target.checked; redraw(); });
    container.querySelector('[data-cal-signout]')?.addEventListener('click', async () => {
      try { await calendarRequest('/api/session', { method: 'DELETE' }); } catch { /* The local session is always removed. */ }
      calendarSession(null); user = null; events = []; signIn();
    });
    container.querySelectorAll('[data-cal-day]').forEach(button => {
      button.addEventListener('click', () => {
        selected = button.dataset.calDay; redraw();
        if (matchMedia('(max-width: 700px)').matches) {
          const view = dialog(dayHtml(selected)); view.title('Day details'); wireDay(view.el, view.close);
        }
      });
      button.addEventListener('keydown', event => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
          Home: -new Date(button.dataset.calDay + 'T12:00:00Z').getUTCDay(), End: 6 - new Date(button.dataset.calDay + 'T12:00:00Z').getUTCDay() };
        if (!(event.key in offsets)) return;
        event.preventDefault(); selected = calendarISO(calendarSerial(button.dataset.calDay) + offsets[event.key]);
        if (selected < '1900-01-01' || selected > '2299-12-31') { selected = button.dataset.calDay; return; }
        if (!info.days.some(day => day.iso === selected)) changeMonth(selected.slice(0, 7), false);
        else redraw();
        container.querySelector(`[data-cal-day="${selected}"]`)?.focus({ preventScroll: true });
      });
    });
    wireDay(container);
  }
  function chooseMonth() {
    const view = dialog(`<form class="cal-form"><label>Month<input type="month" name="month" required min="1900-01" max="2299-12" value="${month}"></label><button class="cal-primary" type="submit">Show month</button><p role="status"></p></form>`); view.title('Go to month');
    view.el.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); const next = event.currentTarget.elements.month.value;
      try { calendarMonth(next, settings, tables); view.close(); changeMonth(next); }
      catch (error) { view.el.querySelector('[role=status]').textContent = error.message; }
    });
  }
  async function changeMonth(next, reset = true) {
    month = next; if (reset) selected = month + '-01'; note = ''; await loadEvents();
  }
  async function loadEvents() {
    const number = ++requestNumber;
    if (!endpoint) { redraw(); return; }
    busy = true; loadError = ''; events = []; redraw();
    const info = calendarMonth(month, settings, tables);
    try {
      const from = info.days[0].iso < '1900-01-01' ? '1900-01-01' : info.days[0].iso;
      const to = info.days.at(-1).iso > '2299-12-31' ? '2299-12-31' : info.days.at(-1).iso;
      const value = await calendarRequest(`/api/events?from=${from}&to=${to}`);
      if (disposed || number !== requestNumber) return;
      if (!Array.isArray(value.events)) throw new Error('The calendar returned an invalid event list.');
      events = value.events.map(item => ({ ...calendarEvent(item), id: String(item.id), createdBy: String(item.createdBy), updatedAt: String(item.updatedAt || '') }));
    } catch (error) {
      if (disposed || number !== requestNumber) return;
      if (error.status === 401) { user = null; busy = false; signIn(error.message); return; }
      note = error.message; loadError = error.message;
    }
    if (!disposed && number === requestNumber) { busy = false; redraw(); }
  }
  async function saveEvent(item, remove = false) {
    if (endpoint) {
      const result = await calendarRequest('/api/events/' + encodeURIComponent(item.id), { method: remove ? 'DELETE' : 'PUT', body: item });
      events = events.filter(event => event.id !== item.id);
      if (!remove) events.push(result.event);
    } else {
      if (storageError) throw new Error(storageError);
      const latest = calendarReadPreview(), old = latest.find(event => event.id === item.id);
      if ((old?.revision || 0) !== item.revision || remove && !old) throw new Error('This event changed in another tab. Reload before saving.');
      const next = latest.filter(event => event.id !== item.id);
      const now = new Date().toISOString();
      if (!remove) next.push({ ...calendarEvent(item), id: item.id, revision: item.revision + 1, createdBy: 'device', createdAt: old?.createdAt || now, updatedAt: now });
      calendarWritePreview(next); events = next;
    }
  }
  function editEvent(item, date = selected) {
    const original = item || { id: crypto.randomUUID(), title: '', type: 'kiddush', date, endDate: date, allDay: true, time: '', endTime: '', location: '', description: '', revision: 0 };
    let saving = false, initial = '';
    const view = dialog(`<form class="cal-form"><label>Event title<input name="title" required maxlength="160" placeholder="What’s happening?" value="${escAttr(original.title)}"></label>
      <div class="cal-form-row"><label>Event type<select name="type">${CALENDAR_TYPES.map(type => `<option value="${type.id}" ${type.id === original.type ? 'selected' : ''}>${calEscape(type.label)}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required min="1900-01-01" max="2299-12-31" value="${original.date}"></label></div>
      <p class="cal-form-hebrew" lang="he" dir="rtl"></p><label class="cal-checkbox"><input type="checkbox" name="allDay" ${original.allDay ? 'checked' : ''}> All day</label>
      <div class="cal-form-row" data-cal-times ${original.allDay ? 'hidden' : ''}><label>Starts<input name="time" type="time" value="${escAttr(original.time)}"></label><label>Ends (optional)<input name="endTime" type="time" value="${escAttr(original.endTime)}"></label></div>
      <label>Location (optional)<input name="location" maxlength="200" value="${escAttr(original.location)}" placeholder="For example, the shul or a simcha hall"></label>
      <label>Details (optional)<textarea name="description" maxlength="4000" rows="3" placeholder="Anything people should know">${calEscape(original.description)}</textarea></label>
      <details class="cal-extra"><summary>More options</summary><label>Last date (for a multi-day event)<input name="endDate" type="date" min="${original.date}" max="2299-12-31" value="${original.endDate !== original.date ? original.endDate : ''}"></label></details>
      <p class="cal-form-note">Times use ${calEscape(settings.timezone.id.replaceAll('_', ' '))}. Calendar entries do not change the minyan schedule.</p>
      <p role="status" class="cal-error" aria-live="polite"></p><div class="cal-form-actions"><button type="submit" class="cal-primary">${item ? 'Save changes' : 'Save event'}</button><button type="button" data-cal-cancel>Cancel</button></div></form>`,
      { onClose: () => !saving && (new URLSearchParams(new FormData(view.el.querySelector('form'))).toString() === initial || confirm('Discard your unsaved event changes?')) });
    view.title(item ? 'Edit event' : 'Add an event');
    const form = view.el.querySelector('form');
    initial = new URLSearchParams(new FormData(form)).toString();
    const updateDate = () => {
      const value = form.elements.date.value;
      view.el.querySelector('.cal-form-hebrew').textContent = Number.isFinite(calendarSerial(value)) ? hebrewLabel(value) : '';
      form.elements.endDate.min = value;
    };
    updateDate(); form.elements.date.addEventListener('change', updateDate);
    form.elements.allDay.addEventListener('change', () => {
      view.el.querySelector('[data-cal-times]').hidden = form.elements.allDay.checked;
      form.elements.time.required = !form.elements.allDay.checked;
    });
    view.el.querySelector('[data-cal-cancel]').addEventListener('click', view.close);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      const status = view.el.querySelector('[role=status]');
      try {
        const fields = Object.fromEntries(new FormData(form));
        const next = { ...original, ...calendarEvent({ ...fields, allDay: form.elements.allDay.checked, revision: original.revision }) };
        saving = true; form.querySelector('[type=submit]').disabled = true; status.textContent = 'Saving…';
        await saveEvent(next); saving = false; initial = new URLSearchParams(new FormData(form)).toString(); view.close();
        selected = next.date; note = 'Event saved.';
        if (month !== next.date.slice(0, 7)) { month = next.date.slice(0, 7); await loadEvents(); } else redraw();
      } catch (error) { saving = false; form.querySelector('[type=submit]').disabled = false; status.textContent = error.message; }
    });
  }
  async function access() {
    if (!endpoint) {
      const view = dialog(`<p>You have full control of this test calendar through the main admin.</p><p>Separate calendar accounts are not active yet. Once connected, you can invite an editor who chooses their own password. You will be able to manage every event and remove editor access.</p><div class="cal-backup-actions"><button type="button" data-cal-backup>Download event backup</button><label class="cal-file-label">Restore event backup<input type="file" accept="application/json,.json" data-cal-restore></label></div><p class="cal-form-note">Backups contain your test events. Restoring replaces the test events on this device.</p><p class="cal-error" role="status"></p>`);
      view.title('Calendar access & backup');
      view.el.querySelector('[data-cal-backup]').addEventListener('click', () => {
        try {
          const stored = localStorage.getItem(CALENDAR_STORAGE_KEY);
          const blob = new Blob([stored || JSON.stringify({ version: 1, events }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'lakewood-commons-calendar-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { view.el.querySelector('[role=status]').textContent = 'The stored calendar could not be read for backup.'; }
      });
      view.el.querySelector('[data-cal-restore]').addEventListener('change', async event => {
        try {
          const file = event.target.files[0]; if (!file) return;
          if (file.size > 2 * 1024 * 1024) throw new Error('Choose a calendar backup smaller than 2 MB.');
          const text = await file.text(), next = calendarReadPreview({ getItem: () => text });
          if (!confirm('Replace this device’s test events with the selected backup?')) return;
          calendarWritePreview(next); events = next; storageError = ''; note = 'Calendar backup restored.'; view.close(); redraw();
        } catch (error) { view.el.querySelector('[role=status]').textContent = error.message; }
      });
      return;
    }
    if (user.role !== 'owner') {
      const view = dialog('<p>Your calendar account can add events and edit or delete the events you created. Other admin pages and account management stay with the main admin.</p>'); view.title('Your calendar access'); return;
    }
    const view = dialog('<p>Editors choose their own password from a private invitation. They can manage their own events; you can manage every event.</p><div data-cal-users>Loading accounts…</div><form class="cal-form cal-invite-form"><h3>Invite a calendar editor</h3><label>Name<input name="name" required maxlength="60" autocomplete="off"></label><label>Email<input name="email" type="email" required autocomplete="off"></label><button class="cal-primary" type="submit">Create invitation</button></form><p role="status" class="cal-error"></p><div data-cal-invitation hidden><label>Private invitation link<input readonly aria-label="Private invitation link"></label><button type="button" data-cal-copy-invite>Copy invitation</button><p class="cal-form-note">Share this link privately. It expires after seven days and works once.</p></div>');
    view.title('Calendar accounts');
    const status = view.el.querySelector('[role=status]');
    const invitation = result => {
      const area = view.el.querySelector('[data-cal-invitation]'); area.hidden = false;
      area.querySelector('input').value = location.origin + '/admin/calendar/#invite=' + result.token;
      status.textContent = 'Invitation ready.';
    };
    const list = async () => {
      const result = await calendarRequest('/api/access'); if (!view.el.isConnected) return;
      view.el.querySelector('[data-cal-users]').innerHTML = result.users.map(account => `<div class="cal-account"><div><strong>${calEscape(account.name)}</strong><span>${calEscape(account.email)}</span><small>${account.role === 'owner' ? 'Main admin' : account.pending ? 'Invitation pending' : 'Calendar editor'}</small></div>${account.role !== 'owner' ? `<div><button type="button" data-cal-reinvite="${escAttr(account.id)}">New invite / reset password</button><button type="button" data-cal-revoke="${escAttr(account.id)}">Remove access</button></div>` : ''}</div>`).join('');
      view.el.querySelectorAll('[data-cal-revoke],[data-cal-reinvite]').forEach(button => button.addEventListener('click', async () => {
        const removing = !!button.dataset.calRevoke, id = button.dataset.calRevoke || button.dataset.calReinvite;
        if (!confirm(removing ? 'Remove this person’s calendar access?' : 'End this person’s sessions and create a new password invitation?')) return;
        button.disabled = true;
        try { const result = await calendarRequest('/api/access/' + id, { method: removing ? 'DELETE' : 'POST' }); if (!removing) invitation(result); else status.textContent = 'Calendar access removed.'; await list(); }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      }));
    };
    view.el.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.submitter; button.disabled = true;
      try { invitation(await calendarRequest('/api/access', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) })); await list(); }
      catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
    });
    view.el.querySelector('[data-cal-copy-invite]').addEventListener('click', async () => {
      const input = view.el.querySelector('[data-cal-invitation] input');
      try { await navigator.clipboard.writeText(input.value); status.textContent = 'Invitation copied.'; }
      catch { input.focus(); input.select(); status.textContent = 'Select and copy the invitation link.'; }
    });
    try { await list(); } catch (error) { status.textContent = error.message; }
  }
  function signIn(error = '') {
    if (disposed) return;
    const creating = setupToken || inviteToken;
    container.innerHTML = `<section class="cal-login"><p class="cal-eyebrow">Kahal Lev Menachem</p><h2>${setupToken ? 'Set up calendar access' : inviteToken ? 'Choose your calendar password' : 'Calendar sign in'}</h2><p>${setupToken ? 'Create your main admin account. You will control all calendar events and editor access.' : inviteToken ? 'Create your own password for your calendar-only account.' : 'Use your calendar account to view and manage events.'}</p><form class="cal-form">
      ${setupToken ? '<label>Your name<input name="name" maxlength="60" required autocomplete="name"></label>' : ''}${!inviteToken ? '<label>Email<input name="email" type="email" required autocomplete="username"></label>' : ''}
      <label>Password<input name="password" type="password" minlength="12" maxlength="200" required autocomplete="${creating ? 'new-password' : 'current-password'}"></label>
      ${creating ? '<label>Confirm password<input name="confirmation" type="password" minlength="12" maxlength="200" required autocomplete="new-password"></label><p class="cal-form-note">Use at least 12 characters. Save your password for future sign-ins.</p>' : ''}
      <p class="cal-error" role="status">${calEscape(error)}</p><button class="cal-primary" type="submit">${creating ? 'Create account' : 'Sign in'}</button></form></section>`;
    container.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const button = event.submitter, fields = Object.fromEntries(new FormData(event.currentTarget));
      const status = container.querySelector('[role=status]'); button.disabled = true;
      try {
        if (creating && fields.password !== fields.confirmation) throw new Error('The passwords do not match.');
        delete fields.confirmation;
        const session = await calendarRequest(setupToken ? '/api/setup' : inviteToken ? '/api/invitations/claim' : '/api/session', { method: 'POST', body: { ...fields, ...(setupToken ? { setupToken } : {}), ...(inviteToken ? { token: inviteToken } : {}) } });
        calendarSession(session); user = session.user; setupToken = inviteToken = ''; await loadEvents();
      } catch (issue) { status.textContent = issue.message; button.disabled = false; }
    });
  }
  const storageListener = event => {
    if (endpoint || disposed || event.key !== 'lakewood-commons-calendar-preview-v1') return;
    try { events = calendarReadPreview(); storageError = ''; note = 'Calendar updated from another tab.'; } catch (error) { storageError = error.message; }
    redraw();
  };
  window.addEventListener('storage', storageListener);
  const updateToday = () => {
    const now = calendarISO(shulNow(new Date(), settings).serial);
    if (now !== today && container.querySelector('.shul-calendar')) { today = now; redraw(); }
  };
  const dayTimer = setInterval(updateToday, 60000);
  document.addEventListener('visibilitychange', updateToday);
  (async () => {
    try {
      endpoint = await calendarConfig(); if (disposed) return;
      if (endpoint) {
        if (setupToken || inviteToken || !calendarSession()) { signIn(); return; }
        try { user = (await calendarRequest('/api/session')).user; }
        catch (error) { signIn(error.message); return; }
        await loadEvents();
      } else if (standalone) {
        container.innerHTML = '<section class="cal-login"><h2>Calendar editor access</h2><p>Separate calendar accounts are not active yet. The main admin can test the calendar under Admin → Calendar.</p><a href="/admin/#calendar">Open main admin</a></section>';
      } else {
        try { events = calendarReadPreview(); } catch (error) { storageError = error.message; }
        draw();
      }
    } catch (error) { if (!disposed) container.innerHTML = `<h2>Calendar</h2><p class="cal-error" role="alert">${calEscape(error.message)}</p>`; }
  })();
  return () => { disposed = true; requestNumber++; clearInterval(dayTimer); document.removeEventListener('visibilitychange', updateToday); window.removeEventListener('storage', storageListener); dialogs.forEach(el => el.calDispose()); };
}
