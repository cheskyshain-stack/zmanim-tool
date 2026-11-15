import { calendarISO, calendarSerial } from '../calendar/model.js';
import { hebrewDateExtended, jewishDateString, roshHashana } from '../hebrew-calendar.js';
import { escAttr, escText } from '../util.js';
import { yahrzeitDates, yahrzeitRelationship } from './model.js';

const yahrzeitListPresets = [
  ['year', 'This year'],
  ['hebrew-year', 'Hebrew year'],
  ['week', 'This week'],
  ['next-week', 'Next week'],
  ['custom', 'Custom dates'],
];
const yahrzeitListDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const yahrzeitListBound = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const yahrzeitDateTime = serial => new Date(calendarISO(serial) + 'T12:00:00Z');

export function yahrzeitListRange(preset, today, from, to) {
  const now = calendarSerial(today);
  const year = today.slice(0, 4);
  if (preset === 'year') return { start: calendarSerial(year + '-01-01'), end: calendarSerial(year + '-12-31') };
  if (preset === 'hebrew-year') {
    const hebrew = hebrewDateExtended(now).year;
    return { start: roshHashana(hebrew - 3761), end: roshHashana(hebrew - 3760) - 1 };
  }
  if (preset === 'week' || preset === 'next-week') {
    const start = now - yahrzeitDateTime(now).getUTCDay() + (preset === 'next-week' ? 7 : 0);
    return { start, end: start + 6 };
  }
  const start = calendarSerial(from), end = calendarSerial(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

export function* yahrzeitListDays(members, { start, end }) {
  const tracked = members.filter(member => member.observances.length);
  if (!tracked.length) return;
  const first = hebrewDateExtended(start).year, last = hebrewDateExtended(end).year;
  for (let year = first; year <= last; year++) {
    const matches = new Map();
    for (const member of tracked) {
      for (const entry of member.observances) {
        for (const date of yahrzeitDates(entry, year)) {
          if (date < start || date > end) continue;
          if (!matches.has(date)) matches.set(date, []);
          matches.get(date).push({ member, entry });
        }
      }
    }
    for (const serial of [...matches.keys()].sort((a, b) => a - b)) yield { serial, entries: matches.get(serial) };
  }
}

export function createYahrzeitList(host, today, saved) {
  const preset = yahrzeitListPresets.some(([value]) => value === saved?.preset) ? saved.preset : 'year';
  host.innerHTML = `<form class="yr-list-filters">
    <label for="yr-range-preset">Date range</label>
    <select id="yr-range-preset" name="preset">
      ${yahrzeitListPresets.map(([value, text]) => `<option value="${value}" ${value === preset ? 'selected' : ''}>${text}</option>`).join('')}
    </select>
    <fieldset class="yr-custom-dates" hidden disabled>
      <label>From<input name="from" type="date" min="1900-01-01" max="2299-12-31" required></label>
      <label>To<input name="to" type="date" min="1900-01-01" max="2299-12-31" required></label>
      <button type="submit">Apply dates</button>
    </fieldset>
    <p class="yr-range-note" role="status"></p>
  </form>
  <div class="yr-list-scroll" role="region" aria-label="Yahrzeits by date" tabindex="0">
    <div data-yr-list-results></div>
    <button type="button" data-yr-list-more hidden>Show more dates</button>
  </div>`;
  const form = host.querySelector('form'), custom = form.querySelector('fieldset');
  const note = host.querySelector('[role=status]'), scroll = host.querySelector('.yr-list-scroll');
  const results = host.querySelector('[data-yr-list-results]'), more = host.querySelector('[data-yr-list-more]');
  form.elements.from.value = Number.isFinite(calendarSerial(saved?.from)) ? saved.from : today();
  form.elements.to.value = Number.isFinite(calendarSerial(saved?.to)) ? saved.to : calendarISO(calendarSerial(today()) + 6);
  let members, active, activeRange, days, next;

  function append() {
    const groups = [];
    for (let i = 0; i < 60 && !next.done; i++, next = days.next()) {
      const { serial, entries } = next.value, date = calendarISO(serial);
      const english = yahrzeitListDate.format(yahrzeitDateTime(serial));
      groups.push(`<section class="yr-list-date" aria-labelledby="yr-list-${date}">
        <h2 id="yr-list-${date}"><button type="button" data-yr-list-day="${date}" aria-label="${escAttr('View details for ' + english)}">
          <span><time datetime="${date}">${escText(english)}</time><span lang="he" dir="rtl">${escText(jewishDateString(serial, false))}</span></span><span aria-hidden="true">›</span>
        </button></h2>
        <ul>${entries.map(({ member, entry }) => `<li><strong dir="auto">${escText(member.name)}</strong>
          <span dir="auto">${escText(yahrzeitRelationship(entry))}${entry.deceasedName ? ': ' + escText(entry.deceasedName) : ''}</span></li>`).join('')}</ul>
      </section>`);
    }
    results.insertAdjacentHTML('beforeend', groups.join(''));
    more.hidden = next.done;
  }

  function render() {
    results.replaceChildren();
    scroll.scrollTop = 0;
    days = yahrzeitListDays(members || [], activeRange);
    next = days.next();
    if (next.done) results.innerHTML = '<p class="yr-list-empty">No yahrzeits in this date range.</p>';
    append();
  }

  function apply() {
    const selection = { preset: form.elements.preset.value, from: form.elements.from.value, to: form.elements.to.value };
    const range = yahrzeitListRange(selection.preset, today(), selection.from, selection.to);
    if (!range) {
      note.textContent = 'Choose a From date and a To date in order.';
      return;
    }
    active = selection;
    activeRange = range;
    const start = yahrzeitListBound.format(yahrzeitDateTime(range.start)), end = yahrzeitListBound.format(yahrzeitDateTime(range.end));
    note.textContent = start === end ? start : start + ' to ' + end;
    render();
  }

  function updatePreset() {
    const showCustom = form.elements.preset.value === 'custom';
    custom.disabled = custom.hidden = !showCustom;
    apply();
  }

  form.elements.preset.addEventListener('change', updatePreset);
  form.addEventListener('submit', event => { event.preventDefault(); apply(); });
  more.addEventListener('click', () => {
    const before = results.children.length;
    append();
    results.children[before]?.querySelector('button')?.focus({ preventScroll: true });
  });
  updatePreset();
  return {
    update(nextMembers) {
      if (nextMembers === members) return;
      members = nextMembers;
      if (activeRange) render();
    },
    settings: () => active,
  };
}
