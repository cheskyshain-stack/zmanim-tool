import { calendarMonth, calendarStepMonth, calendarSerial, calendarISO } from './calendar/model.js';
import { loadTables } from './data-loader.js';
import { seatsOpenSession } from './seats/session.js';
import { escAttr, escText } from './util.js';
import { websiteLocalFields } from './website-clock.js';
import { JEWISH_MONTHS_EN, hebrewDateExtended } from './hebrew-calendar.js';
import { YAHRZEIT_MONTHS, YAHRZEIT_MAX_OBSERVANCES, yahrzeitMember, yahrzeitMonthLabel, yahrzeitMonthLimit, yahrzeitRelationship, yahrzeitVariableMonth, yahrzeitDates, yahrzeitsByDay } from './yahrzeits/model.js';

const yahrzeitRoot = document.getElementById('yahrzeit-app');
const yahrzeitFullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' });

async function openYahrzeitCalendar() {
  const auth = await seatsOpenSession(yahrzeitRoot, {
    title: 'Yahrzeit Calendar',
    intro: 'Sign in with the same name and PIN you use for Seats.',
    requireOnline: true,
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
      throw new Error('Sign in again to open the calendar.');
    }
    if (response.status === 404 && !path) throw new Error('The shared yahrzeit calendar is unavailable. Try again later.');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The yahrzeit calendar could not be updated.');
    return result;
  };

  const [tables, initial] = await Promise.all([loadTables(), request()]);
  const today = () => websiteLocalFields(new Date(), 'America/New_York').date;
  let month = today().slice(0, 7), members = initial.members, grid, onDay, dialogReturn;
  const sortMembers = () => members.sort((a, b) => a.name.localeCompare(b.name));
  sortMembers();
  yahrzeitRoot.innerHTML = `<section class="shul-calendar yr-card" aria-labelledby="yr-heading">
    <div class="cal-brand"><h1 id="yr-heading">Yahrzeit Calendar</h1><div class="yr-actions">
      <button type="button" data-yr-manage>Members</button>
      <button type="button" class="cal-primary" data-yr-add>+ Add member</button>
    </div></div>
    <div class="cal-toolbar"><div class="cal-month-nav">
      <button type="button" data-yr-month="-1" aria-label="Previous month">‹</button>
      <div><button type="button" class="cal-month-title" data-yr-jump></button><p lang="he" dir="rtl" data-yr-hebrew></p></div>
      <button type="button" data-yr-month="1" aria-label="Next month">›</button>
    </div><button type="button" data-yr-today>Today</button></div>
    <div class="cal-grid-wrap"></div>
    <div class="yr-footer"><p class="cal-interaction-hint" role="status" data-yr-summary>Tap a marked date to see its yahrzeits.</p><button type="button" data-yr-logout>Log out</button></div>
  </section><dialog class="cal-dialog yr-dialog" aria-labelledby="yr-dialog-title"></dialog>`;
  const host = yahrzeitRoot.querySelector('.cal-grid-wrap'), dialog = yahrzeitRoot.querySelector('dialog');
  const show = (title, content) => {
    if (!dialog.open) dialogReturn = document.activeElement;
    dialog.innerHTML = `<header class="cal-dialog-header"><h2 id="yr-dialog-title">${escText(title)}</h2><button type="button" aria-label="Close" data-yr-close>×</button></header>${content}`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector('[data-yr-close]').focus({ preventScroll: true });
  };
  dialog.addEventListener('click', event => { if (event.target.closest('[data-yr-close]')) dialog.close(); });
  dialog.addEventListener('close', () => {
    (dialogReturn?.isConnected ? dialogReturn : yahrzeitRoot.querySelector('[data-yr-manage]'))?.focus({ preventScroll: true });
  });

  function renderGrid() {
    grid = calendarMonth(month, { inIsrael: false }, tables);
    onDay = yahrzeitsByDay(members, grid.days);
    yahrzeitRoot.querySelector('[data-yr-jump]').textContent = grid.title + ' ▾';
    yahrzeitRoot.querySelector('[data-yr-jump]').setAttribute('aria-label', grid.title + ', choose a month');
    yahrzeitRoot.querySelector('[data-yr-hebrew]').textContent = grid.hebrewRange;
    yahrzeitRoot.querySelector('[data-yr-month="-1"]').disabled = month <= '1900-01';
    yahrzeitRoot.querySelector('[data-yr-month="1"]').disabled = month >= '2299-12';
    const now = today(), weeks = [];
    for (let i = 0; i < grid.days.length; i += 7) {
      weeks.push('<tr>' + grid.days.slice(i, i + 7).map(day => {
        const count = onDay.get(day.serial)?.length || 0;
        const label = yahrzeitFullDate.format(new Date(day.iso + 'T12:00:00Z')) + (count ? ', ' + count + (count === 1 ? ' yahrzeit' : ' yahrzeits') : '');
        return `<td class="${day.inMonth ? '' : 'cal-outside'} ${day.shabbos ? 'cal-shabbos' : ''}">
          <button type="button" class="cal-day ${day.iso === now ? 'is-today' : ''}" data-yr-day="${day.iso}" aria-label="${escAttr(label)}" ${day.iso === now ? 'aria-current="date"' : ''}>
            <span class="cal-date-numbers"><span class="cal-english-day">${day.day}</span></span>
            ${day.parsha ? `<span class="yr-parsha" lang="he" dir="rtl">${escText(day.parsha)}</span>` : ''}
            ${count ? `<span class="yr-day-count">${count} <span aria-hidden="true">${count === 1 ? 'yahrzeit' : 'yahrzeits'}</span></span>` : ''}
            <span class="cal-hebrew-day" lang="he" dir="rtl">${escText(day.hebrewDay)}</span>
          </button></td>`;
      }).join('') + '</tr>');
    }
    host.innerHTML = `<table class="cal-grid" aria-label="${escAttr(grid.title)}"><thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Shabbos'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${weeks.join('')}</tbody></table>`;
  }

  function openDay(date) {
    const day = grid.days.find(item => item.iso === date);
    if (!day) return;
    const rows = onDay.get(day.serial) || [];
    show('Yahrzeits', `<div class="cal-day-heading"><h3>${escText(yahrzeitFullDate.format(new Date(date + 'T12:00:00Z')))}</h3><p lang="he" dir="rtl">${escText(day.hebrewLabel)}</p></div>
      ${rows.length ? `<ul class="yr-list">${rows.map(({ member, entry }) => `<li><div><strong dir="auto">${escText(member.name)}</strong><p dir="auto">${escText(yahrzeitRelationship(entry))}${entry.deceasedName ? ': ' + escText(entry.deceasedName) : ''}</p></div><button type="button" data-yr-edit="${escAttr(member.id)}" aria-label="${escAttr('Edit ' + member.name)}">Edit</button></li>`).join('')}</ul>` : '<p>No yahrzeits on this date.</p>'}`);
  }

  function openMemberList() {
    show('Members', `<label>Find a member<input type="search" data-yr-search></label>
      <ul class="yr-list"></ul><p class="yr-help" data-yr-empty></p><div class="yr-dialog-actions"><button type="button" data-yr-reload>Refresh</button><button type="button" data-yr-add class="cal-primary">+ Add member</button></div><p class="yr-status" role="status"></p>`);
    const search = dialog.querySelector('[data-yr-search]');
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const found = members.filter(member => member.name.toLocaleLowerCase().includes(query));
      dialog.querySelector('.yr-list').innerHTML = found.map(member => `<li><div><strong dir="auto">${escText(member.name)}</strong><p class="yr-help" dir="auto">${escText(member.observances.map(entry => yahrzeitRelationship(entry) + ': ' + entry.day + ' ' + JEWISH_MONTHS_EN[entry.month - 1]).join(' · '))}</p></div><button type="button" data-yr-edit="${escAttr(member.id)}" aria-label="${escAttr('Edit ' + member.name)}">Edit</button></li>`).join('');
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

  function openMemberForm(member) {
    const id = member?.id || crypto.randomUUID(), revision = member?.revision || 0;
    show(member ? 'Edit member' : 'Add member', `<form>
      <label>Congregation member<input name="name" dir="auto" maxlength="100" value="${escAttr(member?.name)}" required></label>
      <p class="yr-help">Fill in the dates you want to track. You can leave Father or Mother blank.</p>
      <div class="yr-entries"></div><button type="button" data-yr-custom>+ Custom relationship</button>
      <div class="yr-dialog-actions">
        ${member ? '<button type="button" class="danger yr-remove-member">Delete member</button>' : ''}
        <button type="button" data-yr-close>Cancel</button><button type="submit" class="cal-primary">Save yahrzeits</button>
      </div><p class="yr-status" role="status"></p></form>`);
    const form = dialog.querySelector('form'), entries = form.querySelector('.yr-entries'), status = form.querySelector('.yr-status');
    const custom = form.querySelector('[data-yr-custom]');
    const parentCount = () => [...entries.children].filter(row => row.dataset.kind !== 'custom' && (row.querySelector('[data-yr-month]').value || row.querySelector('[data-yr-day-select]').value || row.querySelector('[data-yr-deceased]').value.trim())).length;
    const updateLimit = () => { custom.disabled = entries.querySelectorAll('[data-kind="custom"]').length + parentCount() >= YAHRZEIT_MAX_OBSERVANCES; };
    const addEntry = (entry, focus = false) => {
      const row = document.createElement('fieldset');
      row.className = 'yr-entry';
      row.dataset.kind = entry.kind;
      row.innerHTML = `<legend>${entry.kind === 'custom' ? 'Custom relationship' : yahrzeitRelationship(entry)}</legend><div class="yr-entry-fields">
        ${entry.kind === 'custom' ? `<label>Relationship<input dir="auto" data-yr-relationship maxlength="60" required placeholder="For example, grandfather" value="${escAttr(entry.relationship)}"></label>` : ''}
        <div class="yr-date-fields">
          <label>Hebrew day<select data-yr-day-select><option value="">Day</option></select></label>
          <label>Hebrew month<select data-yr-month><option value="">Month</option>${YAHRZEIT_MONTHS.map(value => `<option value="${value}" ${entry.month === value ? 'selected' : ''}>${escText(yahrzeitMonthLabel(value))}</option>`).join('')}</select></label>
        </div>
        <label>Name of the deceased (optional)<input dir="auto" data-yr-deceased maxlength="140" value="${escAttr(entry.deceasedName)}"></label>
        <label data-yr-adar-rule hidden>In a leap year<select data-yr-adar><option value="first">Adar I</option><option value="second">Adar II</option><option value="both">Both Adars</option></select></label>
        <label data-yr-short-rule hidden>In years without the 30th<select data-yr-short><option value="">Choose the family’s custom</option><option value="previous">Use the 29th</option><option value="next">Use the 1st of the next month</option><option value="both">Show both dates</option></select></label>
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
        yahrzeitRoot.querySelector('[data-yr-summary]').textContent = method === 'DELETE' ? 'Member removed.' : 'Saved to the website. Tap a date to see its yahrzeits.';
        renderGrid();
        dialog.close();
      } catch (error) { status.textContent = error.message; }
      finally { lockForm(false); }
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const observances = [...entries.children].map(row => ({
          kind: row.dataset.kind, relationship: row.querySelector('[data-yr-relationship]')?.value,
          deceasedName: row.querySelector('[data-yr-deceased]').value,
          month: Number(row.querySelector('[data-yr-month]').value),
          day: Number(row.querySelector('[data-yr-day-select]').value),
          adar: row.querySelector('[data-yr-adar]').value, shortMonth: row.querySelector('[data-yr-short]').value,
        })).filter(entry => entry.kind === 'custom' || entry.month || entry.day || entry.deceasedName.trim());
        save('POST', yahrzeitMember({ name: form.elements.name.value, observances }));
      } catch (error) { status.textContent = error.message; }
    });
    form.querySelector('.yr-remove-member')?.addEventListener('click', () => {
      if (window.confirm(`Delete ${member.name} and their saved yahrzeits?`)) save('DELETE');
    });
  }

  yahrzeitRoot.addEventListener('click', event => {
    const action = event.target.closest('button');
    if (!action) return;
    if (action.dataset.yrAdd !== undefined) openMemberForm();
    if (action.dataset.yrManage !== undefined) openMemberList();
    if (action.dataset.yrLogout !== undefined) auth.lock();
    if (action.dataset.yrEdit) {
      const member = members.find(item => item.id === action.dataset.yrEdit);
      if (member) openMemberForm(member);
    }
    if (action.dataset.yrMonth) { month = calendarStepMonth(month, Number(action.dataset.yrMonth)); renderGrid(); }
    if (action.dataset.yrToday !== undefined) { month = today().slice(0, 7); renderGrid(); }
    if (action.dataset.yrDay) openDay(action.dataset.yrDay);
    if (action.dataset.yrJump !== undefined) {
      show('Choose a month', `<form><label>Month and year<input type="month" name="month" min="1900-01" max="2299-12" value="${escAttr(month)}" required></label><div class="yr-dialog-actions"><button type="submit" class="cal-primary">Go to month</button></div></form>`);
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const next = event.target.elements.month.value;
        if (!Number.isFinite(calendarSerial(next + '-01'))) return;
        month = next; renderGrid(); dialog.close();
      });
    }
  });
  renderGrid();
}

if (yahrzeitRoot) openYahrzeitCalendar().catch(error => {
  yahrzeitRoot.innerHTML = '<div class="seats-loading"><h1>Yahrzeit Calendar</h1><p role="status"></p><button type="button">Try again</button></div>';
  yahrzeitRoot.querySelector('[role=status]').textContent = error.message || 'The calendar could not be opened.';
  yahrzeitRoot.querySelector('button').addEventListener('click', () => location.reload());
});
