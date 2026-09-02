// Posters: the sheets the shul hangs that are not the zmanim board.
//
// Two so far, שבת שובה and סליחות, and the tab is shaped for the others to follow rather
// than built around either: pick a poster, pick what it should be built from, and Print
// sends what is on the screen. Announcements and the Yom Tov schedules land here next.
//
// What a poster is built from differs, so a poster says for itself. שבת שובה comes from a
// generated sheet, because it reads its times out of that sheet's מנחה cell; סליחות comes
// from a Hebrew year, because its times are the shul's own fixed מנין slots and what the
// calendar decides is which days each line covers. Both answer sources(), so the picker
// does not need to know which kind it is looking at.
//
// A poster is a real 8.5in by 11in page in the document, the same way a chart page is, so
// what is on the screen is what comes out of the printer and there is no second layout to
// keep in step. See .poster in app.css and the @page rule in print.css.
import { resolveSettings } from '../settings.js';
import { buildShuvaPoster, shuvaWeekOf, SHUVA_TEXT } from '../posters/shuva.js';
import { buildSlichosPoster, SLICHOS_TEXT } from '../posters/slichos.js';
import { hebrewDateExtended, hebrewYear } from '../hebrew-calendar.js';
import { excelSerial } from '../zmanim/solar.js';
import { printButtonHtml, wirePrintButton } from './print-page.js';
import { fontStackFor } from './sheet-view.js';
import { hebrewLang } from '../util.js';

/** Times New Roman, the face the Word posters the shul already hangs were set in. Fixed
 *  rather than taken from the sheet style: a poster is its own document and does not
 *  change when somebody picks a different font for the board. fontStackFor() adds the
 *  shipped stand-in behind it, so an Android phone with no Times New Roman still gets a
 *  serif Hebrew rather than falling back to a sans. */
const POSTER_FONT = 'Times New Roman';

/** The Hebrew years to offer the סליחות poster.
 *
 *  Every year a sheet has been generated for, plus the year we are in now and the one
 *  after it, so the poster can be printed before this year's chart exists. סליחות falls in
 *  the first days of a Hebrew year, so the year on the poster is the year it starts. */
function posterYears(state) {
  const now = hebrewDateExtended(excelSerial(new Date())).year;
  const years = new Set([now, now + 1]);
  for (const sheet of state.sheets) if (sheet.hebrewYear) years.add(Number(sheet.hebrewYear));
  return [...years].sort((a, b) => a - b);
}

/** The posters this tab knows how to draw. One entry per poster: what to call it, what it
 *  can be built from, and how to draw it. A source is one option in the picker, carrying
 *  its own build() so this table is the only place that knows what a given poster needs. */
const POSTERS = [
  {
    key: 'shuva',
    label: 'שבת שובה דרשה',
    sourceLabel: 'From',
    empty: 'No generated chart covers שבת שובה yet. Generate the season that holds it and this fills in.',
    sources: (state, settings) =>
      state.sheets.filter((s) => shuvaWeekOf(s)).map((s) => ({
        id: s.id,
        label: `${s.season} ${s.hebrewYear}`,
        build: () => buildShuvaPoster(s, state, settings),
      })),
    render: renderShuvaPoster,
  },
  {
    key: 'slichos',
    label: 'סליחות',
    sourceLabel: 'Year',
    empty: 'No year to build from.',
    sources: (state) =>
      posterYears(state).map((y) => ({
        id: String(y),
        label: `${hebrewYear(y)} (${y})`,
        build: () => buildSlichosPoster(y),
      })),
    render: renderSlichosPoster,
  },
];

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
 *  the occasion. `corner` is the small line in the top corner, which only the סליחות sheet
 *  carries (the year, the way the hand-made ones had it). */
function posterShell(settings, body, { corner = '' } = {}, legend = []) {
  const rabbi = String(settings.headerRabbiLine || '').split('\n').filter(Boolean);
  return `<div class="poster" dir="rtl" style="--poster-font-family: ${esc(fontStackFor(POSTER_FONT))}">
    ${corner ? `<div class="poster-corner" lang="he">${esc(corner)}</div>` : ''}
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
  return posterShell(settings, body, {}, poster.legend);
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
  return posterShell(settings, body, { corner: poster.yearLabel }, poster.legend);
}

let chosen = POSTERS[0].key;
let chosenSourceId = null;
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
  const source = sources.find((s) => s.id === chosenSourceId) || sources[0] || null;
  const built = source ? source.build() : null;

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
      ${sources.length > 1
        ? `<label>${esc(poster.sourceLabel)}
             <select id="poster-source">
               ${sources.map((s) => `<option value="${esc(s.id)}" ${source && s.id === source.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
             </select>
           </label>`
        : ''}
      ${built ? printButtonHtml() : ''}
    </div>
    ${built ? poster.render(built, settings) : `<p class="hint no-print">${esc(poster.empty)}</p>`}`;

  container.querySelector('#poster-pick')?.addEventListener('change', (e) => {
    chosen = e.target.value;
    chosenSourceId = null;
    renderPosters(container, state);
  });
  container.querySelector('#poster-source')?.addEventListener('change', (e) => {
    chosenSourceId = e.target.value;
    renderPosters(container, state);
  });
  if (built) {
    wirePrintButton(container);
    fitPoster(container);
  }
}
