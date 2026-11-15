import { calendarMonth, calendarStepMonth, calendarSerial, calendarISO } from './calendar/model.js';
import { loadTables } from './data-loader.js';
import { seatsOpenSession } from './seats/session.js';
import { createYahrzeitList } from './yahrzeits/list.js';
import { seatsReadSpreadsheetRows } from './seats/import.js';
import { YAHRZEIT_IMPORT_COLUMNS, yahrzeitMembersFromRows, yahrzeitPlanImport } from './yahrzeits/import.js';
import { escAttr, escText } from './util.js';
import { websiteLocalFields } from './website-clock.js';
import { JEWISH_MONTHS_EN, hebrewDateExtended, hebrewYear, jewishDateString } from './hebrew-calendar.js';
import { YAHRZEIT_MONTHS, YAHRZEIT_MAX_OBSERVANCES, yahrzeitMember, yahrzeitMonthLabel, yahrzeitMonthLimit, yahrzeitRelationship, yahrzeitVariableMonth, yahrzeitDates, yahrzeitsByDay, yahrzeitCalendarMonths, yahrzeitHebrewDateSerial } from './yahrzeits/model.js';

const yahrzeitRoot = document.getElementById('yahrzeit-app');
const yahrzeitFullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' });
const yahrzeitAddedDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });

function yahrzeitEntryDetails(entry, label = 'Entry info') {
  const date = new Date(entry.addedAt);
  const info = entry.addedBy && Number.isFinite(date.getTime())
    ? `Added by <bdi>${escText(entry.addedBy)}</bdi> on <time datetime="${escAttr(entry.addedAt)}">${escText(yahrzeitAddedDate.format(date))}</time> (New York time).`
    : 'The original organizer and date were not recorded.';
  return `<details class="yr-entry-info"><summary>${escText(label)}</summary><p>${info}</p></details>`;
}

async function openYahrzeitCalendar() {
  const auth = await seatsOpenSession(yahrzeitRoot, {
    title: 'Yahrzeit Calendar',
    intro: 'Enter your name and the private organizer PIN.',
    scope: 'yahrzeits',
  });
  const { endpoint, token } = auth.session;
  if (!endpoint || !token) throw new Error('The shared yahrzeit calendar is unavailable. Reload to try again.');
  const request = async (path = '', method = 'GET', body) => {
    let response;
    try {
      response = await fetch(endpoint + '/api/yahrzeits' + path, {
        method, cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error('Could not reach the website. Check your connection and try again.'); }
    if (response.status === 401) {
      auth.lock();
      throw new Error('Sign in again to open the Yahrzeit Calendar.');
    }
    if (response.status === 404 && !path) throw new Error('The shared yahrzeit calendar is unavailable. Try again later.');
    const result = await response.json().catch(() => ({}));
    if (response.status === 403 && result.code === 'yahrzeit-sign-in') {
      throw Object.assign(new Error(result.error), { signIn: auth.lock });
    }
    if (!response.ok) throw new Error(result.error || 'The yahrzeit calendar could not be updated.');
    return result;
  };

  const [tables, initial] = await Promise.all([loadTables(), request()]);
  const today = () => websiteLocalFields(new Date(), 'America/New_York').date;
  const refreshViewKey = 'lakewood-commons-yahrzeit-refresh-view';
  let restored;
  try {
    restored = JSON.parse(sessionStorage.getItem(refreshViewKey));
    sessionStorage.removeItem(refreshViewKey);
  } catch { /* Start in the calendar if storage is unavailable. */ }
  let month = Number.isFinite(calendarSerial(restored?.month + '-01')) ? restored.month : today().slice(0, 7);
  let selected = today(), view = restored?.view === 'list' ? 'list' : 'calendar';
  let members = initial.members, grid, onDay, dialogReturn;
  const sortMembers = () => members.sort((a, b) => a.name.localeCompare(b.name));
  sortMembers();
  document.body.classList.add('cal-reader-page');
  yahrzeitRoot.classList.add('is-cal-congregation');
  yahrzeitRoot.innerHTML = `<section class="shul-calendar yr-card" aria-labelledby="yr-heading">
    <header class="cal-reader-heading"><h1 id="yr-heading">Yahrzeit Calendar</h1><div class="cal-reader-actions">
      <button type="button" class="cal-reader-refresh" data-yr-refresh aria-label="Refresh calendar" title="Refresh calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1"/></svg></button>
      <div class="yr-view-switch" role="group" aria-label="Calendar display">
        <button type="button" data-yr-view="calendar" aria-pressed="true">Calendar</button>
        <button type="button" data-yr-view="list" aria-pressed="false">List</button>
      </div>
      <button type="button" data-cal-options data-yr-options aria-label="Calendar options" title="Calendar options">⋯</button>
    </div></header>
    <div class="cal-toolbar" data-yr-calendar><div class="cal-month-nav">
      <button type="button" data-yr-step="-1" aria-label="Previous month">‹</button>
      <div><button type="button" class="cal-month-title" data-yr-jump aria-live="polite"><span class="yr-english-month"></span><span aria-hidden="true">⌄</span></button><p lang="he" dir="rtl" data-yr-hebrew-month></p></div>
      <button type="button" data-yr-step="1" aria-label="Next month">›</button>
    </div><button type="button" data-yr-today>Today</button></div>
    <div class="cal-content" data-yr-calendar><div class="cal-grid-wrap"></div></div>
    <section class="yr-agenda" aria-label="Yahrzeit list" hidden></section>
    <p class="cal-reader-status" role="status" data-yr-summary></p>
  </section><dialog class="cal-dialog yr-dialog" aria-labelledby="yr-dialog-title"></dialog>`;
  const host = yahrzeitRoot.querySelector('.cal-grid-wrap'), dialog = yahrzeitRoot.querySelector('dialog');
  const agenda = yahrzeitRoot.querySelector('.yr-agenda'), list = createYahrzeitList(agenda, today, restored?.range);
  function showView(next) {
    const opening = next === 'list' && agenda.hidden;
    view = next;
    const showList = view === 'list';
    agenda.hidden = !showList;
    yahrzeitRoot.querySelectorAll('[data-yr-calendar]').forEach(part => { part.hidden = showList; });
    for (const button of yahrzeitRoot.querySelectorAll('[data-yr-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.yrView === view));
    }
    if (opening) list.open(members);
    else if (showList) list.update(members);
  }
  const show = (title, content) => {
    if (!dialog.open) dialogReturn = document.activeElement;
    dialog.innerHTML = `<header class="cal-dialog-header"><h2 id="yr-dialog-title">${escText(title)}</h2><button type="button" aria-label="Close" data-yr-close>×</button></header>${content}`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector('[data-yr-close]').focus({ preventScroll: true });
  };
  dialog.addEventListener('click', event => { if (event.target.closest('[data-yr-close]')) dialog.close(); });
  dialog.addEventListener('close', () => {
    (dialogReturn?.isConnected ? dialogReturn : yahrzeitRoot.querySelector('[data-yr-options]'))?.focus({ preventScroll: true });
  });

  function renderGrid() {
    grid = calendarMonth(month, { inIsrael: false }, tables);
    onDay = yahrzeitsByDay(members, grid.days);
    yahrzeitRoot.style.setProperty('--cal-weeks', grid.days.length / 7);
    yahrzeitRoot.querySelector('.yr-english-month').textContent = grid.title;
    yahrzeitRoot.querySelector('[data-yr-jump]').setAttribute('aria-label', grid.title + ', choose a month or find a Hebrew date');
    yahrzeitRoot.querySelector('[data-yr-hebrew-month]').textContent = grid.hebrewRange;
    if (view === 'list') list.update(members);
    yahrzeitRoot.querySelector('[data-yr-step="-1"]').disabled = month <= '1900-01';
    yahrzeitRoot.querySelector('[data-yr-step="1"]').disabled = month >= '2299-12';
    const now = today(), weeks = [];
    for (let i = 0; i < grid.days.length; i += 7) {
      weeks.push('<tr role="row">' + grid.days.slice(i, i + 7).map(day => {
        const count = onDay.get(day.serial)?.length || 0;
        const fact = day.parsha || day.facts[0] || day.specialLabel || (day.mevarchim ? 'מברכים' : '');
        const label = [
          yahrzeitFullDate.format(new Date(day.iso + 'T12:00:00Z')), day.hebrewLabel, fact,
          count ? count + (count === 1 ? ' yahrzeit' : ' yahrzeits') : '',
        ].filter(Boolean).join('. ');
        return `<td role="cell" class="${day.inMonth ? '' : 'cal-outside'} ${day.shabbos ? 'cal-shabbos' : ''}">
          <button type="button" class="cal-day ${day.iso === now ? 'is-today' : ''} ${day.iso === selected ? 'is-selected' : ''}" data-yr-day="${day.iso}" aria-pressed="${day.iso === selected}" aria-label="${escAttr(label)}" ${day.iso === now ? 'aria-current="date"' : ''}>
            <span class="cal-date-numbers"><span class="cal-english-day">${day.day}</span></span>
            <span class="cal-facts" lang="he" dir="rtl">${fact ? `<span class="${day.parsha ? 'cal-parsha' : 'cal-observance'}">${escText(fact)}</span>` : ''}</span>
            ${count ? `<span class="yr-day-count">${count} <span>${count === 1 ? 'entry' : 'entries'}</span></span>` : ''}
            <span class="cal-hebrew-day" lang="he" dir="rtl">${escText(day.hebrewDay)}</span>
          </button></td>`;
      }).join('') + '</tr>');
    }
    host.innerHTML = `<table role="table" class="cal-grid" aria-label="${escAttr(grid.title)}"><thead role="rowgroup"><tr role="row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Shabbos'].map(label => `<th role="columnheader" scope="col">${label}</th>`).join('')}</tr></thead><tbody role="rowgroup">${weeks.join('')}</tbody></table>`;
  }

  function openDay(date) {
    const day = grid.days.find(item => item.iso === date);
    if (!day) return;
    const previous = host.querySelector('.is-selected');
    previous?.classList.remove('is-selected');
    previous?.setAttribute('aria-pressed', 'false');
    selected = date;
    const current = host.querySelector(`[data-yr-day="${date}"]`);
    current?.classList.add('is-selected');
    current?.setAttribute('aria-pressed', 'true');
    const rows = onDay.get(day.serial) || [];
    const labels = [...new Set([day.specialLabel, ...day.facts, day.parsha ? 'פרשת ' + day.parsha : '', day.mevarchim ? 'מברכים' : ''].filter(Boolean))];
    show('Yahrzeits', `<div class="cal-day-heading"><h3>${escText(yahrzeitFullDate.format(new Date(date + 'T12:00:00Z')))}</h3><p lang="he" dir="rtl">${escText(day.hebrewLabel)}</p></div>
      ${labels.length ? `<div class="cal-day-facts" lang="he" dir="rtl">${labels.map(label => `<p>${escText(label)}</p>`).join('')}</div>` : ''}
      ${rows.length ? `<ul class="yr-list">${rows.map(({ member, entry }) => `<li><div><strong dir="auto">${escText(member.name)}</strong><p dir="auto">${escText(yahrzeitRelationship(entry))}${entry.deceasedName ? ': ' + escText(entry.deceasedName) : ''}</p>${yahrzeitEntryDetails(entry)}</div><button type="button" data-yr-edit="${escAttr(member.id)}" aria-label="${escAttr('Edit ' + member.name)}">Edit</button></li>`).join('')}</ul>` : '<p>No yahrzeits on this date.</p>'}`);
  }

  function openCalendarOptions() {
    show('Calendar options', `<div class="yr-option-list">
      <button type="button" data-yr-manage>Members</button>
      <button type="button" data-yr-add>Add member</button>
      <button type="button" data-yr-import>Import spreadsheet</button>
      <button type="button" data-yr-find>Find Hebrew date</button>
      <button type="button" data-yr-logout>Log out</button>
    </div>`);
  }

  function openMemberList() {
    show('Members', `<div class="yr-dialog-actions yr-member-actions"><button type="button" data-yr-reload>Refresh</button><button type="button" data-yr-import>Import spreadsheet</button><button type="button" data-yr-add class="cal-primary">+ Add member</button></div>
      <label>Find by name or address<input type="search" data-yr-search></label>
      <p class="yr-status" role="status"></p><ul class="yr-list"></ul><p class="yr-help" data-yr-empty></p>`);
    const search = dialog.querySelector('[data-yr-search]');
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const found = members.filter(member => member.name.toLocaleLowerCase().includes(query) || member.address?.toLocaleLowerCase().includes(query));
      dialog.querySelector('.yr-list').innerHTML = found.map(member => `<li><div><strong dir="auto">${escText(member.name)}</strong>${member.address ? `<p dir="auto">${escText(member.address)}</p>` : ''}<p class="yr-help" dir="auto">${escText(member.observances.map(entry => yahrzeitRelationship(entry) + ': ' + entry.day + ' ' + JEWISH_MONTHS_EN[entry.month - 1]).join(' · ') || 'No yahrzeits entered')}</p></div><button type="button" data-yr-edit="${escAttr(member.id)}" aria-label="${escAttr('Edit ' + member.name)}">Edit</button></li>`).join('');
      dialog.querySelector('[data-yr-empty]').textContent = found.length ? '' : query ? 'No matching members.' : 'No members have been added yet.';
    };
    search.addEventListener('input', render);
    dialog.querySelector('[data-yr-reload]').addEventListener('click', async event => {
      const button = event.currentTarget, status = dialog.querySelector('.yr-status');
      button.disabled = true;
      try {
        members = (await request()).members; sortMembers(); renderGrid();
        if (search.isConnected) { status.textContent = ''; render(); }
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    render();
  }

  function openMemberImport() {
    const template = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + YAHRZEIT_IMPORT_COLUMNS.join(',') + '\r\n');
    show('Import spreadsheet', `<form class="yr-import-controls">
      <p class="yr-help">Put the column headings on the first row of the first sheet. Add one member per row.</p>
      <ol class="yr-import-steps">
        <li>Use <strong>Name</strong>, or split it into <strong>First Name</strong> and <strong>Last Name</strong>. A roster with <strong>Father’s Name</strong> and <strong>Last Name</strong> also works.</li>
        <li>Use <strong>Address</strong> for the full street address, including the house number. You can leave it blank.</li>
        <li>Use <strong>Father Hebrew Date</strong>, <strong>Mother Hebrew Date</strong>, or <strong>Custom Hebrew Date</strong>. Leave dates blank when you don’t have them. For a custom date, also fill in <strong>Custom Relationship</strong>.</li>
      </ol>
      <a href="${escAttr(template)}" download="yahrzeit-members-template.csv">Download Excel template (CSV)</a>
      <details><summary>Hebrew date format</summary><p>Enter dates as text, such as 12 Tishrei or י״ב תשרי. For 30 Cheshvan or 30 Kislev, add (29th), (next month), or (both) for years without the 30th.</p></details>
      <label>Spreadsheet<input type="file" accept=".xlsx,.xls,.csv,.tsv"></label>
      <p aria-live="polite" data-yr-import-preview></p><p class="yr-status" role="status"></p>
      <div class="yr-dialog-actions"><button type="button" data-yr-manage>Back to members</button><button class="cal-primary" type="submit" disabled>Import members</button></div>
    </form>`);
    const form = dialog.querySelector('form'), input = form.querySelector('input');
    const button = form.querySelector('[type=submit]'), status = form.querySelector('[role=status]');
    const preview = form.querySelector('[data-yr-import-preview]');
    const counts = (added, updated, unchanged) => `${added} new · ${updated} with details to add · ${unchanged} unchanged`;
    let selectedRows, skippedRows = [], selection = 0;
    input.addEventListener('change', async () => {
      const file = input.files[0], current = ++selection;
      selectedRows = null; button.disabled = true; status.textContent = ''; preview.textContent = '';
      if (!file) return;
      try {
        const { members: rows, skippedRows: skipped } = yahrzeitMembersFromRows(await seatsReadSpreadsheetRows(file, { keepBlankRows: true }));
        if (current !== selection) return;
        const plan = yahrzeitPlanImport(members, rows);
        selectedRows = rows;
        skippedRows = skipped;
        const note = skippedRows.length ? ` Skipped ${skippedRows.length} rows missing a father’s name or last name.` : '';
        preview.textContent = counts(plan.added.length, plan.updated.length, plan.unchanged) + note;
        button.disabled = !plan.added.length && !plan.updated.length;
      } catch (error) { if (current === selection) status.textContent = error.message || 'Could not read the spreadsheet.'; }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!selectedRows || button.disabled) return;
      button.disabled = true; input.disabled = true; status.textContent = '';
      try {
        const result = await request('/import', 'POST', { members: selectedRows });
        members = result.members;
        sortMembers(); renderGrid();
        const message = `Imported ${result.added} new, updated ${result.updated}, and left ${result.unchanged} unchanged.${skippedRows.length ? ` Skipped ${skippedRows.length} incomplete rows.` : ''}`;
        yahrzeitRoot.querySelector('[data-yr-summary]').textContent = message;
        if (form.isConnected) { openMemberList(); dialog.querySelector('[role=status]').textContent = message; }
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      } finally { input.disabled = false; }
    });
  }

  function openHebrewDateSearch() {
    const now = today();
    const current = hebrewDateExtended(calendarSerial(month === now.slice(0, 7) ? now : month + '-15'));
    const min = hebrewDateExtended(calendarSerial('1900-01-01')).year;
    const max = hebrewDateExtended(calendarSerial('2299-12-31')).year;
    show('Find Hebrew date', `<form class="yr-import-controls">
      <div class="yr-date-fields">
        <label>Hebrew day<select name="hebrewDay" required></select></label>
        <label>Hebrew month<select name="hebrewMonth" required></select></label>
      </div>
      <label>Hebrew year <select name="hebrewYear" required>
        ${Array.from({ length: max - min + 1 }, (_, i) => min + i).map(year =>
          `<option value="${year}" ${year === current.year ? 'selected' : ''}>${year} (${escText(hebrewYear(year))})</option>`).join('')}
      </select></label>
      <div class="yr-dialog-actions"><button class="cal-primary" type="submit">Find date</button></div>
      <p class="yr-status" role="status"></p>
    </form>`);
    const form = dialog.querySelector('form');
    const months = form.elements.hebrewMonth, days = form.elements.hebrewDay, years = form.elements.hebrewYear;
    const refreshDays = preferred => {
      const year = Number(years.value), selectedMonth = Number(months.value);
      days.innerHTML = '<option value="">Day</option>' + Array.from({ length: 30 }, (_, i) => i + 1)
        .map(day => {
          const serial = yahrzeitHebrewDateSerial(day, selectedMonth, year);
          if (serial === null) return '';
          const label = jewishDateString(serial, false).split(' ')[0];
          return `<option value="${day}">${escText(label)} (${day})</option>`;
        }).join('');
      days.value = preferred;
    };
    const refreshMonths = preferred => {
      const options = yahrzeitCalendarMonths(Number(years.value));
      const translated = preferred === 12 ? 13 : preferred >= 13 ? 12 : preferred;
      const chosen = options.includes(preferred) ? preferred : options.includes(translated) ? translated : '';
      months.innerHTML = '<option value="">Month</option>' + options.map(value => `<option value="${value}">${escText(yahrzeitMonthLabel(value))}</option>`).join('');
      months.value = String(chosen);
      refreshDays(days.value);
    };
    refreshMonths(current.month);
    days.value = '';
    months.addEventListener('change', () => refreshDays(days.value));
    years.addEventListener('change', () => refreshMonths(Number(months.value)));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const serial = yahrzeitHebrewDateSerial(Number(days.value), Number(months.value), Number(years.value));
      const date = serial !== null ? calendarISO(serial) : '';
      if (!Number.isFinite(calendarSerial(date))) {
        form.querySelector('[role=status]').textContent = 'Choose a valid Hebrew date within the calendar range.';
        return;
      }
      month = date.slice(0, 7);
      renderGrid();
      openDay(date);
    });
  }

  function openMemberForm(member) {
    const id = member?.id || crypto.randomUUID(), revision = member?.revision || 0;
    show(member ? 'Edit member' : 'Add member', `<form>
      <label>Congregation member<input name="name" dir="auto" maxlength="100" value="${escAttr(member?.name)}" required></label>
      <label>Address (optional)<input name="address" dir="auto" maxlength="240" value="${escAttr(member?.address)}" autocomplete="street-address"></label>
      ${member ? yahrzeitEntryDetails(member, 'Member info') : ''}
      <p class="yr-help">All yahrzeit dates are optional. You can add them later.</p>
      <div class="yr-entries"></div><button type="button" data-yr-custom>+ Custom relationship</button>
      <div class="yr-dialog-actions">
        ${member ? '<button type="button" class="danger yr-remove-member">Delete member</button>' : ''}
        <button type="button" data-yr-close>Cancel</button><button type="submit" class="cal-primary">Save member</button>
      </div><p class="yr-status" role="status"></p></form>`);
    const form = dialog.querySelector('form'), entries = form.querySelector('.yr-entries'), status = form.querySelector('.yr-status');
    const custom = form.querySelector('[data-yr-custom]');
    const parentCount = () => [...entries.children].filter(row => row.dataset.kind !== 'custom' && (row.querySelector('[data-yr-month]').value || row.querySelector('[data-yr-day-select]').value || row.querySelector('[data-yr-deceased]').value.trim())).length;
    const updateLimit = () => { custom.disabled = entries.querySelectorAll('[data-kind="custom"]').length + parentCount() >= YAHRZEIT_MAX_OBSERVANCES; };
    const addEntry = (entry, focus = false) => {
      const row = document.createElement('fieldset');
      row.className = 'yr-entry';
      row.dataset.kind = entry.kind;
      if (entry.id) row.dataset.entryId = entry.id;
      row.innerHTML = `<legend>${entry.kind === 'custom' ? 'Custom relationship' : yahrzeitRelationship(entry)}</legend><div class="yr-entry-fields">
        ${entry.kind === 'custom' ? `<label>Relationship<input dir="auto" data-yr-relationship maxlength="60" required placeholder="For example, grandfather" value="${escAttr(entry.relationship)}"></label>` : ''}
        <div class="yr-date-fields">
          <label>Hebrew day<select data-yr-day-select><option value="">Day</option></select></label>
          <label>Hebrew month<select data-yr-month><option value="">Month</option>${YAHRZEIT_MONTHS.map(value => `<option value="${value}" ${entry.month === value ? 'selected' : ''}>${escText(yahrzeitMonthLabel(value))}</option>`).join('')}</select></label>
        </div>
        <label>Name of the deceased (optional)<input dir="auto" data-yr-deceased maxlength="140" value="${escAttr(entry.deceasedName)}"></label>
        <label data-yr-adar-rule hidden>In a leap year<select data-yr-adar><option value="first">Adar I</option><option value="second">Adar II</option><option value="both">Both Adars</option></select></label>
        <label data-yr-short-rule hidden>In years without the 30th<select data-yr-short><option value="">Choose the family’s custom</option><option value="previous">Use the 29th</option><option value="next">Use the 1st of the next month</option><option value="both">Show both dates</option></select></label>
        ${entry.id ? yahrzeitEntryDetails(entry) : ''}
        ${entry.kind === 'custom' ? '<button type="button" class="danger" data-yr-remove>Remove this yahrzeit</button>' : ''}
      </div>`;
      const monthField = row.querySelector('[data-yr-month]'), dayField = row.querySelector('[data-yr-day-select]');
      const adar = row.querySelector('[data-yr-adar]'), short = row.querySelector('[data-yr-short]');
      adar.value = entry.adar || 'first'; short.value = entry.shortMonth || '';
      const showRules = () => {
        row.querySelector('[data-yr-adar-rule]').hidden = Number(monthField.value) !== 12;
        row.querySelector('[data-yr-short-rule]').hidden = !yahrzeitVariableMonth(Number(monthField.value), Number(dayField.value));
        updateLimit();
      };
      const setDays = selected => {
        const limit = yahrzeitMonthLimit(Number(monthField.value));
        dayField.innerHTML = '<option value="">Day</option>' + Array.from({ length: limit }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
        dayField.value = selected || '';
        showRules();
      };
      monthField.addEventListener('change', () => setDays(dayField.value));
      dayField.addEventListener('change', showRules);
      row.querySelector('[data-yr-deceased]').addEventListener('input', updateLimit);
      row.querySelector('[data-yr-remove]')?.addEventListener('click', () => { row.remove(); updateLimit(); custom.focus(); });
      entries.append(row); setDays(entry.day);
      if (focus) row.querySelector('input').focus();
    };
    for (const kind of ['father', 'mother']) addEntry(member?.observances.find(entry => entry.kind === kind) || { kind });
    for (const entry of member?.observances.filter(item => item.kind === 'custom') || []) addEntry(entry);
    custom.addEventListener('click', () => addEntry({ kind: 'custom' }, true));
    const lockForm = value => {
      for (const control of form.elements) control.disabled = value;
      if (!value) updateLimit();
    };
    const save = async (method, contents = {}) => {
      lockForm(true); status.textContent = '';
      try {
        const saved = await request('/' + id, method, { ...contents, revision });
        members = members.filter(item => item.id !== id);
        if (method !== 'DELETE') members.push(saved);
        sortMembers();
        if (!member && method !== 'DELETE') {
          const serial = calendarSerial(today()), { year } = hebrewDateExtended(serial);
          const next = Math.min(...saved.observances.flatMap(entry => [year, year + 1].flatMap(y => yahrzeitDates(entry, y))).filter(date => date >= serial));
          if (Number.isFinite(next)) month = calendarISO(next).slice(0, 7);
        }
        yahrzeitRoot.querySelector('[data-yr-summary]').textContent = method === 'DELETE' ? 'Member removed.' : 'Saved to the website.';
        renderGrid();
        dialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { lockForm(false); }
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const observances = [...entries.children].map(row => ({
          id: row.dataset.entryId, kind: row.dataset.kind, relationship: row.querySelector('[data-yr-relationship]')?.value,
          deceasedName: row.querySelector('[data-yr-deceased]').value,
          month: Number(row.querySelector('[data-yr-month]').value),
          day: Number(row.querySelector('[data-yr-day-select]').value),
          adar: row.querySelector('[data-yr-adar]').value, shortMonth: row.querySelector('[data-yr-short]').value,
        })).filter(entry => entry.kind === 'custom' || entry.month || entry.day || entry.deceasedName.trim());
        save('POST', yahrzeitMember({ name: form.elements.name.value, address: form.elements.address.value, observances }));
      } catch (error) { status.textContent = error.message; }
    });
    form.querySelector('.yr-remove-member')?.addEventListener('click', () => {
      if (window.confirm(`Delete ${member.name} and their saved yahrzeits?`)) save('DELETE');
    });
  }

  for (const arrow of yahrzeitRoot.querySelectorAll('[data-yr-step]')) {
    arrow.addEventListener('click', () => {
      const next = calendarStepMonth(month, Number(arrow.dataset.yrStep));
      if (Number.isFinite(calendarSerial(next + '-01'))) {
        month = next;
        renderGrid();
      }
    });
  }

  yahrzeitRoot.addEventListener('click', event => {
    const action = event.target.closest('button');
    if (!action) return;
    if (action.dataset.yrAdd !== undefined) openMemberForm();
    if (action.dataset.yrManage !== undefined) openMemberList();
    if (action.dataset.yrImport !== undefined) openMemberImport();
    if (action.dataset.yrFind !== undefined) openHebrewDateSearch();
    if (action.dataset.yrOptions !== undefined) openCalendarOptions();
    if (action.dataset.yrView) showView(action.dataset.yrView);
    if (action.dataset.yrRefresh !== undefined) {
      try { sessionStorage.setItem(refreshViewKey, JSON.stringify({ month, view, range: list.settings() })); }
      catch { /* The refresh still works. */ }
      location.reload();
    }
    if (action.dataset.yrLogout !== undefined) auth.lock();
    if (action.dataset.yrEdit) {
      const member = members.find(item => item.id === action.dataset.yrEdit);
      if (member) openMemberForm(member);
    }
    if (action.dataset.yrToday !== undefined) { selected = today(); month = selected.slice(0, 7); renderGrid(); }
    if (action.dataset.yrDay) openDay(action.dataset.yrDay);
    if (action.dataset.yrListDay) {
      month = action.dataset.yrListDay.slice(0, 7);
      renderGrid();
      openDay(action.dataset.yrListDay);
    }
    if (action.dataset.yrJump !== undefined) {
      show('Choose a month', `<form><label>Month and year<input type="month" name="month" min="1900-01" max="2299-12" value="${escAttr(month)}" required></label><div class="yr-dialog-actions"><button type="button" data-yr-find>Find Hebrew date</button><button type="submit" class="cal-primary">Go to month</button></div></form>`);
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const next = event.target.elements.month.value;
        if (!Number.isFinite(calendarSerial(next + '-01'))) return;
        month = next; renderGrid(); dialog.close();
      });
    }
  });
  showView(view);
  renderGrid();
}

if (yahrzeitRoot) openYahrzeitCalendar().catch(error => {
  yahrzeitRoot.innerHTML = '<div class="seats-loading"><h1>Yahrzeit Calendar</h1><p role="status"></p><button type="button">Try again</button></div>';
  yahrzeitRoot.querySelector('[role=status]').textContent = error.message || 'The calendar could not be opened.';
  const button = yahrzeitRoot.querySelector('button');
  if (error.signIn) button.textContent = 'Sign in';
  button.addEventListener('click', error.signIn || (() => location.reload()));
});
