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
import { printButtonHtml, wirePrintButton } from './print-page.js';
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
 *  (see print.css), since paper has no such problem.
 *
 *  transform rather than zoom, and this is the one place in the app where that is the
 *  right way round. zoom will not paint a border thinner than a pixel however far it
 *  scales, so at 0.34 on a phone the grid's 1px rules stayed a full pixel wide while the
 *  cells around them shrank to a third, and the chart came out looking ruled in black.
 *  Fading the colour was tried first and reverted: it cannot reach the width, so it only
 *  turned a heavy line into a pale one of the same thickness, which reads worse. A
 *  transform scales the rule with everything else. Measured on a phone at this scale,
 *  reading the painted pixels: zoom draws 3 device pixels at contrast 91, transform draws
 *  2 at contrast 47, and the second is 94 units of ink against the 93 the design asks for.
 *
 *  What zoom gave for free was the layout: it shrinks the box as well as the paint, while
 *  a transform leaves the original footprint behind and would reserve 11in of width and
 *  the full height on a phone. So the wrapper is sized here instead, to what the transform
 *  actually covers, and clipped. Hence .pages-fit existing at all.
 *
 *  Measured once, this fits whatever the page happened to be at that instant. The Hebrew
 *  serifs are loaded with font-display: swap, so on a slow connection the first paint is
 *  in a fallback and the real font arrives afterwards at a different width - the fit was
 *  then a frame too early and stayed wrong. Re-fit when the fonts land, and once more on
 *  the next frame for anything else that settles late. Every pass starts by clearing what
 *  the last one set, so re-running it is not cumulative. */
function fitChartToWindow(pagesEl) {
  const fit = pagesEl.parentElement;
  const apply = () => {
    if (!document.body.contains(pagesEl)) return;
    pagesEl.style.transform = '';
    pagesEl.style.width = '';
    if (fit) { fit.style.height = ''; fit.style.overflow = ''; }
    const available = fit ? fit.clientWidth : pagesEl.clientWidth;
    const content = pagesEl.scrollWidth;
    if (!available || content <= available) return;
    const scale = available / content;
    // Held at its natural width, or the transform would scale a box that had already
    // shrunk to the window and the page would come out at the square of the scale.
    pagesEl.style.width = `${content}px`;
    pagesEl.style.transformOrigin = 'top left';
    pagesEl.style.transform = `scale(${scale.toFixed(4)})`;
    if (fit) {
      fit.style.height = `${Math.ceil(pagesEl.scrollHeight * scale)}px`;
      fit.style.overflow = 'hidden';
    }
  };
  apply();
  requestAnimationFrame(apply);
  document.fonts?.ready?.then(apply);
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
        <div class="week-nav-row week-nav-print-one">${printButtonHtml()}</div>
      </div>
      <div class="pages-fit"><div class="pages"></div></div>`;
    const pagesEl = container.querySelector('.pages');
    const shabbos = buildSheetPages(spread.sheet, state, () => {}, { readOnly: true });
    const chol = buildSheetPages(spread.weekday, state, () => {}, { readOnly: true });
    for (const page of [shabbos[spread.index], chol[spread.index]]) if (page) pagesEl.appendChild(page);
    syncPageHeights(pagesEl);
    fitChartToWindow(pagesEl);

    const go = (next) => {
      if (next < 0 || next >= spreads.length) return;
      at = next;
      draw();
    };
    wirePrintButton(container);
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
