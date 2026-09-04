// Posters: the sheets the shul hangs that are not the zmanim board.
//
// Two so far, שבת שובה and סליחות, and the tab is shaped for the others to follow rather
// than built around either: pick a poster, pick what it should be built from, and Print
// sends what is on the screen. Announcements and the Yom Tov schedules land here next.
//
// Both are chosen the same way, by the year of the ר"ה they belong to, because that is the
// year written on the sheet that gets hung. Where a poster's times come from is this file's
// problem, not the user's: סליחות works them out from the calendar, and שבת שובה goes and
// finds the chart that covers it. A chart is named for the season it starts in and a קיץ
// season runs through to Sukkos of the year after, so קיץ 5786 is the chart holding שבת
// שובה 5787. Asking "which chart" would have made that everybody's problem.
//
// A poster is a real 8.5in by 11in page in the document, the same way a chart page is, so
// what is on the screen is what comes out of the printer and there is no second layout to
// keep in step. See .poster in app.css and the @page rule in print.css.
import { resolveSettings } from '../settings.js';
import { buildShuvaPoster, buildShuvaFromCalendar, shuvaWeekOf, shuvaSheetsFor, shabbosShuvaSerial, SHUVA_TEXT } from '../posters/shuva.js';
import { buildSlichosPoster, parseTimes, SLICHOS_TEXT } from '../posters/slichos.js';
import { buildRoshHashanaPoster, RH_TEXT } from '../posters/roshhashana.js';
import { buildYomKippurPoster, buildAfterYomKippurPoster, YK_TEXT } from '../posters/yomkippur.js';
import { buildTzomGedaliaPoster, TZG_TEXT } from '../posters/tzomgedalia.js';
import { buildPairPoster, buildSlichosTzomPoster } from '../posters/pair.js';
import { hebrewDateExtended, hebrewYear, roshHashana, jewishDateString, excelWeekday } from '../hebrew-calendar.js';
import { excelSerial, dateFromSerial } from '../zmanim/solar.js';
import { printButtonHtml, wirePrintButton, setPrintPage } from './print-page.js';
import { fontStackFor } from './sheet-view.js';
import { hebrewLang, DAY_NAMES, SLASH, escAttr } from '../util.js';
import { switchHtml, wireSwitch } from './switch.js';

/** Times New Roman, the face the Word posters the shul already hangs were set in. Fixed
 *  rather than taken from the sheet style: a poster is its own document and does not
 *  change when somebody picks a different font for the board. fontStackFor() adds the
 *  shipped stand-in behind it, so an Android phone with no Times New Roman still gets a
 *  serif Hebrew rather than falling back to a sans. */
const POSTER_FONT = 'Times New Roman';

/** The next yomim noraim, as a Hebrew year.
 *
 *  Both posters are for one ר"ה and the days around it, so that is what they are chosen by.
 *  The year number turns over at ר"ה, so "this year" stops being the useful answer the
 *  moment יו"כ is past: in אלול 5786 the calendar still says 5786, but the סליחות a week
 *  away are for ר"ה 5787. This asks the question the poster asks, which yomim noraim are
 *  still ahead, and rolls over the day after יו"כ. */
export function nextYomimNoraim(today = new Date()) {
  const serial = excelSerial(today);
  const year = hebrewDateExtended(serial).year;
  const yomKippur = (y) => roshHashana(y - 3761) + 9; // 10 תשרי
  return serial > yomKippur(year) ? year + 1 : year;
}

/** How far either side of the yomim noraim coming up the Year picker reaches.
 *
 *  Back far enough to reprint a sheet the shul already hung, forward far enough that nothing
 *  has to wait for the calendar to turn over. Nothing here is looked up in a table, so a year
 *  costs nothing until it is picked: every date is worked out from the calendar and every time
 *  from the sun. The only poster that needs anything saved is שבת שובה, which reads a chart,
 *  and it says so on its own when there is none.
 *
 *  Ten years rather than everything, because it is a list somebody reads. */
const YEARS_BACK = 2;
const YEARS_AHEAD = 7;

/** The years to offer, and which one to open on.
 *
 *  The one coming up with a few either side of it, plus any year a generated chart covers the
 *  שבת שובה of, which is not the year written on that chart (see shuvaSheetsFor). */
function posterYears(state) {
  const next = nextYomimNoraim();
  const years = new Set();
  for (let y = next - YEARS_BACK; y <= next + YEARS_AHEAD; y++) years.add(y);
  for (const sheet of state.sheets) {
    const week = shuvaWeekOf(sheet);
    if (!week) continue;
    // the year that ר"ה opened days before this שבת שובה
    const y = hebrewDateExtended(excelSerial(new Date(week.date))).year;
    years.add(y);
  }
  return { years: [...years].sort((a, b) => a - b), preferred: next };
}

/** A date the two ways somebody reads it. The Hebrew one comes from jewishDateString, the
 *  same call the charts print their dates with, so a poster and a board never disagree
 *  about what day something is. */
const heDate = (serial) => jewishDateString(serial, false);
/** The day name comes from DAY_NAMES rather than the locale, which would say Saturday.
 *  No locale has Shabbos in it, and there is no reason to call it Saturday on a shul's own
 *  page: same reasoning, and the same list, as the week cards' fmtShabbosDate.
 *
 *  timeZone: 'UTC' is not optional. dateFromSerial builds a Date at UTC midnight, so
 *  formatting it in the reader's own zone moves it back a day anywhere west of Greenwich:
 *  in Lakewood this printed "Shabbos, September 18" for a date that is a Friday, because
 *  the day name comes from the serial and only the numbers had moved. Every other date
 *  formatter in the app passes it for the same reason. */
const enDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const enDate = (serial) => `${DAY_NAMES[excelWeekday(serial) - 1]}, ${enDateFmt.format(dateFromSerial(serial))}`;

/** The dates a poster covers, said in full above it. Not on the sheet itself, which the
 *  shul wants clean, but on the screen it is chosen from, where the whole question is
 *  whether this is the right year. A span reads "from עד to" in Hebrew and "from to to" in
 *  English rather than with a dash, so nothing has to be resolved bidirectionally. */
function when(from, to) {
  return to && to !== from
    ? { he: `${heDate(from)} עד ${heDate(to)}`, en: `${enDate(from)} to ${enDate(to)}` }
    : { he: heDate(from), en: enDate(from) };
}

/** "תשפ״ז · ר"ה 12 Sep 2026". The Hebrew year on its own is what caused the confusion, so
 *  the date ר"ה actually falls on rides along and there is nothing left to work out. */
const yearFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
function yearLabel(y) {
  return `${hebrewYear(y)} · ר"ה ${yearFmt.format(dateFromSerial(roshHashana(y - 3761)))}`;
}

/** The posters this tab knows how to draw. One entry per poster: what to call it, what it
 *  can be built from, and how to draw it. A source is one option in the picker, carrying
 *  its own build() so this table is the only place that knows what a given poster needs. */
const POSTERS = [
  {
    key: 'slichos',
    label: 'סליחות',
    covers: (y) => `סליחות through ערב יו"כ ${hebrewYear(y)}`,
    // First סליחות morning through ערב יו"כ, the last line on the sheet.
    when: (built) => when(built.span.from, built.span.to),
    starts: (y) => buildSlichosPoster(y)?.span.from ?? null,
    sources: (state) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildSlichosPoster(y) }),
      }));
    },
    render: renderSlichosPoster,
  },
  {
    key: 'slichostzom',
    label: 'סליחות וצום גדליה על דף אחד',
    // Two sheets on one page. The run can be asked to leave these out, since somebody
    // printing the lot usually wants one occasion a sheet.
    combined: true,
    covers: (y) => `${SLICHOS_TEXT.title} ${TZG_TEXT.title} ${hebrewYear(y)}`,
    when: (built) => when(built.span.from, built.span.to),
    orientations: true,
    starts: (y, settings) => buildSlichosTzomPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildSlichosTzomPoster(y, settings) }),
      }));
    },
    render: renderSlichosTzomPoster,
  },
  {
    key: 'roshhashana',
    label: 'ראש השנה',
    covers: (y) => `${RH_TEXT.title} ${hebrewYear(y)}`,
    // ערב ר"ה through the second day, which is every date on the sheet.
    when: (built) => when(built.span.from, built.span.to),
    starts: (y, settings) => buildRoshHashanaPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildRoshHashanaPoster(y, settings) }),
      }));
    },
    render: renderRoshHashanaPoster,
  },
  {
    key: 'pair',
    label: 'ראש השנה ויום כיפור על דף אחד',
    combined: true,
    covers: (y) => `${RH_TEXT.title} ${YK_TEXT.title} ${hebrewYear(y)}`,
    when: (built) => when(built.span.from, built.span.to),
    // The one sheet that can be set either way up, so the tab shows an orientation picker
    // for it and hands the choice to the renderer.
    orientations: true,
    starts: (y, settings) => buildPairPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildPairPoster(y, settings) }),
      }));
    },
    render: renderPairPoster,
  },
  {
    key: 'tzomgedalia',
    label: 'צום גדליה',
    covers: (y) => `${TZG_TEXT.title} ${hebrewYear(y)}`,
    // One day, so the two ends of the span are the same date.
    when: (built) => when(built.span.from, built.span.to),
    starts: (y, settings) => buildTzomGedaliaPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildTzomGedaliaPoster(y, settings) }),
      }));
    },
    render: renderTzomGedaliaPoster,
  },
  {
    key: 'shuva',
    label: 'שבת שובה דרשה',
    covers: (y) => `שבת שובה ${hebrewYear(y)}`,
    // The one Shabbos it is about, read off the week the chart handed back.
    when: (built) => when(excelSerial(new Date(built.week.date))),
    // From the calendar rather than from that week, because the order has to hold for a year
    // with no chart saved, where this poster cannot be built at all. Measured against the
    // charts that are saved: the same date either way.
    starts: (y) => shabbosShuvaSerial(y),
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => buildShuvaFor(state, settings, y),
      }));
    },
    render: renderShuvaPoster,
  },
  {
    key: 'yomkippur',
    label: 'יום כיפור',
    covers: (y) => `${YK_TEXT.title} ${hebrewYear(y)}`,
    when: (built) => when(built.span.from, built.span.to),
    starts: (y, settings) => buildYomKippurPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildYomKippurPoster(y, settings) }),
      }));
    },
    render: renderYomKippurPoster,
  },
  {
    key: 'afteryk',
    label: 'Starting after יום כיפור',
    covers: (y) => `${YK_TEXT.afterHeading} ${hebrewYear(y)}`,
    when: (built) => when(built.span.from, built.span.to),
    starts: (y, settings) => buildAfterYomKippurPoster(y, settings)?.span.from ?? null,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => ({ poster: buildAfterYomKippurPoster(y, settings) }),
      }));
    },
    render: renderAfterYomKippurPoster,
  },
  // Last in the list whatever the dates say, because it is a way of looking at the others
  // rather than a poster with a date of its own.
  {
    key: 'all',
    label: 'All of them',
    covers: (y) => `Every poster for ${hebrewYear(y)}`,
    when: (built) => when(built.span.from, built.span.to),
    last: true,
    // Two ways of being given all of it, and the switch in the bar picks between them: the
    // eight sheets one after another, which is what goes on the wall, or the whole season
    // set small on one sheet. The other two controls belong to the run alone, so they come
    // off the bar when the one-page sheet is showing.
    onepage: true,
    // The Page picker works here too, and a landscape sheet in a run is turned on its side
    // rather than left out. Chrome puts one page size on a whole PDF, so a run genuinely
    // cannot mix the two: set landscape and printed straight, those 11in sheets went onto
    // 8.5in pages and were cut. An 11in by 8.5in sheet rotated a quarter turn is 8.5in by
    // 11in, which is the page the rest of the run is on, so it fits whole and is read by
    // turning the paper.
    orientations: true,
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        // The one-page sheet takes one occasion a sheet: it lays the schedules out itself,
        // so a sheet carrying two of them would put those two on it twice.
        build: () => buildEveryPoster(state, settings, y, { combined: chosenSheets === 'all' ? false : chosenCombined }),
      }));
    },
    render: (built, settings, opts) => (chosenSheets === 'all'
      ? renderOnePagePoster(built, settings)
      : renderAllPosters(built, settings, opts)),
  },
];

/** The posters in the order the days actually come, which is the order the picker lists them
 *  and the order the run prints them.
 *
 *  Worked out per year rather than written down once, because two of them change places. ר"ה
 *  can open on a Monday, Tuesday, Thursday or Shabbos; on a Thursday, 3 תשרי is Shabbos, so
 *  שבת שובה is that day and צום גדליה is put off to the Sunday behind it. Every other year the
 *  fast comes first.
 *
 *  Each date is asked of the poster itself, so the order cannot drift from what the sheets
 *  say. Two of them start on the same day as the sheet they are half of, and a stable sort
 *  leaves those in the order the table above is written: the single sheet, then the pair.
 *
 *  A poster that cannot say when it starts keeps its place in the table rather than being
 *  dropped or thrown to the end. */
function postersByDate(year, settings) {
  const at = new Map();
  POSTERS.forEach((p, i) => {
    let from = null;
    try { from = p.last ? null : p.starts?.(year, settings) ?? null; } catch { from = null; }
    at.set(p, { from, i, last: Boolean(p.last) });
  });
  return [...POSTERS].sort((a, b) => {
    const x = at.get(a);
    const y2 = at.get(b);
    if (x.last !== y2.last) return x.last ? 1 : -1;
    if (x.from != null && y2.from != null && x.from !== y2.from) return x.from - y2.from;
    return x.i - y2.i;
  });
}

/** The occasions the picker offers, in the order of the year.
 *
 *  Written out rather than gathered from the sheets that exist, because the picker is meant
 *  to show the whole year from the start: an occasion with nothing behind it yet still has a
 *  place in the list, and says so when it is chosen, rather than turning up the week its
 *  sheets are finished. That way the list is the shul's year and not a report on what has
 *  been built.
 *
 *  Adding sheets to one of them is the whole of filling it in: a poster carries
 *  `group: 'סוכות'`, its name here already has the place, and the posters under it sort by
 *  date like everything else. A poster whose group is not in this table still shows, after
 *  these, so a name typed one way in a poster and another way here cannot lose the sheet. */
const POSTER_OCCASIONS = [
  'ראש השנה יום כיפור',
  'סוכות',
  'חנוכה',
  'עשרה בטבת',
  'פורים',
  'פסח',
  'שבועות',
  'שבעה עשר בתמוז',
  'תשעה באב',
];

/** Which heading a poster sits under when it does not name one. Every sheet so far belongs
 *  to the first occasion, so that is the default and no entry above has to say it. */
const POSTER_GROUP_DEFAULT = POSTER_OCCASIONS[0];

/** The posters cut into those headings, both in date order.
 *
 *  A group takes its place from its earliest sheet, which a Map gives for nothing: the list
 *  handed in is already in date order, so the order the names are first seen is the order the
 *  days come. All of them belongs to no yom tov and sits on its own at the end, outside any
 *  heading, which is where a group of one would look like a mistake. */
function posterGroups(year, settings) {
  const byName = new Map();
  const loose = [];
  for (const p of postersByDate(year, settings)) {
    if (p.last) { loose.push(p); continue; }
    const name = p.group || POSTER_GROUP_DEFAULT;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(p);
  }
  return [
    ...[...byName].map(([name, items]) => ({ name, items })),
    ...loose.map((p) => ({ name: null, items: [p] })),
  ];
}

/** Every poster for one year, in the order the picker lists them.
 *
 *  Each is built by its own entry's own source, so this knows nothing about what any of them
 *  needs: it asks the table. One that cannot be built for a year is left out rather than
 *  breaking the run, and the ones that were left out are named under the sheets so it is not
 *  a silent gap. Nothing is left out as things stand: שבת שובה used to be, in a year with no
 *  chart saved, and it now works that week out from the calendar instead.
 *
 *  A שבת שובה built from two charts that disagree takes the first, since this view has no
 *  one poster to hang the "which chart" picker off. Choosing the poster on its own still
 *  offers the choice. */
function buildEveryPoster(state, settings, year, { combined = true } = {}) {
  const items = [];
  const missing = [];
  const left = [];
  for (const p of postersByDate(year, settings)) {
    if (p.last) continue;
    // The two-on-a-page sheets, left out when the run is asked for one occasion a sheet.
    // Named under the run rather than silently dropped, the same as one that would not
    // build, so it is clear they were a choice and not a gap.
    if (!combined && p.combined) { left.push(p.label); continue; }
    const source = p.sources(state, settings).find((s) => s.year === year);
    let result = null;
    try {
      result = source ? source.build() : null;
    } catch {
      result = null;
    }
    if (result && result.poster) {
      items.push({
        key: p.key, label: p.label, poster: result.poster, render: p.render,
        // Whether this one reads the Page picker, which is what decides if it has to be
        // turned on its side to sit in the run.
        orientations: Boolean(p.orientations),
      });
    }
    else missing.push(p.label);
  }
  if (!items.length) return { missing: 'Nothing to build for this year.' };
  const spans = items.map((i) => i.poster.span).filter(Boolean);
  return {
    poster: {
      hebrewYear: year,
      items,
      notBuilt: missing,
      leftOut: left,
      span: spans.length
        ? { from: Math.min(...spans.map((s) => s.from)), to: Math.max(...spans.map((s) => s.to)) }
        : { from: roshHashana(year - 3761), to: roshHashana(year - 3761) },
    },
  };
}

/** Every sheet stacked down the page, each drawn by its own renderer.
 *
 *  Nothing is redrawn for this view: an item is the poster's own markup, so what is in the
 *  run is what comes out when that poster is picked on its own. The name above each is
 *  no-print, so paper gets the sheets and nothing else. */
function renderAllPosters(built, settings, { landscape = false } = {}) {
  // A sheet set landscape is turned a quarter turn and sat on a portrait page, since a run
  // can only be one page size. The turning is .is-sideways in app.css: the wrapper is the
  // portrait page and the sheet inside it is taken out of the flow and rotated, so its 11in
  // width cannot push the page wider.
  const sideways = landscape;
  return `<div class="poster-all">
    ${built.items.map((it) => {
      const turned = sideways && it.orientations;
      return `<div class="poster-all-item${turned ? ' is-sideways' : ''}">
        <p class="poster-all-name no-print">${escAttr(it.label)}${turned ? ' (turned on its side)' : ''}</p>
        ${it.render(it.poster, settings, { landscape: turned })}
      </div>`;
    }).join('')}
    ${built.notBuilt.length
      ? `<p class="hint no-print">Not in this run, nothing to build them from this year: ${escAttr(built.notBuilt.join(', '))}</p>`
      : ''}
    ${(built.leftOut || []).length
      ? `<p class="hint no-print">Left out, one occasion a sheet: ${escAttr(built.leftOut.join(', '))}</p>`
      : ''}
    ${(built.leftOut || []).length ? '' : `<p class="hint no-print">${sideways
      ? 'The two sheets that carry two schedules are on their side here, because one print run can only be one size of paper. They come out whole on the same paper as the rest; turn the sheet to read them.'
      : 'Set Paper to Landscape to have the two sheets that carry two schedules come out that way, turned on their side so they still fit the run.'}</p>`}
  </div>`;
}

/** The sheets that are current on one day, in date order, drawn and ready to show.
 *
 *  This is what the congregation's own site puts behind Special Schedules. Current means the
 *  window the shul wants a sheet seen in: from `lead` days before the first date on it,
 *  through the end of the last. A sheet is up on the wall before the days it covers and
 *  comes down when they are over, and this is the same thing on a phone.
 *
 *  The two-on-a-page sheets are left out. They exist to save a wall a second sheet of paper,
 *  and on a screen they are two schedules to read at once where one would do.
 *
 *  Only two years are looked at. A sheet's dates all sit within a fortnight of ר"ה, and
 *  nextYomimNoraim rolls over the day after יו"כ, so the year it names covers everything
 *  still ahead and the year before it covers the one sheet that runs past יו"כ.
 *
 *  No calendar tables are passed in, so שבת שובה comes off the published chart or not at
 *  all. That is the right way round here rather than a shortcut: the chart is what the board
 *  says, hand edits and all, and the congregation should be reading the same times as the
 *  sheet on the wall. */
export function currentPosters(state, settings, { on = excelSerial(new Date()), lead = 5 } = {}) {
  const next = nextYomimNoraim();
  const out = [];
  for (const year of [next - 1, next]) {
    // Nowhere near, so do not build a thing. This is asked on the congregation's menu, which
    // is the page every visitor lands on, and building six sheets to find out that none of
    // them is up cost 120ms on a slow phone. Every date on every sheet sits inside a
    // fortnight either side of ר"ה, and the widest window is the סליחות sheet's, which opens
    // eleven days before it, so a month and a half back and three weeks on is far wider than
    // any of them can reach. The dates come from the calendar, which costs nothing.
    const rh = roshHashana(year - 3761);
    if (on < rh - 45 || on > rh + 20) continue;
    for (const p of postersByDate(year, settings)) {
      if (p.last || p.combined) continue;
      const source = p.sources(state, settings).find((s) => s.year === year);
      if (!source) continue;
      let built = null;
      try { built = source.build()?.poster || null; } catch { built = null; }
      if (!built?.span) continue;
      const { from, to } = built.span;
      if (on < from - lead || on > to) continue;
      out.push({
        key: p.key,
        year,
        label: p.label,
        span: built.span,
        when: p.when(built),
        html: p.render(built, settings),
      });
    }
  }
  return out.sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
}

/** One saved chart, named so it can be told from another of the same season and year.
 *  Which is the whole reason this is ever shown: the two only differ by when they were
 *  generated and by what has been typed over since. */
function chartLabel(sheet) {
  const made = sheet.createdAt
    ? new Date(sheet.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return `${sheet.season} ${sheet.hebrewYear}${made ? `, generated ${made}` : ''}`;
}

/** The שבת שובה poster for a year, found rather than chosen.
 *
 *  Off a chart where there is one, because a chart can carry a hand edit to that מנחה cell
 *  and the poster on the wall must say what the board says. Which chart is a question with an
 *  answer, so it is not put to the user: shuvaSheetsFor finds every generated chart covering
 *  that שבת שובה, and one of them is normally the only one. Two are only worth asking about
 *  if they actually say different things, so they are built and compared and the picker only
 *  appears when they genuinely disagree.
 *
 *  Off the calendar where there is none. The chart was never the source of the times, only of
 *  the edits: see buildShuvaFromCalendar. */
function buildShuvaFor(state, settings, hebrewYearNum) {
  const sheets = shuvaSheetsFor(state.sheets, hebrewYearNum);
  const built = sheets.map((s) => ({ sheet: s, poster: buildShuvaPoster(s, state, settings) }))
    .filter((b) => b.poster);
  if (!built.length) {
    // No chart for this year, so work the week out from the calendar instead. Same rowFor and
    // so the same Settings and the same rules; what is not there to be had is a hand edit to
    // that one cell, which is why a chart is used wherever there is one.
    const poster = buildShuvaFromCalendar(hebrewYearNum, state, settings, posterTables);
    if (poster) return { poster };
    return { missing: `No generated chart covers שבת שובה ${hebrewYear(hebrewYearNum)}, and the Hebrew calendar tables have not loaded to work it out without one.` };
  }
  const signature = (p) => JSON.stringify([p.drasha, p.mincha]);
  const agree = built.every((b) => signature(b.poster) === signature(built[0].poster));
  if (agree) return { poster: built[0].poster };
  const pick = built[conflictPick] || built[0];
  return { poster: pick.poster, conflict: built };
}


/** One time as the boards write it: plain is the main בית מדרש, underlined is למטה, a
 *  trailing * is בעזרת נשים and ** is באולם השמחות. The same marks as the chart, so
 *  somebody holding a poster and a board is reading one system. */
function timeHtml(t) {
  const body = t.underlined ? `<u>${escAttr(t.text)}</u>` : escAttr(t.text);
  return `${body}${escAttr(t.mark || '')}`;
}

/** The page every poster is drawn on: the letterhead, the rabbi's line under it, whatever
 *  the poster itself puts in the middle, and the key to the marks at the foot.
 *
 *  Shared so the two posters cannot drift apart on the parts that are the shul rather than
 *  the occasion. */
function posterShell(settings, body, legend = [], { dense = false, pair = false, landscape = false, chartHead = false, onepage = false } = {}) {
  const rabbi = String(settings.headerRabbiLine || '').split('\n').filter(Boolean);
  const cls = `poster${dense ? ' is-dense' : ''}${pair ? ' is-pair' : ''}`
    + `${landscape ? ' is-landscape' : ''}${chartHead ? ' is-chart-head' : ''}`
    + `${onepage ? ' is-onepage' : ''}`;
  const wordmark = `<img class="poster-wordmark" src="/assets/logo-text.png"
         alt="${escAttr(settings.shulName)}"${hebrewLang(settings.shulName)} width="1776" height="237">
    <div class="poster-subtitle"${hebrewLang(settings.headerSubtitle)}>${escAttr(settings.headerSubtitle)}</div>`;
  const rabbiBlock = `<div class="poster-rabbi">${rabbi.map((l) => `<div${hebrewLang(l)}>${escAttr(l)}</div>`).join('')}</div>`;
  // Two headers. The single sheets stack theirs: wordmark, rule, then the rabbi's line under
  // it against the right margin, which is how the Word posters are built.
  //
  // The sheets carrying two schedules use the wall charts' header instead: one row, with the
  // wordmark in the middle and the rabbi's line beside it rather than under it. It is
  // shorter, and on those sheets every tenth of an inch of header is a tenth the two columns
  // do not get.
  const head = chartHead
    // The wall chart's header, copied: the same markup and the same classes, so the two are
    // one thing rather than a likeness of one that drifts. Where a chart puts the building,
    // this leaves the corner empty: it held the year for a while and the year came off. No
    // rule under it either, because a chart does not have one.
    ? `<div class="page-header" dir="ltr">
         <div class="header-row">
           <div class="header-year" aria-hidden="true"></div>
           <div class="header-center">
             <img class="header-logo" src="/assets/logo-text.png"
                  alt="${escAttr(settings.shulName)}"${hebrewLang(settings.shulName)}>
             <div class="header-subtitle"${hebrewLang(settings.headerSubtitle)}>${escAttr(settings.headerSubtitle)}</div>
           </div>
           <div class="header-rabbi">${rabbi.map((l) => `<div${hebrewLang(l)}>${escAttr(l)}</div>`).join('')}</div>
         </div>
       </div>`
    : `${wordmark}
    <img class="poster-rule" src="/assets/poster-rule.png" alt="" width="1897" height="85">
    ${rabbiBlock}`;
  return `<div class="${cls}" dir="rtl" style="--poster-font-family: ${escAttr(fontStackFor(POSTER_FONT))}">
    ${head}
    ${body}
    ${legend.length
      ? `<div class="poster-legend">${legend
          .map((l) => `<div dir="${l.dir}"${hebrewLang(l.text)}>${escAttr(l.text)}</div>`).join('')}</div>`
      : ''}
  </div>`;
}

function renderShuvaPoster(poster, settings) {
  const body = `
    <h2 class="poster-title" lang="he">${escAttr(SHUVA_TEXT.title)}</h2>
    ${SHUVA_TEXT.lines.map((l) => `<p class="poster-line" lang="he">${escAttr(l)}</p>`).join('')}
    ${poster.drasha ? `<p class="poster-at" lang="he">${escAttr(SHUVA_TEXT.at)} <bdi>${escAttr(poster.drasha)}</bdi></p>` : ''}
    <p class="poster-mincha" lang="he"><span class="poster-row-label">${escAttr(SHUVA_TEXT.minchaLabel)}</span>
      <bdi>${poster.mincha.map(timeHtml).join(', ')}</bdi></p>`;
  return posterShell(settings, body, poster.legend);
}

/** The סליחות sheet: one line per part of the yomim noraim, each a label and its מנינים.
 *
 *  The times run left to right inside a right-to-left line, so each list is its own <bdi>.
 *  So is the note in brackets, which is Hebrew with a time inside it: without the isolate
 *  the bracket and the time swap ends. Measured rather than reasoned about, the same as
 *  every other bidi decision in this project. */
/** The סליחות schedule on its own, so the sheet that pairs it with צום גדליה can call it
 *  too and the two cannot drift. */
function slichosBody(poster) {
  const rows = poster.rows.map((r) => {
    // The note is set against the first time, not at the end of the row, because that is
    // the time it is about: it names the days the 6:40 is a 6:35. Written last it was the
    // last thing in the line, which looked right until a half width column wrapped the row
    // and left it on a line of its own with no label beside it, nearer the row underneath
    // than the one it belongs to.
    //
    // dir="ltr" on the times, said out loud rather than left to a bdi's dir="auto". The
    // times are digits, which are not strong characters, so auto was picking LTR by default;
    // with Hebrew now inside the run, the first strong character is the note's and auto would
    // turn the whole list around. Measured after the change, not assumed.
    const parts = r.times.map(timeHtml);
    const note = r.note ? `<bdi class="poster-row-note">${escAttr(r.note)}</bdi>` : '';
    // On the left of the first time, which is the side it has always been on: it says that
    // מנין runs five minutes earlier on the days it names, so it belongs against that time
    // and not against the row's last one.
    //
    // At the end of the row it landed there by accident rather than by arrangement. The row
    // is right to left and the times inside it read left to right, so the first time sits at
    // the far left and anything written after the times ends up just left of it. That held
    // until a half width column wrapped the row, and then the note went to the foot of the
    // row instead, on a line with no label, nearer the row underneath than its own. Written
    // in front of the times it is beside the first one whether the row wraps or not.
    const inner = note ? `${note} ${parts.join(', ')}` : parts.join(', ');
    return `
    <p class="poster-row" lang="he">
      <span class="poster-row-label">${escAttr(r.label)}</span>
      <bdi class="poster-row-times" dir="ltr">${inner}</bdi>
    </p>`;
  }).join('');
  return `<h2 class="poster-title" lang="he">${escAttr(SLICHOS_TEXT.title)}</h2>
    <div class="poster-rows">${rows}</div>`;
}

function renderSlichosPoster(poster, settings) {
  return posterShell(settings, slichosBody(poster), poster.legend);
}

/** The ראש השנה sheet: the ערב ר"ה lines, then a block per day.
 *
 *  Same row shape as the סליחות sheet, so the two read alike and share their spacing. A row
 *  with no times is a line of its own (the דרשה announcements), and `extra` carries the
 *  second label-and-time pair that sits on the שחרית line. */
function rhRow(label, times, extra, sub, sep = SLASH) {
  // Slash separated, which is how this sheet writes a pair: "9:47 / 9:11" reads as the two
  // reckonings its label just named. The סליחות sheet uses commas, because its times are a
  // list of מנינים rather than one זמן given two ways.
  //
  // SLASH is the charts' own separator, a slash with a non breaking space each side. A bare
  // slash sets the two times hard against it and they read as one number.
  const t = times.length
    ? `<bdi class="poster-row-times">${times.map(timeHtml).join(sep)}</bdi>` : '';
  const e = extra
    ? `<span class="poster-row-label poster-row-second">${escAttr(extra.label)}</span>`
      + `<bdi class="poster-row-times">${extra.times.map(timeHtml).join(SLASH)}</bdi>`
    : '';
  // `sub` names the reckonings a זמן is given on, as ס"ז ק"ש is given on מ"א and גר"א. It
  // wears the label class as well, so it is held off the name in front of it and off the
  // times after it by the same gap every other row uses.
  const b = sub ? `<span class="poster-row-label">${escAttr(sub)}</span>` : '';
  return `<p class="poster-row" lang="he"><span class="poster-row-label">${escAttr(label)}</span>${b}${t}${e}</p>`;
}

/** The ראש השנה schedule itself, title and all, without the page around it. Split out so the
 *  sheet that carries both schedules can call it too and the two cannot drift. */
function rhBody(poster, { year = true } = {}) {
  const typed = (str) => parseTimes(str);
  return `
    <h2 class="poster-title" lang="he">${escAttr(RH_TEXT.title)}${year ? ' ' + escAttr(hebrewYear(poster.hebrewYear)) : ''}</h2>
    <div class="poster-rows is-dense">
      ${rhRow(RH_TEXT.slichos.label, typed(RH_TEXT.slichos.times))}
      ${rhRow(RH_TEXT.chatzos, [{ text: poster.chatzos, underlined: false, mark: '' }])}
      ${rhRow(RH_TEXT.erevMincha.label, typed(RH_TEXT.erevMincha.times))}
      ${poster.blocks.map((b) => `
        <h3 class="poster-day" lang="he">${escAttr(b.heading)}</h3>
        ${b.lines.map((ln) => rhRow(ln.label, ln.times, ln.extra, ln.sub)).join('')}`).join('')}
    </div>`;
}

function renderRoshHashanaPoster(poster, settings) {
  return posterShell(settings, rhBody(poster), poster.legend || [], { dense: true });
}

/** The יום כיפור sheet: ערב יו"כ, the day, the morning after, and the box of everyday times
 *  that runs from then until סוכות. Same rows as the ראש השנה sheet, so the two read alike.
 *
 *  The box is a rule around three lines, the way it is on the sheets the shul hangs. Its
 *  מעריב list is ten times long, so the times are allowed to wrap inside it rather than
 *  being forced onto one line and squeezing the rest of the sheet. */
/** The box of everyday times that runs from after יו"כ until סוכות.
 *
 *  Its own function because it does not always sit in the same place: at the foot of the
 *  יום כיפור column on that sheet, and across the width of the sheet that carries both
 *  schedules. Same three lines either way. */
function ykAfterBox(poster) {
  // One span per time, and the commas between them come from CSS rather than from here.
  // That is what lets balanceBoxRows below cut a run in two by moving spans: the separators
  // work themselves out again around the break, where a comma written into the markup would
  // be left stranded at the end of the first line.
  const boxRow = (label, times) => `<p class="poster-row poster-box-row" lang="he">`
    + `<span class="poster-row-label">${escAttr(label)}</span>`
    + `<bdi class="poster-row-times">`
    + times.map((t) => `<span class="poster-t">${timeHtml(t)}</span>`).join('')
    + `</bdi></p>`;
  return `<div class="poster-box">
        <h3 class="poster-box-head" dir="ltr">${escAttr(YK_TEXT.afterHeading)}</h3>
        ${boxRow(YK_TEXT.after.shacharis, poster.after.shacharis)}
        ${boxRow(YK_TEXT.after.mincha, poster.after.mincha)}
        ${boxRow(YK_TEXT.after.maariv, poster.after.maariv)}
      </div>`;
}

/** Cuts a run of times in the box into two even lines, the shorter one on top, wherever the
 *  run does not fit on one.
 *
 *  Only the narrow sheet needs it: on the portrait pair the box has half a page to work in
 *  and eleven מעריב times will not sit on one line. Left to the browser that wraps, and a
 *  wrap fills the first line and drops whatever is left over, so it came out seven and four
 *  with the remainder hanging under a full line. Halved it reads as one list on two lines.
 *
 *  Measured rather than assumed, so a row is only cut when it is actually too long: שחרית is
 *  six times and fits, and cutting it too would have cost the sheet 19px of the clearance the
 *  key needs at the foot. Which rows wrap is a question about the box's width and the year's
 *  times together, so it is asked of the browser after the sheet is on the page.
 *
 *  Reading the run first and moving afterwards, because the box is sized to its widest line:
 *  cutting one row narrows the box under the row being measured next. */
function balanceBoxRows(container) {
  // Whether the run got a second line, asked of layout rather than of paint. offsetTop is
  // measured before any transform; getClientRects is measured after, and in the run of every
  // poster a landscape sheet is turned a quarter turn, which stands the line up on its end
  // and gives every time on it a different top. That read as eleven wrapped lines and cut a
  // row that was sitting comfortably on one.
  const wrapped = (times) => times.length > 1 && times[times.length - 1].offsetTop > times[0].offsetTop;
  const cuts = [];
  for (const run of container.querySelectorAll('.poster-box-row .poster-row-times')) {
    const times = [...run.querySelectorAll(':scope > .poster-t')];
    if (!wrapped(times)) continue;
    const cut = Math.floor(times.length / 2);
    if (cut) cuts.push({ run, rest: times.slice(cut) });
  }
  for (const { run, rest } of cuts) {
    const more = document.createElement('bdi');
    more.className = 'poster-row-times poster-box-more';
    for (const t of rest) more.appendChild(t);
    run.after(more);
  }
}

/** The יום כיפור schedule, with or without that box under it. */
function ykBody(poster, { box = true, year = true } = {}) {
  // A row whose times are a list of מנינים is comma separated; a row naming one זמן on two
  // reckonings keeps the slash. Same split the סליחות and ראש השנה sheets already make.
  const rows = (lines) => lines.map((ln) =>
    rhRow(ln.label, ln.times, ln.extra, ln.sub, ln.sep || (ln.list ? ', ' : SLASH))).join('');
  return `
    <h2 class="poster-title" lang="he">${escAttr(YK_TEXT.title)}${year ? ' ' + escAttr(hebrewYear(poster.hebrewYear)) : ''}</h2>
    <div class="poster-rows is-dense">
      <h3 class="poster-day" lang="he">${escAttr(YK_TEXT.erevHeading)}</h3>
      ${rows(poster.erevLines)}
      <h3 class="poster-day" lang="he">${escAttr(YK_TEXT.dayHeading)}</h3>
      ${rows(poster.dayLines)}
      <hr class="poster-divider">
      ${rhRow(poster.nextMorning.label, poster.nextMorning.times, undefined, undefined, ', ')}
      ${box ? ykAfterBox(poster) : ''}
    </div>`;
}

function renderYomKippurPoster(poster, settings) {
  return posterShell(settings, ykBody(poster), poster.legend || [], { dense: true });
}

/** Both schedules on one sheet, in two columns, under one letterhead and one key.
 *
 *  Each column is the sheet's own body, unchanged: the same rows at the same sizes with the
 *  same spacing as that poster prints on its own page, box and all. Nothing is re-worded,
 *  re-laid-out or shrunk to fit.
 *
 *  An earlier version did shrink it, and moved the box of everyday times out to the foot on
 *  the portrait sheet, on the assumption that two schedules could not sit on one page at full
 *  size. Measured, that was not true: side by side at their own 12pt they leave 153px clear
 *  at the foot with no row wrapping. The columns and the header are in .poster-pair in
 *  app.css and there are no type sizes there any more. */
function renderPairPoster(poster, settings, { landscape = false } = {}) {
  const body = `<div class="poster-pair">
      <div class="poster-pair-col">${rhBody(poster.rh, { year: false })}</div>
      <div class="poster-pair-col">${ykBody(poster.yk, { year: false })}</div>
    </div>`;
  return posterShell(settings, body, poster.legend || [], {
    dense: true, pair: true, landscape, chartHead: true,
  });
}

/** The everyday schedule from after יו"כ to סוכות, given a sheet of its own.
 *
 *  Same times as the box on the יום כיפור sheet, laid out the way the shul hangs this one:
 *  a heading per תפילה and the times under it, broken over two lines so a run of ten does
 *  not have to be set small enough to fit on one. */
function renderAfterYomKippurPoster(poster, settings) {
  // Halved rather than wrapped, so the two lines are even and always break in the same
  // place rather than wherever the width happens to run out.
  const half = (times) => {
    const cut = Math.ceil(times.length / 2);
    return [times.slice(0, cut), times.slice(cut)].filter((r) => r.length);
  };
  const timeLine = (times) =>
    `<p class="poster-set-line" lang="he"><bdi>${times.map(timeHtml).join(', ')}</bdi></p>`;
  const section = (title, times) => `
    <div class="poster-set">
      <h3 class="poster-set-head" lang="he">${escAttr(title)}</h3>
      ${half(times).map(timeLine).join('')}
    </div>`;
  const a = poster.after;
  const body = `
    <h2 class="poster-title poster-title-ltr" dir="ltr">${escAttr(YK_TEXT.afterHeading)}</h2>
    <div class="poster-sets">
      ${section(YK_TEXT.afterBig.shacharis, a.shacharis)}
      ${section(YK_TEXT.afterBig.mincha, a.mincha)}
      ${section(YK_TEXT.afterBig.maariv, a.maariv)}
    </div>`;
  return posterShell(settings, body, poster.legend || []);
}

/** The צום גדליה sheet: the same heading-per-תפילה blocks as the sheet above, but the times
 *  are given in the lines the poster hands over rather than halved, because the morning's
 *  two lines are the two the shul typed in Settings and the afternoon is one line of five.
 *
 *  One block is a note rather than a תפילה: the שקיעה, which stands between מנחה and מעריב
 *  with no heading of its own. */
function tzomGedaliaBody(poster) {
  const timeLine = (times) =>
    `<p class="poster-set-line" lang="he"><bdi>${times.map(timeHtml).join(', ')}</bdi></p>`;
  const section = (s) => (s.note
    ? `<div class="poster-set"><p class="poster-set-note" lang="he">${escAttr(s.note.label)}
        <bdi>${escAttr(s.note.text)}</bdi></p></div>`
    : `
    <div class="poster-set">
      <h3 class="poster-set-head" lang="he">${escAttr(s.head)}</h3>
      ${s.lines.map(timeLine).join('')}
    </div>`);
  return `
    <h2 class="poster-title" lang="he">${escAttr(TZG_TEXT.title)}</h2>
    <div class="poster-sets">${poster.sets.map(section).join('')}</div>`;
}

function renderTzomGedaliaPoster(poster, settings) {
  return posterShell(settings, tzomGedaliaBody(poster), poster.legend || []);
}

/** סליחות and צום גדליה on one sheet, the same two columns under the same header as the
 *  ראש השנה and יום כיפור one.
 *
 *  Same rule: each column is that poster's own body at its own size, with nothing changed
 *  about either of them. These two carry about a third of what ראש השנה and יום כיפור do, so
 *  there is room over in both directions. */
function renderSlichosTzomPoster(poster, settings, { landscape = false } = {}) {
  const body = `<div class="poster-pair">
      <div class="poster-pair-col">${slichosBody(poster.slichos)}</div>
      <div class="poster-pair-col">${tzomGedaliaBody(poster.tzom)}</div>
    </div>`;
  return posterShell(settings, body, poster.legend || [], {
    dense: true, pair: true, landscape, chartHead: true,
  });
}

/* --- Everything on one page ------------------------------------------------------------
   The same yomim noraim the run prints as eight sheets, set as one: two columns of blocks,
   each block a name over a list of label-and-times rows, read down the right-hand column and
   then down the left. It answers a different question from the run. The run is what goes on
   the wall, a sheet per occasion at the size a sheet is read from across a room; this is the
   whole season at a glance, for a hand or a fridge.

   Nothing here works out a time. Every block is a schedule one of the posters has already
   built, taken apart into rows and set small: the same builders, the same settings, the same
   marks. So a time can never differ between the wall and this, and a fix to a poster is a fix
   to this sheet without anything being said here.

   Which blocks and in what order comes from the posters themselves, in the order
   postersByDate puts them, so the year where צום גדליה falls behind שבת שובה comes out in the
   order the days actually run. A poster this table has no entry for is left out rather than
   guessed at. */
const ONEPAGE_TEXT = {
  title: 'ימים נוראים',
  // "ראש השנה - יום א'". Both halves are Hebrew, so a plain hyphen between them needs no
  // isolate: nothing here runs the other way.
  sep: ' - ',
};

/** How many times go on one line before the run is cut in two.
 *
 *  Cut in half rather than left to wrap, the same as the box on the יום כיפור sheet: a wrap
 *  fills the first line and drops the remainder, so twelve times came out as eight and four
 *  with a short line hanging under a full one. Halved, it reads as one list on two lines, and
 *  the shorter half goes on top, which is the way round the shul asked for on that box.
 *
 *  Four, so that every run of מנינים on the sheet is cut and none is left long. It started at
 *  six, which was the number that stopped a row being wider than its column: the מנחה and
 *  מעריב after יו"כ are twelve times each and came out 430px wide in a 348px column, hanging
 *  across the column rule. That fixed the overflow and left the סליחות rows, five and six
 *  times each, on one line beside them, which reads as two different sheets in one column.
 *
 *  Cutting those too costs height, which is what the type is set against: at 1.3 leading it
 *  took the sheet from 98% to 85%. The leading went to 1.2 and the row padding to 0.014in to
 *  pay for it, measured back at 95%, so the whole sheet is cut the same way for about half a
 *  point of type. */
const ONEPAGE_PER_LINE = 4;

/** Cuts every long run of times on the sheet into two lines of about the same width.
 *
 *  Where the cut goes is a question about width, not about how many times there are. Six
 *  times split three and three is even only if all six are the same width, and they are not:
 *  a time carrying ** is wider than a bare one, and an underlined 10:30 is wider than 7:00.
 *  Three and three came out with one line visibly longer than the other. So every cut is
 *  tried and the one that leaves the wider line narrowest wins.
 *
 *  Measured after the sheet is on the page, the same as balanceBoxRows, because the answer is
 *  about what the browser actually drew. offsetWidth rather than a rect: a phone shrinks the
 *  whole sheet with zoom, and a rect read under that is in screen pixels.
 *
 *  It runs before the type is fitted, and the answer holds through the fit: every time on the
 *  line scales by the same factor, so the widths keep their proportions and the best cut stays
 *  the best cut.
 *
 *  The separators come from CSS rather than from the markup, which is what lets a time be
 *  moved to the second line and the slashes work themselves out around the break. A slash
 *  written into the markup would be left stranded at the end of the first line. Same trick,
 *  and the same reason, as the box on the יום כיפור sheet. */
function balanceOnePageTimes(container) {
  for (const run of container.querySelectorAll('.onepage-line')) {
    const times = [...run.querySelectorAll(':scope > .onepage-t')];
    if (times.length <= ONEPAGE_PER_LINE) continue;
    const wide = times.map((t) => t.offsetWidth);
    /* The note at the head of the run counts towards the first line, because it is on it.
       Left out, the two סליחות rows carrying one came out 180px against 109px: the note is
       79px of that first line and the cut was being chosen as though it were not there.

       Its own width and nothing else. Taking the gap as well, by the distance from the note's
       left edge to the first time's, looked more exact and was wrong: the run is measured
       before it is cut, so it is still wrapping, and a first time that has wrapped to the
       next visual line reports the same offsetLeft as the note above it. That read as no note
       at all, and the row with the widest note of the lot was the one it went wrong on. The
       space between them is about 3px and is not worth a second measurement. */
    const note = run.querySelector(':scope > .onepage-note');
    const lead = note ? note.offsetWidth : 0;
    const total = lead + wide.reduce((a, x) => a + x, 0);
    let at = 1;
    let worst = Infinity;
    let head = lead;
    for (let i = 1; i < times.length; i++) {
      head += wide[i - 1];
      const m = Math.max(head, total - head);
      // Strictly narrower to win, so a tie leaves the cut where it already is, which is the
      // earlier one: fewer on the top line, the way round the shul asked for on the box.
      if (m < worst) { worst = m; at = i; }
    }
    const more = document.createElement('bdi');
    more.className = 'onepage-line';
    more.dir = 'ltr';
    for (const t of times.slice(at)) more.appendChild(t);
    run.after(more);
  }
}

/** A block: a name and its rows. Rows are the poster's own line shape, `{ label, times }`
 *  with the same optional `sub`, `extra`, `note` and `sep` the sheets already use, so a row
 *  can be handed straight over from a poster without being rebuilt. */
const oneSection = (title, rows, opts = {}) => ({ title, rows, ...opts });
const oneHead = (a, b) => `${a}${ONEPAGE_TEXT.sep}${b}`;
const onePlain = (text) => [{ text, underlined: false, mark: '' }];

/** One poster's schedule, cut into the blocks this sheet stacks. Keyed by the poster's own
 *  key, so adding a poster to the run and adding it here are the same word twice and a
 *  poster with no entry simply does not appear. */
const ONEPAGE_SECTIONS = {
  slichos: (p) => [oneSection(SLICHOS_TEXT.title, p.rows)],
  roshhashana: (p) => [
    oneSection(oneHead(RH_TEXT.title, RH_TEXT.erevHeading), [
      { label: RH_TEXT.slichos.label, times: parseTimes(RH_TEXT.slichos.times) },
      { label: RH_TEXT.chatzos, times: onePlain(p.chatzos) },
      { label: RH_TEXT.erevMincha.label, times: parseTimes(RH_TEXT.erevMincha.times) },
    ]),
    ...p.blocks.map((b) => oneSection(oneHead(RH_TEXT.title, b.heading), b.lines)),
  ],
  tzomgedalia: (p) => [oneSection(TZG_TEXT.title, p.sets.map((s) => (s.note
    // The שקיעה, which stands between מנחה and מעריב with no מנין of its own. On the sheet
    // of its own it is a line without a heading; here every line has a label already, so it
    // is a row like the rest.
    ? { label: s.note.label, times: onePlain(s.note.text) }
    : { label: s.head, times: s.lines.flat() })))],
  shuva: (p) => [oneSection(SHUVA_TEXT.title, [
    // The two lines of the announcement read as one label with the time beside it. Given a
    // page of its own this is three lines of 24pt down the middle of the sheet; in a column
    // an inch and a half wide it is a row.
    { label: SHUVA_TEXT.lines.join(' '), times: p.drasha ? onePlain(p.drasha) : [] },
    { label: SHUVA_TEXT.minchaLabel, times: p.mincha },
  ])],
  yomkippur: (p) => [
    oneSection(oneHead(YK_TEXT.title, YK_TEXT.erevHeading), p.erevLines),
    oneSection(YK_TEXT.dayHeading, p.dayLines),
    // The morning after names its own day ("שחרית יום ג'"), so the block is named for it and
    // the row inside says only which תפילה it is.
    oneSection(p.nextMorning.label, [{ label: YK_TEXT.shacharis.label, times: p.nextMorning.times }]),
  ],
  afteryk: (p) => [oneSection(YK_TEXT.afterHeading, [
    { label: YK_TEXT.afterBig.shacharis, times: p.after.shacharis },
    { label: YK_TEXT.afterBig.mincha, times: p.after.mincha },
    { label: YK_TEXT.afterBig.maariv, times: p.after.maariv },
  // The only heading on the sheet that is not Hebrew, because it is the wording the shul
  // already hangs. Said out loud rather than left to dir="auto", which would take its cue
  // from the Hebrew half and turn the line round.
  ], { ltrHead: true })],
};

/** One row: the name on the right, the times on the left, the way a timetable is read.
 *
 *  `extra` becomes a row of its own rather than riding on the end of this one. On a full
 *  sheet המלך sits beside שחרית because there is a page of width to put it in; in a column
 *  an inch and a half wide the pair wraps and the second label ends up under the times it
 *  does not belong to. */
function onePageRows(r) {
  const label = `<span class="onepage-label"${hebrewLang(r.label)}>${escAttr(r.label)}`
    + `${r.sub ? ` <span class="onepage-sub">${escAttr(r.sub)}</span>` : ''}</span>`;
  /* A list of מנינים and a זמן given two ways are both slash separated here. The full sheets
     tell them apart with commas because they have the room to; at this size the comma and
     the digits either side of it close up into one run and the slash is what keeps them
     apart.

     A run long enough to be cut in two is written as one span a time with the slashes coming
     from CSS, so balanceOnePageTimes can move a span and have the separators work themselves
     out around the break. A short run keeps its slashes in the markup and can carry its own
     separator: the only row that does is קידוש לבנה, whose two answers are joined by an &,
     and two answers are never cut. */
  const long = r.times.length > ONEPAGE_PER_LINE;
  const sep = r.sep || SLASH;
  const note = r.note ? `<bdi class="onepage-note">${escAttr(r.note)}</bdi> ` : '';
  // dir="ltr" said out loud, not left to a bdi's dir="auto": times are digits, which are not
  // strong characters, so a note's Hebrew would otherwise turn the whole run around.
  //
  // The note goes on the first line, against the first time, which is the time it is about:
  // it says that מנין runs five minutes earlier on the days it names. The sheets it comes
  // off put it there for the same reason.
  const body = long
    ? r.times.map((t) => `<span class="onepage-t">${timeHtml(t)}</span>`).join('')
    : r.times.map(timeHtml).join(sep);
  const times = r.times.length || note
    ? `<div class="onepage-times"><bdi class="onepage-line" dir="ltr">${note}${body}</bdi></div>`
    : '';
  return `<div class="onepage-row">${label}${times}</div>`
    + (r.extra ? onePageRows({ label: r.extra.label, times: r.extra.times }) : '');
}

/** The whole season on one sheet.
 *
 *  Two columns by CSS rather than by handing blocks out between two boxes here. The browser
 *  balances them, which means a year that runs long or short does not need this file to know
 *  about it, and the blocks stay in one list in date order however they fall. Columns run
 *  right to left, so the first block is at the top right, which is where a Hebrew page starts.
 *
 *  Nothing is dropped to make it fit: see fitOnePage, which sets the type instead. */
function renderOnePagePoster(built, settings) {
  const sections = [];
  for (const it of built.items) {
    const cut = ONEPAGE_SECTIONS[it.key];
    if (cut) sections.push(...cut(it.poster));
  }
  /* One key at the foot for the whole sheet, gathered off the sheets it is made of.
     Not simply the distinct lines: a poster naming both marks writes "*בעזרת נשים
     **באולם השמחות" and one using only the first writes "*בעזרת נשים", which are two
     different strings saying one thing, and the sheet came out with the key's second line
     under itself. A line is kept only where no other line already covers it. Asked of the
     lines rather than of the times, so the wording stays where it is written and this does
     not become a second place that has to say what a star means. */
  const lines = [];
  for (const it of built.items) for (const l of it.poster.legend || []) lines.push(l);
  const legend = lines.filter((l, i) =>
    !lines.some((o, j) => j !== i && o.text !== l.text && o.text.includes(l.text))
    // Two identical lines: keep the first.
    && lines.findIndex((o) => o.text === l.text) === i);
  /* Both columns are written out, and every block starts in the first one. Which of them
     each block ends up in is settled by fitOnePage, after the browser has said how tall
     each is: the split is a measurement, not a number written down here, so a year that
     runs long or short lands where it should without this file knowing about it. */
  const body = `
    <h2 class="onepage-title" lang="he">${escAttr(ONEPAGE_TEXT.title)} ${escAttr(hebrewYear(built.hebrewYear))}</h2>
    <div class="onepage-cols">
      <div class="onepage-col">
        ${sections.map((s) => `<section class="onepage-sec">
          <h3 class="onepage-sec-head"${s.ltrHead ? ' dir="ltr"' : hebrewLang(s.title)}>${escAttr(s.title)}</h3>
          ${s.rows.map(onePageRows).join('')}
        </section>`).join('')}
      </div>
      <div class="onepage-col"></div>
    </div>`;
  return posterShell(settings, body, legend, { onepage: true, chartHead: true })
    + (built.notBuilt.length
      ? `<p class="hint no-print">Not on this sheet, nothing to build them from this year: ${escAttr(built.notBuilt.join(', '))}</p>`
      : '');
}

/** Sets the type on the one-page sheet to the largest that still fits the two columns.
 *
 *  How much there is to fit is a question about the year, not about the design: a ר"ה on
 *  Shabbos adds lines, a fast pushed to the Sunday moves a block, and the מעריב after יו"כ is
 *  a list of eleven times in a column an inch and a half wide. Written at one size it would
 *  have to be the size the worst year needs and every other year would print smaller than it
 *  had to, on a sheet whose whole difficulty is that the type is small already.
 *
 *  So it is measured, and upwards rather than downwards: start below anything that could fit,
 *  grow while it still does, and take the last size that did. Content that needs more than the
 *  two columns makes a third, which is what scrollWidth reports and the frame would otherwise
 *  cut off, so "still fits" is one question with one answer.
 *
 *  Coarse then fine, because each step is a reflow of the whole sheet and this runs on a phone
 *  too: eleven steps of 0.05 to find the neighbourhood, then at most five of 0.01 inside it.
 *  Sixteen reflows against the seventy a single pass of 0.01 would have cost.
 *
 *  The ceiling is there because a short year would otherwise grow until the type was larger
 *  than the wall sheets' own; the floor because a year that will not fit at any readable size
 *  should spill visibly rather than print at a size nobody can read. Measured across תשפ"ה to
 *  תשצ"ד, no year has reached either.
 *
 *  It runs after fitPoster rather than before it, and that is the whole of a bug this got
 *  wrong once. Measured on an unscaled sheet the answer was 95%, and 95% is right on a
 *  desktop; a phone then shrank the sheet to fit its screen, and under that zoom every row
 *  rounds to whole device pixels and the column holds a line or two fewer. The first column
 *  overflowed, the overflow made a third column, and the far end of the sheet printed off the
 *  side of the paper. Reported from a phone, and it was a real spill and not the rounding I
 *  first put it down to.
 *
 *  So it is measured in the state the sheet is actually in. What that costs is one step of
 *  type on a phone: at zoom 1 this year fits at 95%, at 0.72 at 94% and at the 0.42 a 375px
 *  screen gives it at 89%. Printing is the safe direction from there, since print.css never
 *  scales a sheet below 0.72 and a desktop does not scale it at all, so a fit made at the
 *  screen's zoom always has room on paper. The extra step off the top is for the difference
 *  between this and a device whose pixels are not the ones measured here. */
const OP_MIN = 0.7;
const OP_MAX = 1.25;
const OP_STEP = 0.01;
/** Room left at the foot before a size counts as fitting, in the sheet's own pixels.
 *
 *  A tenth of an inch on eleven, which is the price of not having to be right to the pixel
 *  on a device that cannot be measured from here. Every phone lays a line of type out a
 *  little differently: a different rasteriser, a different pixel ratio, a different fallback
 *  where a webfont did not arrive. Fitted to the last pixel here, some of those come out one
 *  line over there, and one line over is a block off the sheet. */
const OP_ROOM = 11;
function fitOnePage(container) {
  for (const sheet of container.querySelectorAll('.poster.is-onepage')) {
    const cols = sheet.querySelector('.onepage-cols');
    const col = cols?.querySelectorAll(':scope > .onepage-col');
    if (!col || col.length !== 2) continue;
    const secs = [...cols.querySelectorAll('.onepage-sec')];
    if (secs.length < 2) continue;
    const set = (v) => sheet.style.setProperty('--op-scale', v);
    /* Hand the blocks out between the two columns so the taller of them is as short as it
       can be, and answer with how tall that is.
       offsetHeight, which is layout and is in the sheet's own pixels: a phone shrinks the
       whole sheet with zoom to fit its screen, and a rect read under that is in screen
       pixels, so it could not be compared with the box it has to fit.
       Every split is tried rather than the halfway point taken, because the blocks are not
       the same size: יום כיפור is fourteen rows and שבת שובה is two, and cutting the list in
       the middle leaves one column inches longer than the other. */
    const layout = () => {
      const tall = secs.map((s) => s.offsetHeight
        + parseFloat(getComputedStyle(s).marginBottom || 0));
      const total = tall.reduce((a, x) => a + x, 0);
      let at = 1;
      let worst = Infinity;
      let run = 0;
      for (let i = 1; i < secs.length; i++) {
        run += tall[i - 1];
        const m = Math.max(run, total - run);
        if (m < worst) { worst = m; at = i; }
      }
      secs.forEach((s, i) => {
        const want = i < at ? col[0] : col[1];
        if (s.parentElement !== want) want.appendChild(s);
      });
      return worst;
    };
    const fits = () => layout() <= cols.clientHeight - OP_ROOM;
    let best = OP_MIN;
    for (const step of [0.05, OP_STEP]) {
      for (let v = best; v <= OP_MAX + 1e-9; v = Math.round((v + step) * 100) / 100) {
        set(v);
        if (!fits()) break;
        best = v;
      }
    }
    set(best);
    layout();
  }
}

// Which sheet is on screen, when they are being shown one at a time. Null until something
// has been picked, which is how a fresh load and a change of occasion both land on the first
// sheet of the list without this having to know what that is.
let chosen = null;
/* How much is on screen and on how much paper: 'one' is a single sheet, 'each' is every sheet
   one to a page, 'all' is every one of them on a single sheet.
   One control rather than two, because there were only ever three answers. It was a pair of
   switches, which is four boxes, and the fourth was dead: a single sheet has no layout to
   choose and the second switch went away whenever the first said one. Three points on one
   axis is what it always was. */
let chosenSheets = 'one';
// Which yom tov. One so far, and the picker has one answer, but the posters have been grouped
// by it from the start and the next set drawn will land in the next group.
let chosenGroup = null;
// The year, stepped by the two buttons. Null means the yomim noraim coming up, which is what
// a fresh load should open on: see posterYears.
let chosenYear = null;
// Told to app.js whenever a picker moves, so the choice can go in the address. Held here
// rather than passed through every redraw, since redrawInPlace calls back in on its own.
let onRoute = null;
// The Hebrew-calendar tables, handed in by app.js once it has loaded them and held here the
// way onRoute is, since redrawInPlace calls back in without them. Only the שבת שובה poster
// needs them, and only in a year with no chart saved: it has to know that Shabbos's parsha,
// because a rule can be keyed on one.
let posterTables = null;

/** Which poster is on screen and, if it is one that can be set either way up, which way.
 *  app.js writes this into the address so a refresh comes back to the same sheet.
 *
 *  The year is deliberately not in it. It defaults to the yomim noraim coming up, which is
 *  the right answer on a fresh load; carrying a year in the address would mean a link that
 *  goes stale. */
export function posterRoute() {
  // The whole set keeps the key the run entry has always had, so a link written before it
  // became a switch still lands on it.
  const key = chosenSheets === 'one' ? chosen : POSTERS.find((p) => p.last)?.key;
  if (!key) return [];
  const poster = POSTERS.find((p) => p.key === key);
  return poster?.orientations ? [key, chosenOrientation] : [key];
}

/** The other way: set the pickers from the address. Anything unrecognised is left alone,
 *  so an old or hand-typed link falls back to the defaults rather than to nothing. */
export function setPosterRoute(parts = []) {
  // What was remembered first, then the address over the top of it: a link says which sheet
  // and which way up, and everything it does not say is left as it was left.
  recallBar();
  const [key, orient] = parts;
  const poster = POSTERS.find((p) => p.key === key);
  if (poster?.last) {
    // A link to the whole set says only that, not which of the two ways of laying it out, so
    // whichever was left standing is kept.
    if (chosenSheets === 'one') chosenSheets = 'each';
  } else if (poster) {
    chosenSheets = 'one';
    chosen = key;
    // The occasion goes with the sheet, so a link to one of another yom tov's brings its own
    // heading up with it rather than landing on a list the sheet is not in.
    chosenGroup = poster.group || POSTER_GROUP_DEFAULT;
  }
  if (orient === 'portrait' || orient === 'landscape') chosenOrientation = orient;
  // The year is not in the address and is not cleared by a change of one: it is the year
  // being worked in rather than part of what a link points at. See recallBar.
  conflictPick = 0;
  rememberBar();
}
// Which way up the one sheet that can go either way is set. Only the pair poster reads it,
// and it is remembered across a redraw so changing the year does not put it back.
let chosenOrientation = 'portrait';

/* --- Keeping the bar's answers across a refresh ----------------------------------------
   Everything the bar asks is remembered, so coming back to the tab opens on the sheet you
   were last looking at, in the year, for the occasion, laid out the way you left it.

   In localStorage rather than in the address, and the two carry different things on purpose.
   The address is what a link is made of, so it holds what somebody would mean by "this
   poster": which sheet, and which way up. The year is not in it and must not be, or a link
   sent to somebody, or bookmarked, opens on a year that has gone by. But "the year I was
   working in" is exactly the kind of thing a refresh should not lose, so it is kept here,
   against this browser rather than against the link.

   A remembered year expires by itself. The picker offers two years back and seven forward,
   so one left behind for long enough simply stops being on the list and the render falls
   back to the yomim noraim coming up, the same as it does for a sheet that is not in the
   occasion showing. Nothing here has to check how old anything is.

   Wrapped, because localStorage is not always readable: it throws outright in a page inside
   another site where third party storage is blocked, and in a private window in some
   browsers. Which sheet came up last is a convenience; losing the tab over it is not a trade
   worth making, so it falls back to the defaults and carries on. */
const POSTER_BAR_KEY = 'zmanim-poster-bar-v1';
let recalled = false;
function recallBar() {
  if (recalled) return;
  recalled = true;
  try {
    const saved = JSON.parse(localStorage.getItem(POSTER_BAR_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    // Read one at a time and only where the value is the right shape. Everything read here
    // is checked again by the render, which falls back to the first sheet of the occasion
    // and to the year coming up, so a stale or hand edited value costs nothing.
    if (Number.isFinite(saved.year)) chosenYear = saved.year;
    if (typeof saved.group === 'string') chosenGroup = saved.group;
    if (typeof saved.sheet === 'string') chosen = saved.sheet;
    if (['one', 'each', 'all'].includes(saved.sheets)) chosenSheets = saved.sheets;
    // What the two switches this replaced were remembered as, carried forward so somebody
    // who left the tab on the run comes back to it rather than to a single sheet.
    else if (typeof saved.all === 'boolean') chosenSheets = saved.all ? (saved.onePage ? 'all' : 'each') : 'one';
    if (typeof saved.combined === 'boolean') chosenCombined = saved.combined;
    if (saved.orientation === 'portrait' || saved.orientation === 'landscape') {
      chosenOrientation = saved.orientation;
    }
  } catch {
    // Nothing to do: the bar opens on its defaults, which is where it opened before any of
    // this was remembered at all.
  }
}
function rememberBar() {
  try {
    localStorage.setItem(POSTER_BAR_KEY, JSON.stringify({
      year: chosenYear, group: chosenGroup, sheet: chosen, sheets: chosenSheets,
      combined: chosenCombined, orientation: chosenOrientation,
    }));
  } catch {
    // The choice still holds for this page, it just will not be there next time.
  }
}
/* Whether the run carries the two-in-one sheets. Left out by default, and the first of the
   two sides: one occasion a sheet is the run somebody wants nearly every time, and including
   them puts two of the schedules on the run twice over, once on their own sheet and once
   doubled up. Only the run reads it, and it is remembered across a redraw the same way. Not
   in the address: the orientation is there because it decides what paper comes out, and this
   only decides how many sheets. */
let chosenCombined = false;
// Which chart to read when two saved ones cover the same שבת שובה and disagree. Only ever
// looked at in that case, which is why it is not part of the source id.
let conflictPick = 0;
let fitHandler = null;

/** Shrinks the poster until it fits across the screen, which on a phone it does not: the
 *  page is a real 8.5in and a 375px display is less than half of that, so without this the
 *  tab opens onto a strip of the sheet with the rest off the side.
 *
 *  Same mechanism as the charts' Fit to screen, and for the same reason: `zoom` shrinks the
 *  box as well as the paint, while `transform: scale` only paints smaller and leaves the
 *  full-size footprint behind, which is the overflow all over again. print.css forces
 *  `zoom: 1` back on, so what is on paper is always the full 8.5in.
 *
 *  No button beside it, unlike the charts. There is one page and nothing to choose.
 *
 *  Exported because the congregation's Special Schedules page draws the same sheets and has
 *  the same problem, and a second copy of this would be a second thing to keep right. */
export function fitPoster(container) {
  // All of them at once is a run of sheets rather than one, and they are not all the same
  // width: the two that can be set landscape are 11in where the rest are 8.5in. Each is
  // measured and scaled on its own, so a portrait sheet is not shrunk to fit a landscape
  // one that happens to be under it.
  // A sheet turned on its side is scaled by its wrapper rather than by itself: rotation
  // leaves the sheet's own box 11in wide whatever it looks like, and it is the wrapper, the
  // portrait page it is sitting on, that has to fit the screen.
  const all = [...container.querySelectorAll('.poster')].map((el) => el.closest('.is-sideways') || el);
  if (!all.length) return;
  const decide = () => {
    for (const el of all) {
      el.style.zoom = ''; // always measure unscaled
      const box = el.parentElement;
      const cs = getComputedStyle(box);
      const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const wide = el.getBoundingClientRect().width;
      if (avail > 0 && wide > avail) el.style.zoom = Math.max(0.15, avail / wide);
    }
    // The one-page sheet's type is set against the zoom just chosen, so the two are decided
    // together and a resize cannot leave one of them behind. See fitOnePage for why it has
    // to be this way round.
    fitOnePage(container);
  };
  decide();
  // Rotating a phone changes what fits. One listener, replaced each render so it always
  // points at the posters currently on screen.
  if (fitHandler) window.removeEventListener('resize', fitHandler);
  fitHandler = () => { if (document.body.contains(all[0])) decide(); };
  window.addEventListener('resize', fitHandler);
}

/** Redraw after a picker changed, without throwing the reader back to the top.
 *
 *  A redraw replaces the whole tab's markup, and for the moment the container is empty the
 *  document has no height, so the browser clamps the scroll position to 0 and it never
 *  comes back. On a desktop this is invisible, because the page is tall enough either way
 *  that there is nothing to clamp; on a phone the poster is zoomed down to fit and the page
 *  is short, so changing the poster or the year jumped straight to the top every time.
 *
 *  The scroll goes back after the redraw rather than before, since fitPoster runs during it
 *  and changes the page's height. Focus goes back to the select that was just used, so the
 *  next arrow key still moves it, and preventScroll keeps that from undoing the restore. */
function redrawInPlace(container, state) {
  const y = window.scrollY;
  const focused = document.activeElement?.id || '';
  renderPosters(container, state);
  if (focused) container.querySelector(`#${focused}`)?.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

export function renderPosters(container, state, routeChanged, tables) {
  recallBar();
  if (routeChanged !== undefined) onRoute = routeChanged;
  if (tables) posterTables = tables;
  const settings = resolveSettings(state.settings);
  // Ordered by date, so the picker and the run both read down the season. Which year's dates
  // is settled here rather than below, because the order has to be known before the poster is
  // picked out of it. Every poster's sources are the same list of years and a source id is
  // that year, so this is the Year picker's answer without having to build anything first.
  /* The year, stepped rather than picked out of a list. It opens on the yomim noraim coming
     up, not on the calendar's own year: in אלול the calendar still says last year, and that
     is the year somebody would print by mistake. The list is still what says how far the
     steps reach, since a year with a chart saved for its שבת שובה is in it whether or not it
     is one of the ten either side. */
  const { years, preferred } = posterYears(state);
  const year = years.includes(chosenYear) ? chosenYear : preferred;
  const at = years.indexOf(year);

  /* Which occasion, and then which sheet of it. The whole year is offered whether or not its
     sheets exist yet, so the list reads as the shul's year rather than as a report on what
     has been drawn (see POSTER_OCCASIONS). Only the first of them has sheets so far.
     The nameless group is dropped: it holds the run, which is now the other side of the
     "one at a time or all of them" switch rather than an entry in the list. */
  const drawn = new Map(posterGroups(year, settings).filter((g) => g.name).map((g) => [g.name, g.items]));
  const groups = [
    ...POSTER_OCCASIONS.map((name) => ({ name, items: drawn.get(name) || [] })),
    ...[...drawn].filter(([name]) => !POSTER_OCCASIONS.includes(name)).map(([name, items]) => ({ name, items })),
  ];
  const group = groups.find((g) => g.name === chosenGroup) || groups[0];
  const items = group ? group.items : [];
  // An occasion nobody has given times for yet. Everything past the picker is left off: a
  // Sheets switch over nothing, or a Print button that would hand over a blank page, is a
  // control that lies about what is there.
  const empty = items.length === 0;
  const runPoster = POSTERS.find((p) => p.last);
  const one = items.find((p) => p.key === chosen) || items[0] || null;
  // 'each' and 'all' are both the whole set; they differ only in how it is laid out.
  const showAll = chosenSheets !== 'one';
  const onePage = chosenSheets === 'all';
  const poster = empty ? null : showAll ? runPoster : one;

  // Which of the further switches this sheet actually reads. The two-in-one sheets and the
  // paper's own way up belong to the run; the way up only means something when there is a
  // sheet in the run that can be turned, which is what including them decides.
  const canTurn = Boolean(poster?.orientations) && !onePage && (!poster?.last || chosenCombined);

  const sources = poster ? poster.sources(state, settings) : [];
  const source = sources.find((s) => s.year === year)
    || sources.find((s) => s.preferred) || sources[0] || null;
  const result = poster && source ? source.build() : { missing: 'No year to build from.' };
  const built = result.poster || null;

  container.className = 'is-sheet-view';
  container.innerHTML = `
    <h2 class="no-print">Posters</h2>
    <p class="hint no-print">The sheets the shul hangs that are not the zmanim board. What changes with the year is worked out rather than typed, so a poster is right the year it is printed and every year after.</p>
    <div class="poster-bar no-print">
      <div class="poster-year">
        <span class="poster-year-label" id="poster-year-label">Year</span>
        <div class="poster-year-step" role="group" aria-labelledby="poster-year-label">
          <button type="button" id="poster-year-back" aria-label="The year before"
            ${at <= 0 ? 'disabled' : ''}>&minus;</button>
          <!-- data-year is the number behind the label, which is written as תשפ״ז and a
               Gregorian date. aria-live, so a screen reader is told the year changed rather
               than the page silently becoming a different one. -->
          <span class="poster-year-now" data-year="${year}" aria-live="polite">${escAttr(yearLabel(year))}</span>
          <button type="button" id="poster-year-next" aria-label="The year after"
            ${at >= years.length - 1 ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <label>Yom tov
        <select id="poster-group">
          ${groups.map((g) => `<option value="${escAttr(g.name)}" ${group && g.name === group.name ? 'selected' : ''}>${escAttr(g.name)}</option>`).join('')}
        </select>
      </label>
      ${empty ? '' : `<div class="poster-bar-switch">${switchHtml('poster-sheets', 'Sheets', [
        { value: 'one', label: 'Just one', on: chosenSheets === 'one' },
        { value: 'each', label: 'A sheet each', on: chosenSheets === 'each' },
        // The one beside it says sheet, so this reads as all on one sheet without having to
        // say it, which it has no room to: three sides of a switch get 86px of text each on
        // a phone and "All on one sheet" is 105px of it.
        { value: 'all', label: 'All on one', on: chosenSheets === 'all' },
      ])}</div>`}
      ${!empty && !showAll ? `<label>Which sheet
        <select id="poster-pick">
          ${items.map((p) => `<option value="${p.key}" ${one && p.key === one.key ? 'selected' : ''}>${escAttr(p.label)}</option>`).join('')}
        </select>
      </label>` : ''}
      ${!empty && showAll && !onePage ? `<div class="poster-bar-switch">${switchHtml('poster-combined', 'The two-in-one sheets', [
        { value: 'no', label: 'Leave out', on: !chosenCombined },
        { value: 'yes', label: 'Include', on: chosenCombined },
      ])}</div>` : ''}
      ${canTurn ? `<div class="poster-bar-switch">${switchHtml('poster-orient', 'Paper', [
        { value: 'portrait', label: 'Portrait', on: chosenOrientation === 'portrait' },
        { value: 'landscape', label: 'Landscape', on: chosenOrientation === 'landscape' },
      ])}</div>` : ''}
      ${built ? printButtonHtml() : ''}
    </div>
    ${built ? (() => { const w = poster.when(built); return `
      <div class="poster-when no-print">
        <div class="poster-when-what"${hebrewLang(poster.covers(year))}>${escAttr(poster.covers(year))}</div>
        <div class="poster-when-he" lang="he" dir="rtl">${escAttr(w.he)}</div>
        <div class="poster-when-en">${escAttr(w.en)}</div>
      </div>`; })() : poster ? `<p class="hint no-print">${escAttr(poster.covers(year))}</p>` : ''}
    ${result.conflict
      ? `<p class="hint no-print">Two saved charts cover this שבת שובה and they do not say the same thing, so pick which one to read:
           <select id="poster-conflict">
             ${result.conflict.map((b, i) => `<option value="${i}" ${i === conflictPick ? 'selected' : ''}>${escAttr(chartLabel(b.sheet))}</option>`).join('')}
           </select></p>`
      : ''}
    ${empty
      ? `<p class="hint no-print">Nothing is drawn for <bdi${hebrewLang(group.name)}>${escAttr(group.name)}</bdi> yet. It is in the list so the whole year is in one place; the sheets follow once the shul's times for it are in, and then this fills in on its own the way <bdi${hebrewLang(POSTER_GROUP_DEFAULT)}>${escAttr(POSTER_GROUP_DEFAULT)}</bdi> does.</p>`
      : built
        ? poster.render(built, settings, { landscape: chosenOrientation === 'landscape' })
        : `<p class="hint no-print">${escAttr(result.missing || '')}</p>`}`;

  const again = () => redrawInPlace(container, state);
  // A year either side, and no further: the buttons at the ends are disabled rather than
  // wrapping round, so holding one down cannot walk off the list.
  const step = (by) => {
    const to = years[at + by];
    if (to == null) return;
    chosenYear = to;
    conflictPick = 0;
    rememberBar();
    again();
  };
  container.querySelector('#poster-year-back')?.addEventListener('click', () => step(-1));
  container.querySelector('#poster-year-next')?.addEventListener('click', () => step(1));
  container.querySelector('#poster-group')?.addEventListener('change', (e) => {
    chosenGroup = e.target.value;
    // The sheet chosen belongs to the occasion that was showing, so it is let go of here
    // rather than left pointing into a list it is not in any more.
    chosen = null;
    conflictPick = 0;
    rememberBar();
    onRoute?.();
    again();
  });
  wireSwitch(container, 'poster-sheets', (value) => {
    chosenSheets = value;
    conflictPick = 0;
    rememberBar();
    onRoute?.();
    again();
  });
  container.querySelector('#poster-pick')?.addEventListener('change', (e) => {
    chosen = e.target.value;
    conflictPick = 0;
    rememberBar();
    onRoute?.();
    again();
  });
  wireSwitch(container, 'poster-orient', (value) => {
    chosenOrientation = value;
    rememberBar();
    onRoute?.();
    again();
  });
  wireSwitch(container, 'poster-combined', (value) => {
    chosenCombined = value === 'yes';
    rememberBar();
    again();
  });
  container.querySelector('#poster-conflict')?.addEventListener('change', (e) => {
    conflictPick = Number(e.target.value) || 0;
    again();
  });
  if (built) {
    /* Every sheet on this tab prints on portrait paper, the landscape ones included: they
       go on it turned a quarter turn, which is what the run has always done with them and
       what a single one does now as well. See the .poster.is-landscape rule in print.css
       for why it is not left to the paper to be landscape. */
    setPrintPage('letter portrait');
    wirePrintButton(container);
    // Before fitPoster, so the cut is measured at the sheet's real size. zoom is uniform and
    // would not change where a line breaks, but measuring the unscaled sheet is one less
    // thing to have to be sure of.
    balanceBoxRows(container);
    // Before the type is fitted, and it can be: every time on a line scales by the same
    // factor, so where the run should be cut does not change when the size does. The heights
    // it settles are what the fit then measures.
    balanceOnePageTimes(container);
    // fitPoster sets the one-page sheet's type as well as the sheets' zoom, since the first
    // depends on the second.
    fitPoster(container);
  }
}
