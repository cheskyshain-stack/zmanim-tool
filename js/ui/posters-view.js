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
import { buildShuvaPoster, shuvaWeekOf, shuvaSheetsFor, SHUVA_TEXT } from '../posters/shuva.js';
import { buildSlichosPoster, SLICHOS_TEXT } from '../posters/slichos.js';
import { hebrewDateExtended, hebrewYear, roshHashana, jewishDateString, excelWeekday } from '../hebrew-calendar.js';
import { excelSerial, dateFromSerial } from '../zmanim/solar.js';
import { printButtonHtml, wirePrintButton } from './print-page.js';
import { fontStackFor } from './sheet-view.js';
import { hebrewLang, DAY_NAMES } from '../util.js';

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
function nextYomimNoraim(today = new Date()) {
  const serial = excelSerial(today);
  const year = hebrewDateExtended(serial).year;
  const yomKippur = (y) => roshHashana(y - 3761) + 9; // 10 תשרי
  return serial > yomKippur(year) ? year + 1 : year;
}

/** The years to offer, and which one to open on.
 *
 *  The one coming up, the one before it so last year's sheet can be reprinted, and the one
 *  after so next year's can be made early. Plus any year a generated chart covers the שבת
 *  שובה of, which is not the year written on that chart (see shuvaSheetsFor). */
function posterYears(state) {
  const next = nextYomimNoraim();
  const years = new Set([next - 1, next, next + 1]);
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
    key: 'shuva',
    label: 'שבת שובה דרשה',
    covers: (y) => `שבת שובה ${hebrewYear(y)}`,
    // The one Shabbos it is about, read off the week the chart handed back.
    when: (built) => when(excelSerial(new Date(built.week.date))),
    sources: (state, settings) => {
      const { years, preferred } = posterYears(state);
      return years.map((y) => ({
        id: String(y),
        year: y,
        label: yearLabel(y),
        preferred: y === preferred,
        build: () => buildFromCharts(state, settings, y),
      }));
    },
    render: renderShuvaPoster,
  },
  {
    key: 'slichos',
    label: 'סליחות',
    covers: (y) => `סליחות through ערב יו"כ ${hebrewYear(y)}`,
    // First סליחות morning through ערב יו"כ, the last line on the sheet.
    when: (built) => when(built.span.from, built.span.to),
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
];

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
 *  It reads its times off a chart, but which chart is a question with an answer, so it is
 *  not put to the user: shuvaSheetsFor finds every generated chart covering that שבת שובה,
 *  and one of them is normally the only one. Two charts are only worth asking about if they
 *  actually say different things, which happens when one has a hand-edited cell, so they are
 *  built and compared and the picker only appears when they genuinely disagree. */
function buildFromCharts(state, settings, hebrewYearNum) {
  const sheets = shuvaSheetsFor(state.sheets, hebrewYearNum);
  if (!sheets.length) {
    return { missing: `No generated chart covers שבת שובה ${hebrewYear(hebrewYearNum)}. It falls in a קיץ season, which is named for the year before: generate קיץ ${hebrewYearNum - 1} and this fills in.` };
  }
  const built = sheets.map((s) => ({ sheet: s, poster: buildShuvaPoster(s, state, settings) }))
    .filter((b) => b.poster);
  if (!built.length) return { missing: 'The chart covering that שבת שובה has no מנחה times to read.' };
  const signature = (p) => JSON.stringify([p.drasha, p.mincha]);
  const agree = built.every((b) => signature(b.poster) === signature(built[0].poster));
  if (agree) return { poster: built[0].poster };
  const pick = built[conflictPick] || built[0];
  return { poster: pick.poster, conflict: built };
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One time as the boards write it: plain is the main בית מדרש, underlined is למטה, a
 *  trailing * is בעזרת נשים and ** is באולם השמחות. The same marks as the chart, so
 *  somebody holding a poster and a board is reading one system. */
function timeHtml(t) {
  const body = t.underlined ? `<u>${esc(t.text)}</u>` : esc(t.text);
  return `${body}${esc(t.mark || '')}`;
}

/** The page every poster is drawn on: the letterhead, the rabbi's line under it, whatever
 *  the poster itself puts in the middle, and the key to the marks at the foot.
 *
 *  Shared so the two posters cannot drift apart on the parts that are the shul rather than
 *  the occasion. */
function posterShell(settings, body, legend = []) {
  const rabbi = String(settings.headerRabbiLine || '').split('\n').filter(Boolean);
  return `<div class="poster" dir="rtl" style="--poster-font-family: ${esc(fontStackFor(POSTER_FONT))}">
    <img class="poster-wordmark" src="/assets/logo-text.png"
         alt="${esc(settings.shulName)}"${hebrewLang(settings.shulName)} width="1776" height="237">
    <div class="poster-subtitle"${hebrewLang(settings.headerSubtitle)}>${esc(settings.headerSubtitle)}</div>
    <img class="poster-rule" src="/assets/poster-rule.png" alt="" width="1897" height="85">
    <div class="poster-rabbi">${rabbi.map((l) => `<div${hebrewLang(l)}>${esc(l)}</div>`).join('')}</div>
    ${body}
    ${legend.length
      ? `<div class="poster-legend">${legend
          .map((l) => `<div dir="${l.dir}"${hebrewLang(l.text)}>${esc(l.text)}</div>`).join('')}</div>`
      : ''}
  </div>`;
}

function renderShuvaPoster(poster, settings) {
  const body = `
    <h2 class="poster-title" lang="he">${esc(SHUVA_TEXT.title)}</h2>
    ${SHUVA_TEXT.lines.map((l) => `<p class="poster-line" lang="he">${esc(l)}</p>`).join('')}
    ${poster.drasha ? `<p class="poster-at" lang="he">${esc(SHUVA_TEXT.at)} <bdi>${esc(poster.drasha)}</bdi></p>` : ''}
    <p class="poster-mincha" lang="he">${esc(SHUVA_TEXT.minchaLabel)}
      <bdi>${poster.mincha.map(timeHtml).join(', ')}</bdi></p>`;
  return posterShell(settings, body, poster.legend);
}

/** The סליחות sheet: one line per part of the yomim noraim, each a label and its מנינים.
 *
 *  The times run left to right inside a right-to-left line, so each list is its own <bdi>.
 *  So is the note in brackets, which is Hebrew with a time inside it: without the isolate
 *  the bracket and the time swap ends. Measured rather than reasoned about, the same as
 *  every other bidi decision in this project. */
function renderSlichosPoster(poster, settings) {
  const rows = poster.rows.map((r) => `
    <p class="poster-row" lang="he">
      <span class="poster-row-label">${esc(r.label)}</span>
      <bdi class="poster-row-times">${r.times.map(timeHtml).join(', ')}</bdi>
      ${r.note ? `<bdi class="poster-row-note">${esc(r.note)}</bdi>` : ''}
    </p>`).join('');
  const body = `<h2 class="poster-title" lang="he">${esc(SLICHOS_TEXT.title)}</h2>
    <div class="poster-rows">${rows}</div>`;
  return posterShell(settings, body, poster.legend);
}

let chosen = POSTERS[0].key;
let chosenSourceId = null;
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
 *  No button beside it, unlike the charts. There is one page and nothing to choose. */
function fitPoster(container) {
  const el = container.querySelector('.poster');
  if (!el) return;
  const decide = () => {
    el.style.zoom = ''; // always measure unscaled
    const box = el.parentElement;
    const cs = getComputedStyle(box);
    const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const wide = el.getBoundingClientRect().width;
    if (avail > 0 && wide > avail) el.style.zoom = Math.max(0.15, avail / wide);
  };
  decide();
  // Rotating a phone changes what fits. One listener, replaced each render so it always
  // points at the poster currently on screen.
  if (fitHandler) window.removeEventListener('resize', fitHandler);
  fitHandler = () => { if (document.body.contains(el)) decide(); };
  window.addEventListener('resize', fitHandler);
}

export function renderPosters(container, state) {
  const settings = resolveSettings(state.settings);
  const poster = POSTERS.find((p) => p.key === chosen) || POSTERS[0];
  const sources = poster.sources(state, settings);
  // Opens on the yomim noraim coming up, not on the first year in the list. In אלול the
  // calendar still says last year, and that is the year somebody would print by mistake.
  const source = sources.find((s) => s.id === chosenSourceId)
    || sources.find((s) => s.preferred) || sources[0] || null;
  const result = source ? source.build() : { missing: 'No year to build from.' };
  const built = result.poster || null;

  container.className = 'is-sheet-view';
  container.innerHTML = `
    <h2 class="no-print">Posters</h2>
    <p class="hint no-print">The sheets the shul hangs that are not the zmanim board. What changes with the year is worked out rather than typed, so a poster is right the year it is printed and every year after.</p>
    <div class="poster-bar no-print">
      <label>Poster
        <select id="poster-pick">
          ${POSTERS.map((p) => `<option value="${p.key}" ${p.key === poster.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </label>
      <label>Year
        <select id="poster-source">
          ${sources.map((s) => `<option value="${esc(s.id)}" ${source && s.id === source.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </label>
      ${built ? printButtonHtml() : ''}
    </div>
    ${built ? (() => { const w = poster.when(built); return `
      <div class="poster-when no-print">
        <div class="poster-when-what"${hebrewLang(poster.covers(source.year))}>${esc(poster.covers(source.year))}</div>
        <div class="poster-when-he" lang="he" dir="rtl">${esc(w.he)}</div>
        <div class="poster-when-en">${esc(w.en)}</div>
      </div>`; })() : source ? `<p class="hint no-print">${esc(poster.covers(source.year))}</p>` : ''}
    ${result.conflict
      ? `<p class="hint no-print">Two saved charts cover this שבת שובה and they do not say the same thing, so pick which one to read:
           <select id="poster-conflict">
             ${result.conflict.map((b, i) => `<option value="${i}" ${i === conflictPick ? 'selected' : ''}>${esc(chartLabel(b.sheet))}</option>`).join('')}
           </select></p>`
      : ''}
    ${built ? poster.render(built, settings) : `<p class="hint no-print">${esc(result.missing || '')}</p>`}`;

  container.querySelector('#poster-pick')?.addEventListener('change', (e) => {
    chosen = e.target.value;
    conflictPick = 0;
    renderPosters(container, state);
  });
  container.querySelector('#poster-source')?.addEventListener('change', (e) => {
    chosenSourceId = e.target.value;
    conflictPick = 0;
    renderPosters(container, state);
  });
  container.querySelector('#poster-conflict')?.addEventListener('change', (e) => {
    conflictPick = Number(e.target.value) || 0;
    renderPosters(container, state);
  });
  if (built) {
    wirePrintButton(container);
    fitPoster(container);
  }
}
