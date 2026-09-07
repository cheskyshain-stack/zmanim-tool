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
//   line here. A line carrying a word does not: a פלג, a דרשה or a ט באב note keeps the
//   cell's own break, since those lines are not simply more times.
import { rowFor, weekdayChartFor } from '../sheets/rows.js';
import { mergeRow } from '../overrides.js';
import { buildWeekdayRow } from '../sheets/weekday.js';
import { UL_START, UL_END } from '../format.js';
import { specialDaysInWeek } from '../hebrew-calendar.js';
import { TZG_TEXT } from '../posters/tzomgedalia.js';
import { slichosWeekLines } from '../posters/slichos.js';
import { hebrewLang, escAttr, SOFT_SLASH, differsFromSchedule } from '../util.js';
import { fontStackFor } from './sheet-view.js';

/** The same face the posters are set in, for the same reason: a sheet is its own document
 *  and does not change when somebody picks a different font for the board. */
const SHEET_FONT = 'Times New Roman';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A cell as the sheet sets it: the underline sentinels become real underlines, and the
 *  cell's own lines are either run together or kept.
 *
 *  Run together when both sides of a break are nothing but times, which is the case the chart
 *  only broke to fit a column an inch wide; kept when either side carries a word, because a
 *  פלג, a דרשה or a ט באב note is a line of its own and not one more time. */
function sheetCellHtml(value, { split = false } = {}) {
  const text = cellSource(value);
  if (!text) return '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // `split` keeps every break the cell came with, which is what the זמני חול block wants: its
  // lines are two schedules rather than one run cut to fit a column, and the chart itself sets
  // them on two lines.
  if (split) return lines.map(esc).join('<br>')
    .split(esc(UL_START)).join('<u>').split(esc(UL_END)).join('</u>');
  // The separator is a span rather than plain text so a slash left at the end of a line can
  // be turned into the break itself once the type is settled, the same as on the weekday
  // card. It has to be able to turn at all, which the charts' own SLASH cannot: see
  // SOFT_SLASH, and fitWeekSheet for what an unbreakable run costs on this sheet.
  const sep = `<span class="week-sep">${esc(SOFT_SLASH)}</span>`;
  const joined = lines.map((line, i) => (
    i && !ownLine(line) && !ownLine(lines[i - 1]) ? sep + esc(line) : (i ? '<br>' : '') + esc(line)
  )).join('');
  return joined.split(esc(UL_START)).join('<u>').split(esc(UL_END)).join('</u>');
}

/** A line of a cell that is something other than more times, and so keeps a line to itself.
 *
 *  Any line carrying a word. A דרשה or a ט באב line is an announcement and running it into the
 *  times either side of it would read as a time nobody davens. A פלג line was run in with the
 *  מנין above it for a while, on the grounds that it names the זמן that מנין is set against and
 *  the two are one thing; asked for on its own line instead, which is what the chart's own cell
 *  does and what leaves the times down the sheet reading as one column of times.
 *
 *  Decided a break at a time rather than for the whole cell, so a run of times that the chart
 *  cut only to fit its column still comes back together when the word is somewhere else in the
 *  cell. */
function ownLine(line) {
  const bare = String(line).split(UL_START).join('').split(UL_END).join('').trim();
  return /\p{L}/u.test(bare);
}

/** A cell's value as plain text with the underline sentinels in it, whatever it arrived as.
 *
 *  A computed cell is already that. A hand edit and the rich text fields out of Settings are
 *  HTML, because both are typed into a contenteditable, and dropping their tags wholesale put
 *  a literal `<u> 4:45</u><div>` on the sheet where a שבת שובה cell had been edited. So the
 *  underlines become sentinels, every break element becomes a break, and what is left of the
 *  markup goes.
 *
 *  Then the whitespace inside an underline is turned out of it. UNDERLINE_TIME writes a space
 *  in front of the time, which is right on the board (the rule runs a little ahead of the
 *  digits in a narrow column) and wrong here: measured on this sheet, an underlined time
 *  started 7.2px right of a plain one in the row above it, so a column of times came out
 *  ragged and every rule hung out to the left of what it underlines. A newline that ends up
 *  inside one is put outside instead, which keeps the break and keeps the tags balanced. */
function cellSource(value) {
  const text = String(value ?? '')
    .replace(/<\s*u\s*>/gi, UL_START)
    .replace(/<\s*\/\s*u\s*>/gi, UL_END)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?\s*(?:div|p)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
  return text
    .replace(new RegExp(`${UL_START}\\s*`, 'g'), (m) => (m.includes('\n') ? '\n' : '') + UL_START)
    .replace(new RegExp(`\\s*${UL_END}`, 'g'), (m) => UL_END + (m.includes('\n') ? '\n' : ''))
    /* Whatever separates two times becomes the slash this sheet separates times with.
     *
     * The computed columns are written with slashes and the typed fields out of Settings with
     * commas or with plain spaces, whichever the shul happened to type: the live שחרית is
     * "7:00 7:20* 7:35" and the same field on another device is "7:00, 7:20*, 7:35". Left
     * alone the שחרית row carried two spellings on one line, "7:00, 7:20*, 7:35 / 8:00".
     *
     * Only between two times. A space or a comma with a word on either side of it is left
     * where it is, so a דרשה or a ט באב note is untouched, and so is "פלג 5:44". Nothing is
     * changed in Settings or on the charts, which keep what was typed into them. */
    .replace(
      new RegExp(`([\\d*]${UL_END}?)(?:[ \\t]*,[ \\t]*|[ \\t]+)(?=[\\d${UL_START}])`, 'g'),
      `$1${SOFT_SLASH}`
    )
    .trim();
}

/** One row: the name on the right, the times on the left, the way a timetable is read.
 *
 *  The same markup the yomim noraim sheet's rows use, so the two are one design rather than
 *  two that look alike. Setting the זמני חול block the other way round, with the name on a line
 *  of its own and its times centred under it the way the חול card and the צום גדליה sheet set a
 *  תפילה, was built and taken out again: it costs the שבת block above it several steps of type,
 *  measured at --op-scale 1.43 as rows against 1.22 as blocks, and the two halves of one sheet
 *  stopped looking like one sheet. */
function sheetRow(label, value, sub = '', { split = false } = {}) {
  const times = sheetCellHtml(value, { split });
  if (!times) return '';
  return `<div class="onepage-row">
      <span class="onepage-label"${hebrewLang(label)}>${esc(label)}${
        // The sub is isolated, because it is not always Hebrew: the days a special שחרית runs
        // on are "(Monday, Thursday)", and a bracketed English list inside a right to left name
        // is reordered without it.
        sub ? ` <span class="onepage-sub"${hebrewLang(sub)}><bdi>${esc(sub)}</bdi></span>` : ''
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

/* The chart's columns in the order the day runs, and where the two zmanim out of the הדלקת
 * נרות cell go among them.
 *
 * Written out per season rather than taken from the columns table, because the table's own
 * order is the chart's, left to right across a page, and this sheet is read down a day. It is
 * keyed by season because a letter means different things on the two charts: קיץ's ערב שבת
 * מנחה is column L and חורף's is column I, which is the same trap upcoming.js names.
 *
 * One block, headed שבת, rather than the ערב שבת / שבת / מוצאי שבת it was first written as.
 * The names in it are the chart's own column headings and they already say which מנין each
 * one is, so the day headings were saying a second time what the row said, and the whole
 * Shabbos reads as one list the way the board has always had it. זמני חול keeps its own
 * heading, being a different set of days.
 *
 * `candles` and `shkia` are where the two halves of column H are dropped in, so שקיעה lands
 * between מנחה מעריב and מעריב the way it does on the ראש השנה sheet rather than above them
 * where the column order would put it. */
const SHEET_PLAN = {
  kayitz: { order: ['L', 'K', 'J', 'I', 'candles', 'G', 'shkia', 'F', 'E', 'D', 'C', 'B'] },
  choref: { order: ['I', 'candles', 'G', 'shkia', 'F', 'E', 'D', 'C', 'B'] },
};

const SHEET_TEXT = {
  shabbos: 'שבת',
  chol: 'זמני חול',
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
};

/** The extra שחרית lines a week's own days call for: ראש חודש, בה"ב and a fast.
 *
 *  The same three the חול card carries and off the same rule, specialDaysInWeek, so the card
 *  and the sheet cannot end up naming different days. צום גדליה was missing from this sheet
 *  altogether: it runs a list of its own, off the ימים נוראים sheet the shul hangs for that
 *  day, which opens at 6:20 where the ר"ח / בה"ב / תענית list out of Settings opens at 6:40.
 *
 *  One line per schedule rather than per day, again as on the card: a week's ר"ח and בה"ב days
 *  share a list and read as one line naming both. The fast goes first, being the one that is
 *  not the general rule, and the lines go after the everyday שחרית, because most of the week
 *  still runs on those times and they are what should be read first. */
function weekSpecialShacharis(showing, state, settings) {
  const days = specialDaysInWeek(showing, settings);
  // The same rule the card keeps: a fast morning is called by what is said at it, off the
  // constant its own sheet is headed with. See dayLabel in week-view.js.
  const name = (d) => `${d.fast ? TZG_TEXT.shacharis : 'שחרית'} ${d.name}`;
  const out = [];
  /* The יומים נוראים season first, which decides the morning outright rather than adding a day
     to it: from the first סליחות to יום כיפור the shul opens earlier and on a different list,
     and that list is on the סליחות sheet. One line per schedule, and a line that only repeats
     the everyday שחרית dropped. */
  for (const g of slichosWeekLines(showing, settings)) {
    if (!differsFromSchedule(g.html, state.settings.weekdayShacharis)) continue;
    out.push({ label: g.name, html: g.html, days: `(${g.day})` });
  }
  for (const d of days.filter((x) => x.fast)) {
    out.push({ label: name(d), html: TZG_TEXT.morning, days: `(${d.day})` });
  }
  const rest = days.filter((x) => !x.fast);
  if (rest.length && state.settings.weekdayShacharisSpecial) {
    out.push({
      label: rest.map((d) => name(d)).join(' · '),
      html: state.settings.weekdayShacharisSpecial,
      days: `(${[...new Set(rest.map((d) => d.day))].join(', ')})`,
    });
  }
  return out;
}

/** The week's blocks, out of the chart's own cells. */
function sheetSections(showing, index, state, settings, withChol) {
  const { week, sheet } = index.get(showing);
  const out = [];

  if (sheet && SHEET_PLAN[sheet.season]) {
    const built = rowFor({ ...week, date: new Date(week.date) }, sheet, state, settings);
    // The season the row was built for, which past the spring clock change is קיץ even on a
    // חורף sheet: see rowFor. The order has to follow the columns it actually got.
    const { row, columns, season } = built;
    const plan = SHEET_PLAN[season] || SHEET_PLAN[sheet.season];
    const byKey = new Map(columns.map((c) => [c.key, c]));
    // הדלקת נרות is the first line of its cell and שקיעה the second, which is how
    // candleLightingCell writes it. Split rather than parsed: the second line is the word and
    // the time together, so the word comes off and the time is what is left.
    const [candles, shkiaLine] = String(row.H ?? '').split('\n');
    const one = (key) => {
      if (key === 'candles') return sheetRow(SHEET_TEXT.candles, candles);
      if (key === 'shkia') {
        return sheetRow(SHEET_TEXT.shkia, String(shkiaLine ?? '').replace(SHEET_TEXT.shkia, '').trim());
      }
      const col = byKey.get(key);
      if (!col) return '';
      const { label, sub } = nameAndBasis(col.header);
      return sheetRow(label, row[key], sub);
    };
    out.push([SHEET_TEXT.shabbos, plan.order.map(one)]);
  }

  // The weekday side of the week, the same three the חול card carries. Built from the
  // formulas and then overridden, exactly like the Shabbos row above.
  const weekday = withChol && weekdayChartFor(sheet, showing, state);
  const weekdayWeek = weekday && weekday.weeks.find((w) => w.serial === showing);
  if (weekdayWeek) {
    const { row: wdRow } = mergeRow(buildWeekdayRow(weekdayWeek, settings), weekday, showing);
    // Split: the block's lines are two schedules rather than one run cut to fit a column, so
    // every break the chart gave a cell is kept. See sheetCellHtml.
    const chol = (label, value, sub = '') => sheetRow(label, value, sub, { split: true });
    out.push([SHEET_TEXT.chol, [
      chol('שחרית', state.settings.weekdayShacharis),
      ...weekSpecialShacharis(showing, state, settings).map((s) => chol(s.label, s.html, s.days)),
      chol('מנחה', wdRow.C),
      chol('מעריב', wdRow.B),
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
export function weekSheetHtml(showing, index, state, settings, title, { withChol = true } = {}) {
  const sections = sheetSections(showing, index, state, settings, withChol);
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

/** Room left over before a size counts as fitting, in the sheet's own pixels.
 *
 *  A tenth of an inch at each end, which is why it is twice the yomim noraim sheet's own
 *  number: that sheet packs its columns from the top and this one centres what is left, so the
 *  margin is split between the head and the foot and half of it would be half an answer.
 *
 *  The reason for having one at all is the same. Every device lays a line of type out a little
 *  differently, and a sheet fitted to the last pixel here comes out a line over there. */
const WS_ROOM = 22;
const WS_MIN = 1;
const WS_MAX = 3.2;

/** The least air a row gets between it and the next one, as a share of its own line.
 *
 *  Reserved before the type is fitted rather than handed out afterwards, which is the whole
 *  point of it. Handed out afterwards it is whatever the last step of the fit happened to leave
 *  over, and a week that filled its page left nothing: measured, the sheet came out at --ws-gap
 *  0.18px, which is a set of rows sitting on each other's hairlines. Reserved first, the type
 *  takes a step down instead and the sheet is spaced.
 *
 *  The two numbers below are .onepage-row's own type, which is what --op-scale multiplies, and
 *  they have to agree with the two in app.css. Read out of the row rather than written here for
 *  a while: getComputedStyle gives the size the row is set to at the scale being tried, so the
 *  reserved gap changed under the fit and the loop could not settle. */
const WS_PT = 9.5 * (96 / 72);
const WS_LINE = 1.2;
const WS_LEAD = 0.34;
const leadFor = (scale) => WS_PT * scale * WS_LINE * WS_LEAD;

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
    /* A row whose times are too long for the sheet, which the column's own width cannot say.
     *
     * A run this sheet cannot break, `8:45&nbsp;/&nbsp;9:00`, is one word to the type: it does
     * not widen the column, it eats the row's side padding and then hangs over it. Measured on
     * the סוכות week, whose מעריב carries eleven times, that row began 5.8px left of every other
     * row, which is exactly the padding, and neither the column nor the row scrolled to say so.
     * Overflow to the start side of an RTL box is not what scrollWidth reports.
     *
     * Nor does anything inside the row: the times are a flex item, so they are given their own
     * narrowest width and the row is what overflows. So it is the row that is measured, and the
     * question asked of it is whether the times still begin inside its padding. */
    const times = [...col.querySelectorAll('.onepage-times')];
    const spills = () => {
      // The padding, less the pixel of rounding a flex layout is allowed. Times the zoom
      // because the rects are in the screen's pixels: if the padding read back is already
      // zoomed the guard only gets smaller, which is the safe way round.
      const guard = (parseFloat(getComputedStyle(rows[0]).paddingLeft) || 0) * zoom() - 1;
      return times.some((t) => {
        const row = t.closest('.onepage-row').getBoundingClientRect();
        return t.getBoundingClientRect().left - row.left < guard;
      });
    };

    // Fitted with the rows already carrying their reserved lead, so the type is chosen against
    // a spaced sheet rather than a solid one. Anything over and above the lead is given to them
    // afterwards, so it cannot be counted twice.
    const fits = (scale) => {
      sheet.style.setProperty('--ws-gap', `${leadFor(scale).toFixed(2)}px`);
      sheet.style.setProperty('--op-scale', scale.toFixed(2));
      const z = zoom();
      const box = cols.getBoundingClientRect();
      const tall = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / z;
      return tall <= box.height / z - WS_ROOM && cols.scrollWidth <= cols.clientWidth + 1
        && !spills();
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
    const lead = leadFor(best);
    sheet.style.setProperty('--op-scale', best.toFixed(2));
    sheet.style.setProperty('--ws-gap', `${lead.toFixed(2)}px`);

    /* Then the room that is left goes to the rows, so the sheet is spaced out rather than set
     * solid with the remainder banked at the foot.
     *
     * The type can only be grown in steps, and it stops at the last step that fits, so there
     * is always something left: measured across the season, between 11 and 73px of an eleven
     * inch page. Spread through the rows it disappears; left where it was it read as a sheet
     * that had stopped early.
     *
     * Capped at nine tenths of a row's own height, which is what a week with little on it
     * needs: a Yom Tov week is three rows and its share of the leftover would be an inch and
     * a half a row, a table with holes in it rather than a spaced one. Whatever the cap
     * leaves over is taken up by the column centring itself. */
    const z = zoom();
    const room = cols.getBoundingClientRect().height / z;
    const used = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / z;
    const spare = Math.max(0, room - WS_ROOM - used);
    const rowHeight = used / rows.length;
    sheet.style.setProperty('--ws-gap',
      `${(lead + Math.min(spare / rows.length, rowHeight * 0.9)).toFixed(2)}px`);
    col.style.justifyContent = '';
  }
}
