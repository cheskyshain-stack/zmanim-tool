// One week on its own page, for the congregation to read rather than for printing a
// season on a wall: the parsha at the top, then a row per minyan with its name on the
// right and its time on the left, running top to bottom.
//
// Nothing here is a new kind of saved sheet. A week card is the corresponding row of an
// already-generated chart, turned on its side: the chart's column headers become the row
// labels and the week's cells become the times. That means every manual edit, rule and
// override already in a sheet shows up here with no extra work, and the two can never
// drift apart.

import { resolveSettings } from '../settings.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { WEEKDAY_COLUMNS } from '../sheets/weekday.js';
import { inSpringDstWindow } from '../sheets/common.js';
import { applyRules } from '../rules.js';
import { mergeRow } from '../overrides.js';
import { hebrewDateExtended } from '../hebrew-calendar.js';
import { UL_START, UL_END } from '../format.js';
import { dateFromSerial } from '../zmanim/solar.js';

/** Every week of every saved Shabbos sheet, newest sheet first, so a week that appears
 *  in more than one saved sheet resolves to the most recently generated one. */
function weekIndex(state) {
  const sheets = [...state.sheets].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const bySerial = new Map();
  for (const sheet of sheets) {
    if (sheet.season === 'weekday') continue;
    // A saved week's date is an ISO string, not a Date: it went through localStorage.
    // The zmanim code calls Date methods on it, so revive it the way sheet-view does.
    for (const week of sheet.weeks) {
      if (!bySerial.has(week.serial)) bySerial.set(week.serial, { week: { ...week, date: new Date(week.date) }, sheet });
    }
  }
  return bySerial;
}

/** The weekday chart generated alongside a given Shabbos sheet, if there is one. */
function weekdayCompanionOf(sheet, state) {
  return state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
}

/** The week the congregation should be looking at: the next Shabbos still to come.
 *
 *  It rolls over once Shabbos is behind us, so Sunday morning already shows the coming
 *  week. Compared as a date rather than a moment, so the switch happens at midnight on
 *  Motzei Shabbos rather than at an exact tzais. */
function currentSerial(serials) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const upcoming = serials.filter((s) => dateFromSerial(s).getTime() >= todayUtc);
  return upcoming.length ? Math.min(...upcoming) : Math.max(...serials);
}

/** The chart row for one week, with rules and manual overrides applied, exactly as the
 *  printed chart would show it. */
function rowFor(week, sheet, state, settings) {
  const effectiveSeason = sheet.season === 'choref' && inSpringDstWindow(week.date, settings) ? 'kayitz' : sheet.season;
  const columns = effectiveSeason === 'kayitz' ? KAYITZ_COLUMNS : CHOREF_COLUMNS;
  const build = effectiveSeason === 'kayitz' ? buildKayitzRow : buildChorefRow;
  const hebrew = hebrewDateExtended(week.serial, settings.useGregorianBefore1582);
  const computed = build(week, settings);
  const ruled = applyRules(computed, { ...week, hebrew }, state.rules, effectiveSeason, new Set());
  const { row, overriddenKeys } = mergeRow(ruled, sheet, week.serial);
  return { row, columns, overriddenKeys };
}

const fmtDate = (date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);

/** A label/time line. The label keeps its line breaks as spaces, since a column header
 *  is wrapped to fit a narrow column and has no reason to wrap here. */
function line(label, value, isHtml = false) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `<div class="week-line">
    <span class="week-label">${weekEsc(label.replace(/\n/g, ' ').trim())}</span>
    <span class="week-time">${isHtml ? text : weekNl2br(text)}</span>
  </div>`;
}

function cardHtml(title, subtitle, linesHtml, settings) {
  return `<section class="week-card">
    <div class="page-header">
      <div class="header-row">
        <img class="header-icon" src="${settings.headerIconImage || 'assets/logo-building-icon.png'}" alt="">
        <div class="header-center">
          <img class="header-logo" src="assets/logo-text.png" alt="${weekEsc(settings.shulName)}">
          ${settings.headerSubtitle ? `<div class="header-subtitle">${weekEsc(settings.headerSubtitle)}</div>` : ''}
        </div>
        <div class="header-rabbi">${weekNl2br(settings.headerRabbiLine)}</div>
      </div>
    </div>
    <h3 class="week-title">${weekEsc(title)}</h3>
    ${subtitle ? `<p class="week-subtitle">${weekEsc(subtitle)}</p>` : ''}
    <div class="week-lines">${linesHtml}</div>
    <div class="page-footer">
      <span class="footer-line"></span>
      <div class="footer-text">
        <span class="footer-address">${weekEsc(settings.footerAddress)}</span>
      </div>
      <span class="footer-line"></span>
    </div>
  </section>`;
}

export function renderWeek(container, state, onSerialChange, serial = null) {
  const settings = resolveSettings(state.settings);
  const index = weekIndex(state);
  const serials = [...index.keys()].sort((a, b) => a - b);

  if (!serials.length) {
    container.innerHTML = `
      <h2>This week</h2>
      <p class="hint">One week at a time, laid out to read rather than to print. Generate a שבת sheet first and the weeks in it show up here.</p>`;
    return;
  }

  const showing = serials.includes(serial) ? serial : currentSerial(serials);
  const at = serials.indexOf(showing);
  const { week, sheet } = index.get(showing);
  const { row, columns, overriddenKeys } = rowFor(week, sheet, state, settings);

  // Printed order, right to left, so the card lists the minyanim in the same sequence
  // the wall chart does.
  const shabbosLines = [...columns].reverse().map((c) => line(c.header, row[c.key], overriddenKeys.has(c.key))).join('');

  const weekday = weekdayCompanionOf(sheet, state);
  const weekdayWeek = weekday?.weeks.find((w) => w.serial === showing);
  let weekdayLines = '';
  if (weekdayWeek) {
    const wdRow = mergeRow({ B: '', C: '' }, weekday, showing).row;
    weekdayLines = [...WEEKDAY_COLUMNS]
      .reverse()
      .map((c) => line(c.header, c.key === 'E' ? htmlLines(state.settings.weekdayShacharis) : wdRow[c.key], true))
      .join('');
  }

  const parsha = week.parsha + (week.specialParsha ? ' · ' + week.specialParsha : '');

  container.innerHTML = `
    <h2>This week</h2>
    <p class="hint">One week at a time, laid out to read rather than to print. It follows whichever שבת is next and moves on once Shabbos is over.</p>
    <div class="week-nav">
      <button type="button" id="week-prev" ${at <= 0 ? 'disabled' : ''}>&larr; Previous week</button>
      <span class="week-when">${fmtDate(week.date)}</span>
      <button type="button" id="week-next" ${at >= serials.length - 1 ? 'disabled' : ''}>Next week &rarr;</button>
    </div>
    ${cardHtml('פרשת ' + parsha, '', shabbosLines, state.settings)}
    ${weekdayLines ? cardHtml('זמני חול', 'Weekday', weekdayLines, state.settings) : ''}
  `;

  container.querySelector('#week-prev')?.addEventListener('click', () => onSerialChange(serials[at - 1]));
  container.querySelector('#week-next')?.addEventListener('click', () => onSerialChange(serials[at + 1]));
}

/** Rich text from Settings, kept as HTML but with its own outer whitespace trimmed. */
function htmlLines(html) {
  return String(html ?? '').trim();
}

/** Escapes the text, then turns the UL_START/UL_END sentinels the formula ports leave
 *  behind into real <u> elements, and newlines into breaks. Without this an underlined
 *  alternate time loses its underline here while keeping it on the printed chart, and
 *  the sentinel characters sit in the output as invisible strays. */
function weekNl2br(str) {
  const escaped = weekEsc(str).split(UL_START).join('<u>').split(UL_END).join('</u>');
  return escaped.replace(/\n/g, '<br>');
}

function weekEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
