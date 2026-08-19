// Reading the wall chart on a screen: one stretch of it at a time, with Previous, Today
// and Next above it.
//
// A season chart runs to three pages and there can be two seasons in play at once.
// Showing all of them at once means finding the right one before reading a single time,
// so this opens on the stretch covering now and pages from there, exactly as the week
// view does. It is the same rendering the printed chart uses (buildSheetPages), read-only
// - a second renderer would be a second thing to keep in step with the formulas.
//
// Shared between the congregation's site and the admin's This week screen, so the two
// cannot drift apart.
import { buildSheetPages, syncPageHeights } from './sheet-view.js';
import { attachPagePrintToAll } from './print-page.js';
import { splitWeeksIntoPages } from '../pagination.js';
import { currentSerial, wireSwipe } from './nav-helpers.js';
import { jewishDateString } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';

/** Every stretch of chart there is to look at, in date order: one entry per page of each
 *  season, carrying the שבת page and the Weekday page that go together.
 *
 *  The page breaks of the two charts fall on the same dates (alignPageSizesTo at
 *  generation time), so one index picks the matching pair. Seasons are ordered by the
 *  week they start on, so paging forward runs קיץ into חורף the way the year does. */
export function chartSpreads(state) {
  const spreads = [];
  for (const sheet of state.sheets.filter((s) => s.season !== 'weekday')) {
    const weekday = state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
    splitWeeksIntoPages(sheet.weeks, sheet.pageSizes).forEach((weeks, index) => {
      if (!weeks.length) return;
      spreads.push({ sheet, weekday, index, serials: weeks.map((w) => w.serial) });
    });
  }
  return spreads.sort((a, b) => Math.min(...a.serials) - Math.min(...b.serials));
}

/** The spread covering now: the one holding the same week the week view opens on, so the
 *  two never disagree about which Shabbos is "this" one. */
function spreadIndexForNow(spreads) {
  if (!spreads.length) return 0;
  const target = currentSerial(spreads.flatMap((s) => s.serials));
  const found = spreads.findIndex((s) => s.serials.includes(target));
  return found === -1 ? 0 : found;
}

/** What a spread covers, for the line above the buttons: the first and last Shabbos on
 *  it, in both calendars, the way the week view names its week.
 *
 *  The Hebrew pair goes on its own line in its own direction. Run into the English one it
 *  would be reordered against it, and inside a right-to-left line the earlier date sits
 *  on the right, which is the order it is read in. */
function spreadLabel(spread) {
  const ends = [Math.min(...spread.serials), Math.max(...spread.serials)];
  const english = ends.map((serial) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(dateFromSerial(serial))
  );
  const hebrew = ends.map((serial) => jewishDateString(serial, false));
  return {
    english: english[0] === english[1] ? english[0] : `${english[0]} to ${english[1]}`,
    hebrew: hebrew[0] === hebrew[1] ? hebrew[0] : `${hebrew[0]} – ${hebrew[1]}`,
  };
}

/** A chart page is a fixed 11in wide, so on anything narrower it is scaled down rather
 *  than scrolled sideways: the whole page should be visible at once. Print resets it
 *  (see print.css), since paper has no such problem. */
function fitChartToWindow(pagesEl) {
  const apply = () => {
    if (!document.body.contains(pagesEl)) return;
    pagesEl.style.zoom = '';
    const available = pagesEl.clientWidth;
    const content = pagesEl.scrollWidth;
    if (!available || content <= available) return;
    pagesEl.style.zoom = (available / content).toFixed(4);
  };
  apply();
  window.addEventListener('resize', apply);
}

/** @param {object} opts
 *    - empty: what to say when there is no chart to show at all
 *    - swipe: false to leave the gesture off, for an embed sitting inside something that
 *      already swipes - two handlers on nested elements would both fire and the page
 *      would move twice at once. */
export function renderChartBrowser(container, state, opts = {}) {
  const { empty = 'Nothing has been published yet.', swipe = true } = opts;
  const spreads = chartSpreads(state);
  let at = spreadIndexForNow(spreads);

  const draw = () => {
    const spread = spreads[at];
    if (!spread) {
      container.innerHTML = `<p class="hint">${empty}</p>`;
      return;
    }
    const label = spreadLabel(spread);
    container.innerHTML = `
      <div class="week-nav no-print">
        <div class="week-nav-when">
          ${chartEsc(label.english)}
          <bdi class="week-nav-hebrew">${chartEsc(label.hebrew)}</bdi>
        </div>
        <div class="week-nav-row">
          <button type="button" class="chart-prev" ${at <= 0 ? 'disabled' : ''}>
            <span aria-hidden="true">&larr;</span><span class="week-nav-word">Previous</span>
          </button>
          <button type="button" class="chart-today">Today</button>
          <button type="button" class="chart-next" ${at >= spreads.length - 1 ? 'disabled' : ''}>
            <span class="week-nav-word">Next</span><span aria-hidden="true">&rarr;</span>
          </button>
        </div>
        <!-- The congregation's own chart page has carried this since it was built; this
             screen, which shows the same chart, never did. A chart is letter landscape and
             a phone's print dialog opens portrait, which puts an 11in page on an 8.5in
             sheet and trims the right hand edge: the parsha column loses a letter and the
             rabbi's line above it loses two. Shown only on a touch device, like the other
             one: see .print-hint in app.css. -->
        <p class="print-hint no-print">The chart prints landscape. If the print dialog opens portrait, change it in its options.</p>
      </div>
      <div class="pages"></div>`;
    const pagesEl = container.querySelector('.pages');
    const shabbos = buildSheetPages(spread.sheet, state, () => {}, { readOnly: true });
    const chol = buildSheetPages(spread.weekday, state, () => {}, { readOnly: true });
    for (const page of [shabbos[spread.index], chol[spread.index]]) if (page) pagesEl.appendChild(page);
    syncPageHeights(pagesEl);
    attachPagePrintToAll(pagesEl, '.page', 'Print this page');
    fitChartToWindow(pagesEl);

    const go = (next) => {
      if (next < 0 || next >= spreads.length) return;
      at = next;
      draw();
    };
    container.querySelector('.chart-prev')?.addEventListener('click', () => go(at - 1));
    container.querySelector('.chart-next')?.addEventListener('click', () => go(at + 1));
    container.querySelector('.chart-today')?.addEventListener('click', () => go(spreadIndexForNow(spreads)));
    if (swipe) wireSwipe(container, () => go(at - 1), () => go(at + 1));
  };
  draw();
}

function chartEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
