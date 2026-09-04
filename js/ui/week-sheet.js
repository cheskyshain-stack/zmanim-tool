// One week on one sheet, set the way the yomim noraim sheet is set.
//
// The two cards are the week as the boards have always had it: a שבת chart and a חול chart,
// each a page, each a name on the right facing a column of times. This is the same week read
// the other way round, as a day rather than as a table: four banded blocks down one sheet, in
// the order the week happens, with the name of the מנין and its times on one line.
//
// Both are offered and neither replaces the other, which is what was asked for. The switch is
// on the This week panel beside the two that were already there.
//
// Nothing here works a time out. Every value is the chart's own cell, through the same
// rowFor() the card is drawn with, so this carries the rules and it carries a hand edit to a
// cell as well. That is the same bargain the שבת שובה poster makes and for the same reason:
// two places that computed the same times would eventually disagree, and the one on the wall
// would be the one nobody had checked.
//
// Three things it does that the chart cannot, having the width:
//
//   הדלקת נרות and שקיעה are two rows. On the chart they share a cell because a column an
//   inch wide has no room for two, and one of them is a זמן rather than a מנין.
//
//   The blocks are in the order of the day, so שקיעה sits between מנחה מעריב and מעריב the
//   way it does on the ראש השנה sheet, rather than above them where the chart's column order
//   puts it.
//
//   A run of times that the chart broke over two lines to fit its column comes out on one
//   line here. A cell carrying a word does not: a דרשה or a ט באב note keeps the cell's own
//   breaks, since those lines are not simply more times.
import { rowFor, weekdayChartFor } from '../sheets/rows.js';
import { mergeRow } from '../overrides.js';
import { buildWeekdayRow } from '../sheets/weekday.js';
import { UL_START, UL_END } from '../format.js';
import { hebrewLang, escAttr, SOFT_SLASH } from '../util.js';
import { fontStackFor } from './sheet-view.js';

/** The same face the posters are set in, for the same reason: a sheet is its own document
 *  and does not change when somebody picks a different font for the board. */
const SHEET_FONT = 'Times New Roman';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A cell as the sheet sets it: the underline sentinels become real underlines, and the
 *  cell's own lines are either run together or kept.
 *
 *  Run together when the cell is nothing but times and separators, which is the case the
 *  chart only broke to fit a column an inch wide; kept when it carries a word, because a
 *  דרשה, a ט באב note or a שקיעה is a line of its own and not one more time. The same test
 *  capTimesPerLine uses on the week cards, so the two agree about what a line is. */
function sheetCellHtml(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // The separator is a span rather than plain text so a slash left at the end of a line can
  // be turned into the break itself once the type is settled, the same as on the weekday
  // card. It has to be able to turn at all, which the charts' own SLASH cannot: see
  // SOFT_SLASH, and fitWeekSheet for what an unbreakable run costs on this sheet.
  const sep = `<span class="week-sep">${esc(SOFT_SLASH)}</span>`;
  const joined = lines.some(isNoteLine)
    ? lines.map(esc).join('<br>')
    : lines.map(esc).join(sep);
  return joined.split(esc(UL_START)).join('<u>').split(esc(UL_END)).join('</u>');
}

/** A line of a cell that is something other than more times, and so has to keep the break the
 *  chart gave it.
 *
 *  There are two kinds of word in these cells and they want opposite things. A פלג line names
 *  the זמן the מנין above it is set against, and the two belong together: on the chart they are
 *  stacked because the column is an inch wide, and given the width they read as one line,
 *  "7:35 / פלג 7:50". A דרשה or a ט באב line is a different announcement on a line of its own,
 *  and running it into the times either side of it would read as a time nobody davens. */
function isNoteLine(line) {
  const bare = String(line).split(UL_START).join('').split(UL_END).join('').trim();
  return /\p{L}/u.test(bare) && !bare.startsWith('פלג');
}

/** The rich text out of Settings as one of these cells: the underlines kept, every other tag
 *  dropped. Without this the שחרית row lost the underline the card and the board both give it,
 *  since the field stores real <u> elements where a computed cell carries the sentinels. */
function fromSettingsHtml(html) {
  return String(html ?? '')
    .replace(/<\s*u\s*>/gi, UL_START)
    .replace(/<\s*\/\s*u\s*>/gi, UL_END)
    .replace(/<[^>]+>/g, '');
}

/** One row: the name on the right, the times on the left, the way a timetable is read.
 *
 *  The same markup the yomim noraim sheet's rows use, so the two are one design rather than
 *  two that look alike. */
function sheetRow(label, value, sub = '') {
  const times = sheetCellHtml(value);
  if (!times) return '';
  return `<div class="onepage-row">
      <span class="onepage-label"${hebrewLang(label)}>${esc(label)}${
        sub ? ` <span class="onepage-sub"${hebrewLang(sub)}>${esc(sub)}</span>` : ''
      }</span>
      <div class="onepage-times"><bdi class="onepage-line" dir="ltr">${times}</bdi></div>
    </div>`;
}

const sheetSection = (title, rows) => (rows.filter(Boolean).length
  ? `<section class="onepage-sec">
      <h3 class="onepage-sec-head"${hebrewLang(title)}>${esc(title)}</h3>
      ${rows.filter(Boolean).join('')}
    </section>`
  : '');

/** A column's heading split into the name of the מנין and the זמן it is set against.
 *
 *  A chart heading is written to wrap inside a narrow column, so its lines are a name broken
 *  up rather than several things: "מנחה / (למטה) / פלג מ״א" is one מנין. The last line is the
 *  exception where it names the reckoning rather than the מנין, which is every פלג column and
 *  the ס״ז קר״ש one, and that becomes the smaller line beside the name. Everything else joins
 *  the name, brackets and all, since the room is part of which מנין this is. */
function nameAndBasis(header) {
  const lines = String(header).split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const isBasis = lines.length > 1 && (last.startsWith('פלג') || last.includes('גר'));
  return {
    label: (isBasis ? lines.slice(0, -1) : lines).join(' '),
    sub: isBasis ? last : '',
  };
}

/* Which part of the week each column belongs to, and in what order it is read.
 *
 * Written out per season rather than taken from the columns table, because the table's own
 * order is the chart's, left to right across a page, and this sheet is read down a day. It is
 * keyed by season because a letter means different things on the two charts: קיץ's ערב שבת
 * מנחה is column L and חורף's is column I, which is the same trap upcoming.js names.
 *
 * H is not here: it is the one cell holding two zmanim, and it is split by hand below so that
 * שקיעה can sit where it belongs in the day rather than where the column order puts it. */
const SHEET_PLAN = {
  kayitz: {
    erev: ['L', 'K', 'J', 'I'],
    day: ['E', 'D', 'C'],
    motzei: ['B'],
    // the מנין that runs into שקיעה, printed after the candles and before שקיעה itself
    minchaMaariv: 'G',
    maariv: 'F',
  },
  choref: {
    erev: ['I'],
    day: ['E', 'D', 'C'],
    motzei: ['B'],
    minchaMaariv: 'G',
    maariv: 'F',
  },
};

const SHEET_TEXT = {
  erev: 'ערב שבת',
  day: 'שבת',
  motzei: 'מוצאי שבת',
  chol: 'זמני חול',
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
};

/** The week's four blocks, out of the chart's own cells. */
function sheetSections(showing, index, state, settings) {
  const { week, sheet } = index.get(showing);
  const out = [];

  if (sheet && SHEET_PLAN[sheet.season]) {
    const plan = SHEET_PLAN[sheet.season];
    const built = rowFor({ ...week, date: new Date(week.date) }, sheet, state, settings);
    const { row, columns } = built;
    const byKey = new Map(columns.map((c) => [c.key, c]));
    const rowFor1 = (key) => {
      const col = byKey.get(key);
      if (!col) return '';
      const { label, sub } = nameAndBasis(col.header);
      return sheetRow(label, row[key], sub);
    };
    // הדלקת נרות is the first line of its cell and שקיעה the second, which is how
    // candleLightingCell writes it. Split rather than parsed: the second line is the word and
    // the time together, so the word comes off and the time is what is left.
    const [candles, shkiaLine] = String(row.H ?? '').split('\n');
    const shkia = String(shkiaLine ?? '').replace(SHEET_TEXT.shkia, '').trim();
    out.push([SHEET_TEXT.erev, [
      ...plan.erev.map(rowFor1),
      sheetRow(SHEET_TEXT.candles, candles),
      rowFor1(plan.minchaMaariv),
      sheetRow(SHEET_TEXT.shkia, shkia),
      rowFor1(plan.maariv),
    ]]);
    out.push([SHEET_TEXT.day, plan.day.map(rowFor1)]);
    out.push([SHEET_TEXT.motzei, plan.motzei.map(rowFor1)]);
  }

  // The weekday side of the week, the same three the חול card carries. Built from the
  // formulas and then overridden, exactly like the Shabbos row above.
  const weekday = weekdayChartFor(sheet, showing, state);
  const weekdayWeek = weekday?.weeks.find((w) => w.serial === showing);
  if (weekdayWeek) {
    const { row: wdRow } = mergeRow(buildWeekdayRow(weekdayWeek, settings), weekday, showing);
    out.push([SHEET_TEXT.chol, [
      sheetRow('שחרית', fromSettingsHtml(state.settings.weekdayShacharis)),
      sheetRow('מנחה', wdRow.C),
      sheetRow('מעריב', wdRow.B),
    ]]);
  }
  return out;
}

/** The key at the foot, built from what is really on this sheet rather than written out.
 *  Same rule and same wording as the week card's own legend. */
function sheetLegend(html) {
  const lines = [];
  if (html.includes('<u>')) lines.push({ dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' });
  const stars = [];
  if (/\d:\d\d\*(?!\*)/.test(html)) stars.push('*בעזרת נשים');
  if (/\d:\d\d\*\*/.test(html)) stars.push('**באולם השמחות');
  if (stars.length) lines.push({ dir: 'rtl', text: stars.join(' ') });
  return lines;
}

/** The whole sheet, ready to be dropped into the page.
 *
 *  `title` comes in rather than being worked out here, because the card already has a name
 *  for this week and the two should not be able to disagree about what it is called. */
export function weekSheetHtml(showing, index, state, settings, title) {
  const sections = sheetSections(showing, index, state, settings);
  const body = sections.map(([name, rows]) => sheetSection(name, rows)).join('');
  if (!body) return '';
  const legend = sheetLegend(body);
  const rabbi = String(settings.headerRabbiLine || '').split('\n').filter(Boolean);
  // The wall charts' header, one row, with the building in the corner. dir="ltr" on the row,
  // so the first cell is the left one: that is where the icon was asked for and it is where
  // the charts and the week cards already put it.
  return `<div class="poster is-chart-head is-onepage is-weeksheet" dir="rtl"
      style="--poster-font-family: ${escAttr(fontStackFor(SHEET_FONT))}">
    <div class="page-header" dir="ltr">
      <div class="header-row">
        <img class="header-icon" src="${escAttr(settings.headerIconImage || '/assets/logo-building-icon.png')}" alt="">
        <div class="header-center">
          <img class="header-logo" src="/assets/logo-text.png"
               alt="${escAttr(settings.shulName)}"${hebrewLang(settings.shulName)}>
          ${settings.headerSubtitle
            ? `<div class="header-subtitle"${hebrewLang(settings.headerSubtitle)}>${esc(settings.headerSubtitle)}</div>`
            : ''}
        </div>
        <div class="header-rabbi">${rabbi.map((l) => `<div${hebrewLang(l)}>${esc(l)}</div>`).join('')}</div>
      </div>
    </div>
    <h2 class="onepage-title"${hebrewLang(title)}>${esc(title)}</h2>
    <div class="onepage-cols"><div class="onepage-col">${body}</div></div>
    ${legend.length
      ? `<div class="poster-legend">${legend
          .map((l) => `<div dir="${l.dir}"${hebrewLang(l.text)}>${esc(l.text)}</div>`).join('')}</div>`
      : ''}
  </div>`;
}

/** Room left at the foot before a size counts as fitting, in the sheet's own pixels. The same
 *  tenth of an inch the yomim noraim sheet leaves itself, and for the same reason: every
 *  device lays a line of type out a little differently, and fitted to the last pixel here some
 *  of them come out a line over there. */
const WS_ROOM = 11;
const WS_MIN = 1;
const WS_MAX = 3.2;

/** Sets the type to the largest that still fits the sheet.
 *
 *  A week is far less to fit than a whole yomim noraim, which is the whole difficulty here
 *  rather than the usual one: קיץ is fifteen rows and חורף twelve, against that sheet's
 *  fifty-nine. Left at the size that sheet is set to, a week fills a third of the page and
 *  the rest is blank, which on a wall reads as a sheet that failed to finish. Measured: the
 *  tallest block came to 32% of the page on קיץ and 25% on חורף.
 *
 *  So it grows, upwards and measured, the way the yomim noraim sheet's own fitter works: start
 *  at the size that certainly fits, grow while it still does, and take the last size that did.
 *  Coarse then fine, because each step is a reflow of the whole sheet and this runs on a phone.
 *
 *  The column is set to space-between, which pushes the last block to the foot whatever is in
 *  it, so top-to-bottom always measures the full height and would say nothing. It is packed to
 *  the top for the measurement and put back afterwards.
 *
 *  It runs after the sheet has been scaled to the window, not before, and that is the same bug
 *  the yomim noraim sheet got wrong once and for the same reason. Measured unscaled the answer
 *  is right on a desktop and wrong on a phone: under the zoom a screen puts on the sheet, every
 *  row rounds to whole device pixels and the block comes out taller in the sheet's own space.
 *  Measured here before the fix: the last row ended 13px above the foot at 1440px and 4, 7 and
 *  8px past it at 412, 375 and 360. So it is measured in the state the sheet is actually in,
 *  and every measurement is divided back by that zoom, so the room left at the foot means the
 *  same tenth of an inch whatever the screen did to the sheet. */
export function fitWeekSheet(container) {
  for (const sheet of container.querySelectorAll('.poster.is-weeksheet')) {
    const cols = sheet.querySelector('.onepage-cols');
    const col = cols?.querySelector(':scope > .onepage-col');
    if (!col) continue;
    const first = col.querySelector('.onepage-sec');
    const rows = col.querySelectorAll('.onepage-row');
    if (!first || !rows.length) continue;
    const last = rows[rows.length - 1];

    if (!cols.getBoundingClientRect().height) continue;
    col.style.justifyContent = 'flex-start';
    // Everything through getBoundingClientRect and divided by the sheet's own zoom, so the
    // two sides of the comparison and the room at the foot are all in the sheet's pixels.
    const zoom = () => parseFloat(getComputedStyle(sheet).zoom) || 1;
    // The room is measured at every size, not once at the start. --op-scale sets the title
    // above the columns as well as the rows in them, so growing the type takes room away at
    // the same time as it uses more: measured once at scale 1 the answer came out 12px over.
    const fits = (scale) => {
      sheet.style.setProperty('--op-scale', scale.toFixed(2));
      const z = zoom();
      const box = cols.getBoundingClientRect();
      const tall = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / z;
      return tall <= box.height / z - WS_ROOM && cols.scrollWidth <= cols.clientWidth + 1;
    };
    let best = WS_MIN;
    for (let s = WS_MIN; s <= WS_MAX + 1e-9; s += 0.05) {
      if (!fits(s)) break;
      best = s;
    }
    for (let s = best + 0.01; s <= Math.min(best + 0.05, WS_MAX) + 1e-9; s += 0.01) {
      if (!fits(s)) break;
      best = s;
    }
    sheet.style.setProperty('--op-scale', best.toFixed(2));
    col.style.justifyContent = '';
  }
}
