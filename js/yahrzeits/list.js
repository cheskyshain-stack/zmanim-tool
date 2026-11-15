import { calendarISO, calendarSerial } from '../calendar/model.js';
import { hebrewDateExtended, jewishDateString, roshHashana } from '../hebrew-calendar.js';
import { escAttr, escText } from '../util.js';
import { yahrzeitDates, yahrzeitRelationship } from './model.js';

const yahrzeitListPresets = [
  ['today', 'Around today'],
  ['day', 'Today only'],
  ['year', 'This year'],
  ['next-year', 'Next year'],
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
  if (preset === 'today') return { start: calendarSerial('1900-01-01'), end: calendarSerial('2299-12-31') };
  if (preset === 'day') return { start: now, end: now };
  if (preset === 'year' || preset === 'next-year') {
    const year = Number(today.slice(0, 4)) + (preset === 'next-year' ? 1 : 0);
    return year <= 2299 ? { start: calendarSerial(year + '-01-01'), end: calendarSerial(year + '-12-31') } : null;
  }
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

export function* yahrzeitListDays(members, { start, end }, newestFirst = false) {
  const tracked = members.filter(member => member.observances.length);
  if (!tracked.length || start > end) return;
  const first = hebrewDateExtended(start).year, last = hebrewDateExtended(end).year;
  const order = newestFirst ? -1 : 1, stop = newestFirst ? first : last;
  for (let year = newestFirst ? last : first; (stop - year) * order >= 0; year += order) {
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
    for (const serial of [...matches.keys()].sort((a, b) => (a - b) * order)) yield { serial, entries: matches.get(serial) };
  }
}

export function createYahrzeitList(host, today, saved) {
  const preset = yahrzeitListPresets.some(([value]) => value === saved?.preset) ? saved.preset : 'today';
  host.innerHTML = `<form class="yr-list-filters">
    <label for="yr-range-preset">Date range</label>
    <select id="yr-range-preset" name="preset">
      ${yahrzeitListPresets.map(([value, text]) => `<option value="${value}" ${value === preset ? 'selected' : ''}>${text}</option>`).join('')}
    </select>
    <button type="button" data-yr-list-jump>Today</button>
    <fieldset class="yr-custom-dates" hidden disabled>
      <label>From<input name="from" type="date" min="1900-01-01" max="2299-12-31" required></label>
      <label>To<input name="to" type="date" min="1900-01-01" max="2299-12-31" required></label>
      <button type="submit">Apply dates</button>
    </fieldset>
    <p class="yr-range-note" role="status"></p>
  </form>
  <div class="yr-list-scroll" role="region" aria-label="Yahrzeits by date" tabindex="0">
    <button type="button" data-yr-list-earlier hidden>Show earlier dates</button>
    <div data-yr-list-history></div>
    <div class="yr-list-upcoming">
      <p class="yr-today-marker" data-yr-list-today hidden></p>
      <div data-yr-list-results></div>
      <button type="button" data-yr-list-more hidden>Show more dates</button>
    </div>
  </div>`;
  const form = host.querySelector('form'), custom = form.querySelector('fieldset');
  const note = host.querySelector('[role=status]'), scroll = host.querySelector('.yr-list-scroll');
  const results = host.querySelector('[data-yr-list-results]'), more = host.querySelector('[data-yr-list-more]');
  const history = host.querySelector('[data-yr-list-history]'), earlier = host.querySelector('[data-yr-list-earlier]');
  const todayMarker = host.querySelector('[data-yr-list-today]');
  form.elements.from.value = Number.isFinite(calendarSerial(saved?.from)) ? saved.from : today();
  form.elements.to.value = Number.isFinite(calendarSerial(saved?.to)) ? saved.to : calendarISO(calendarSerial(today()) + 6);
  let members, active, activeRange, appliedDay, future, past, needsTodayPosition;

  function pageFor(range, newestFirst = false) {
    const days = yahrzeitListDays(members || [], range, newestFirst);
    return { days, next: days.next() };
  }

  function append(listPage, target, button, newestFirst = false) {
    const groups = [];
    for (let i = 0; i < 60 && !listPage.next.done; i++, listPage.next = listPage.days.next()) {
      const { serial, entries } = listPage.next.value, date = calendarISO(serial);
      const english = yahrzeitListDate.format(yahrzeitDateTime(serial));
      groups.push({ year: date.slice(0, 4), card: `<section class="yr-list-date" aria-labelledby="yr-list-${date}">
        <h2 id="yr-list-${date}"><button type="button" data-yr-list-day="${date}" aria-label="${escAttr('View details for ' + english)}">
          <span><time datetime="${date}">${escText(english)}</time><span lang="he" dir="rtl">${escText(jewishDateString(serial, false))}</span></span><span aria-hidden="true">›</span>
        </button></h2>
        <ul>${entries.map(({ member, entry }) => `<li><strong dir="auto">${escText(member.name)}</strong>
          <span dir="auto">${escText(yahrzeitRelationship(entry))}${entry.deceasedName ? ': ' + escText(entry.deceasedName) : ''}</span></li>`).join('')}</ul>
      </section>` });
    }
    if (groups.length) {
      if (newestFirst) groups.reverse();
      let previousYear = newestFirst ? null : target.lastElementChild?.dataset.yrYear;
      if (!previousYear && target === results && !todayMarker.hidden) previousYear = appliedDay.slice(0, 4);
      const markup = groups.map(({ year, card }) => {
        const marker = year === previousYear ? '' : `<p class="yr-list-year">${year}</p>`;
        previousYear = year;
        return `<div data-yr-year="${year}">${marker}${card}</div>`;
      }).join('');
      const first = target.firstElementChild;
      if (newestFirst && first?.dataset.yrYear === previousYear) first.querySelector('.yr-list-year')?.remove();
      target.insertAdjacentHTML(newestFirst ? 'afterbegin' : 'beforeend', markup);
    }
    button.hidden = listPage.next.done;
  }

  function placeToday() {
    if (todayMarker.hidden || !scroll.clientHeight) return;
    scroll.style.setProperty('--yr-list-min-upcoming', scroll.clientHeight + 'px');
    if (!needsTodayPosition) return;
    scroll.scrollTop += todayMarker.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop;
    needsTodayPosition = false;
  }

  function render() {
    results.replaceChildren();
    history.replaceChildren();
    scroll.scrollTop = 0;
    scroll.style.removeProperty('--yr-list-min-upcoming');
    const aroundToday = active.preset === 'today', pivot = calendarSerial(appliedDay);
    todayMarker.hidden = !aroundToday;
    needsTodayPosition = aroundToday;
    if (aroundToday) {
      past = pageFor({ start: activeRange.start, end: pivot - 1 }, true);
      append(past, history, earlier, true);
      todayMarker.textContent = 'Today · ' + yahrzeitListDate.format(yahrzeitDateTime(pivot));
    } else {
      past = null;
      earlier.hidden = true;
    }
    future = pageFor({ start: aroundToday ? pivot : activeRange.start, end: activeRange.end });
    if (future.next.done) results.innerHTML = '<p class="yr-list-empty">No yahrzeits in this date range.</p>';
    append(future, results, more);
    placeToday();
  }

  function apply() {
    const selection = { preset: form.elements.preset.value, from: form.elements.from.value, to: form.elements.to.value };
    const todayISO = today();
    const range = yahrzeitListRange(selection.preset, todayISO, selection.from, selection.to);
    if (!range) {
      note.textContent = selection.preset === 'custom' ? 'Choose a From date and a To date in order.' : 'This range is outside the calendar.';
      return;
    }
    active = selection;
    activeRange = range;
    appliedDay = todayISO;
    if (active.preset === 'today') note.textContent = 'Scroll up for earlier dates or down for upcoming ones.';
    else {
      const start = yahrzeitListBound.format(yahrzeitDateTime(range.start)), end = yahrzeitListBound.format(yahrzeitDateTime(range.end));
      note.textContent = start === end ? start : start + ' to ' + end;
    }
    render();
  }

  function updatePreset() {
    const showCustom = form.elements.preset.value === 'custom';
    custom.disabled = custom.hidden = !showCustom;
    apply();
  }

  form.querySelector('[data-yr-list-jump]').addEventListener('click', () => {
    if (form.elements.preset.value !== 'today' || appliedDay !== today()) {
      form.elements.preset.value = 'today';
      updatePreset();
      return;
    }
    needsTodayPosition = true;
    placeToday();
  });
  form.elements.preset.addEventListener('change', updatePreset);
  form.addEventListener('submit', event => { event.preventDefault(); apply(); });
  more.addEventListener('click', () => {
    const before = results.children.length;
    append(future, results, more);
    results.children[before]?.querySelector('button')?.focus({ preventScroll: true });
  });
  earlier.addEventListener('click', () => {
    const first = history.firstElementChild, height = scroll.scrollHeight, top = scroll.scrollTop;
    append(past, history, earlier, true);
    scroll.scrollTop = top + scroll.scrollHeight - height;
    (first?.previousElementSibling || history.lastElementChild)?.querySelector('button')?.focus({ preventScroll: true });
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(placeToday).observe(scroll);
  updatePreset();
  return {
    open(nextMembers) {
      if (appliedDay !== today()) { members = nextMembers; apply(); }
      else if (nextMembers !== members) { members = nextMembers; render(); }
      else if (active.preset === 'today') { needsTodayPosition = true; placeToday(); }
    },
    update(nextMembers) {
      if (nextMembers === members) return;
      members = nextMembers;
      if (activeRange) render();
    },
    settings: () => active,
  };
}
