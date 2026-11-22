// Reading the wall chart on a screen: one stretch of it at a time, with Previous, Today
// and Next above it.
//
// A season chart has two parts, or three in a leap-year winter.
// Open on the newest released stretch, retaining the previous chart below it.
// It is the same rendering the printed chart uses (buildSheetPages), read-only
// - a second renderer would be a second thing to keep in step with the formulas.
//
// Shared between the congregation's site and the admin's This week screen, so the two
// cannot drift apart.
import { resolveSettings } from '../settings.js';
import { keepPosition } from './keep-position.js';
import { weekEndsMins } from '../upcoming.js';
import { buildSheetPages, buildCombinedChartPages, chartPaperFitter } from './sheet-view.js';
import { chartPrintLayout, chartPrintLayoutHtml, rememberChartPrintLayout, isCombinedChartLayout, chartPrintSize } from './chart-print-layout.js';
import { wireCombinedChartPrint } from './combined-chart-print.js';
import { printButtonHtml, wirePrintButton, setPrintPage } from './print-page.js';
import { pdfButtonHtml, wirePdfButton } from './pdf-page.js';
import { splitWeeksIntoPages } from '../pagination.js';
import { currentSerial, wireSwipe, wireSecretTaps, navUnlocked, unlockNav } from './nav-helpers.js';
import { jewishDateString } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import { useStraightHebrewQuotes } from '../util.js';
import { wireChartCurrentWeek } from './chart-week-indicator.js';

/** Every stretch of chart there is to look at, in date order: one entry per page of each
 *  season, carrying the שבת page and the Weekday page that go together.
 *
 *  The page breaks of the two charts fall on the same dates (alignPageSizesTo at
 *  generation time), so one index picks the matching pair. Seasons are ordered by the
 *  week they start on, so paging forward runs קיץ into חורף the way the year does.
 *
 *  `serials` carries both pages' own weeks, not just the שבת side's - the Weekday page can
 *  run a week or more past it, its trailing-gap or Chol Hamoed row anchored on a Yom Tov
 *  that has no שבת row of its own (see sheets/weeks.js). Left out, spreadLabel's printed
 *  date range undersold what was actually on the page: a שבוע של סוכות row hanging off the
 *  bottom of a page labelled "... to September 19" when that row's own days ran to
 *  September 26. Math.min (a page's own start) never moves for this, since the Weekday
 *  page starts on the same date the שבת page does; only Math.max can. */
export function chartSpreads(state) {
  const spreads = [];
  for (const sheet of state.sheets.filter((s) => s.season !== 'weekday')) {
    const weekday = state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
    const weekdayPages = weekday ? splitWeeksIntoPages(weekday.weeks, weekday.pageSizes) : [];
    splitWeeksIntoPages(sheet.weeks, sheet.pageSizes).forEach((weeks, index) => {
      if (!weeks.length) return;
      const weekdayWeeks = weekdayPages[index] || [];
      const serials = [...weeks, ...weekdayWeeks].map((w) => w.serial);
      spreads.push({ sheet, weekday, index, serials });
    });
  }
  return spreads.sort((a, b) => Math.min(...a.serials) - Math.min(...b.serials));
}

/** How many days early a chart goes up: a page is "now" from a week before its own first
 *  week starts. Shared with chartStretchSerials in week-view.js, which the doc comment on
 *  spreadIndexForNow below explains has to agree with this one. */
export const CHART_EARLY_DAYS = 7;

/** The latest spread released, including its early-release week.
 *
 *  A chart page owns from seven days before its own first week until seven days before the
 *  next page's first week, which is the span chartStretchSerials already gives the week
 *  view (CHART_EARLY_DAYS, shared so the two can't drift). A span rather than a list of
 *  rows for one reason: a Shabbos that is yom tov has no parsha and so no row on either
 *  chart, and the summer chart is what is hanging on the wall through it.
 *
 *  So this asks every Shabbos of the year which week it is now, not just the ones that have
 *  a row, and looks for the last page whose first week starts within the next
 *  CHART_EARLY_DAYS days (or has already started).
 *
 *  The shul asked for a chart to post a week before its own first date, everywhere,
 *  including the turn into בראשית: asked of the rows it was three weeks out before this,
 *  since after שבת האזינו the next row there is is שבת בראשית, so the winter chart used to
 *  wait for the Sunday of בראשית before it would show at all. It now goes up on the
 *  Shabbos of שובה instead, a week ahead of its own first Shabbos, same as every other
 *  season boundary - the week card can show סוכות a week longer than the chart does over
 *  that one transition, which is the accepted cost of one rule holding everywhere rather
 *  than a special case for this turn alone.
 *
 *  Both views now read the turn the same way, off the same list of page starts, so neither
 *  can be on a different chart from the other.
 *
 *  Exported so the admin's own status panel can say which chart is up without drawing the
 *  page: see js/ui/status-view.js. A third reader of the same number rather than a second
 *  way of asking it. */
export function spreadIndexForNow(spreads, state, settings, earlyDays = CHART_EARLY_DAYS) {
  if (!spreads.length) return 0;
  const all = spreads.flatMap((s) => s.serials);
  /* Every Shabbos from the first charted one to the last. They are seven days apart, so
     counting by seven off a Shabbos gives Shabbosos and nothing else. */
  const everyWeek = [];
  for (let s = Math.min(...all); s <= Math.max(...all); s += 7) everyWeek.push(s);
  const target = currentSerial(everyWeek, settings, (s) => weekEndsMins(s, state, settings));
  const starts = spreads.map((s) => Math.min(...s.serials));
  let found = -1;
  for (let n = 0; n < starts.length; n++) {
    if (starts[n] - earlyDays <= target) found = n;
  }
  return found === -1 ? 0 : found;
}

/** Identify the part needed this week and the next part released early. */
export function chartDisplayForNow(spreads, state, settings) {
  const current = spreadIndexForNow(spreads, state, settings, 0);
  const available = spreadIndexForNow(spreads, state, settings);
  return { current, upcoming: available > current ? available : null };
}

/** The span of weeks the chart that is live right now actually reaches: from
 *  CHART_EARLY_DAYS before its own first week to CHART_EARLY_DAYS before the next page's
 *  first week, or forever on the last page there is. Anchored on real now, the same target
 *  spreadIndexForNow asks, rather than on whatever week a caller happens to be looking at -
 *  a week browsed away from today must not borrow "is a chart live" from whichever season
 *  was live back then, which would send someone to today's chart under the belief it was
 *  showing the week they were reading.
 *
 *  See hasChart in weekly-reader.js: a Yom Tov week with no row of its own is still worth
 *  a live "Zmanim Chart" link once the next chart has come up seven days early and is
 *  already showing something, rather than staying greyed out on a technicality now that
 *  the chart itself no longer waits for that week to end. */
export function liveChartRange(state, settings) {
  const spreads = chartSpreads(state);
  if (!spreads.length) return null;
  const starts = spreads.map((s) => Math.min(...s.serials));
  const at = spreadIndexForNow(spreads, state, settings);
  const nextStart = starts[at + 1] ?? Infinity;
  return {
    from: starts[at] - CHART_EARLY_DAYS,
    until: nextStart === Infinity ? Infinity : nextStart - CHART_EARLY_DAYS,
  };
}

/** What a spread covers, for the line above the buttons: the first and last Shabbos on
 *  it, in both calendars, the way the week view names its week.
 *
 *  The Hebrew pair goes on its own line in its own direction. Run into the English one it
 *  would be reordered against it, and inside a right-to-left line the earlier date sits
 *  on the right, which is the order it is read in. */
export function spreadLabel(spread) {
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
function fitChartToWindow(pagesEl, printSize, combinedPrint) {
  let disposed = false, frame;
  const fit = pagesEl.parentElement;
  const fitPaper = chartPaperFitter(pagesEl, { height: printSize.height, combined: combinedPrint });
  const apply = () => keepPosition(pagesEl.parentElement, () => {
    if (disposed || !document.body.contains(pagesEl)) return;
    pagesEl.style.transform = '';
    pagesEl.style.width = '';
    if (fit) { fit.style.height = ''; fit.style.overflow = ''; }
    fitPaper();
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
  }, { panels: false, focus: false });
  apply();
  frame = requestAnimationFrame(apply);
  document.fonts?.ready?.then(apply);
  const beforePrint = () => { if (!disposed && pagesEl.getClientRects().length) fitPaper(); };
  window.addEventListener('resize', apply);
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', apply);
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    window.removeEventListener('resize', apply);
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', apply);
  };
}

/** @param {object} opts
 *    - empty: what to say when there is no chart to show at all
 *    - highlightCurrentWeek: screen-only indicators for the congregation page
 *    - showUpcoming: show the newly released pair above the previous pair
 *    - swipe: false for an embed that already has its own swipe handler
 *    - confine: hide browsing until the reader uses the three-tap gesture */
export function renderChartBrowser(container, state, opts = {}) {
  container._chartCurrentWeekCleanup?.();
  const { empty = 'Nothing has been published yet.', swipe = true, confine = false, highlightCurrentWeek = false, showUpcoming = false } = opts;
  const disposers = [];
  const clearDraw = () => { disposers.splice(0).forEach(dispose => dispose()); container._weekSwipeOff?.(); };
  const cleanup = () => clearDraw();
  container._chartCurrentWeekCleanup = cleanup;
  const spreads = chartSpreads(state);
  const settings = resolveSettings(state.settings);
  const liveSelection = () => showUpcoming ? chartDisplayForNow(spreads, state, settings)
    : { current: spreadIndexForNow(spreads, state, settings), upcoming: null };
  const liveKey = selection => `${selection.current}:${selection.upcoming}`;
  const defaultIndex = selection => selection.upcoming ?? selection.current;
  let at = defaultIndex(liveSelection());
  let printLayout = chartPrintLayout();

  const draw = () => keepPosition(container, () => {
    clearDraw();
    const held = confine && !navUnlocked();
    const selection = liveSelection(), displayedKey = liveKey(selection);
    const spread = spreads[at];
    if (!spread) { container.innerHTML = `<p class="hint">${empty}</p>`; return; }
    const previous = at === defaultIndex(selection) && selection.upcoming !== null ? spreads[selection.current] : null;
    const activeLayout = spread.weekday ? printLayout : 'separate';
    const combinedPrint = isCombinedChartLayout(activeLayout);
    const printSize = chartPrintSize(activeLayout);
    setPrintPage(printSize.css);
    const label = spreadLabel(spread);
    const nav = `
      <div class="week-nav no-print">
        <div class="week-nav-when">
          ${chartEsc(label.english)}
          <bdi class="week-nav-hebrew" lang="he">${chartEsc(label.hebrew)}</bdi>
        </div>
        ${held ? '' : `<div class="week-nav-row">
          <button type="button" class="chart-prev" ${at <= 0 ? 'disabled' : ''}>
            <span aria-hidden="true">&larr;</span><span class="week-nav-word">Previous</span>
          </button>
          <button type="button" class="chart-today">Today</button>
          <button type="button" class="chart-next" ${at >= spreads.length - 1 ? 'disabled' : ''}>
            <span class="week-nav-word">Next</span><span aria-hidden="true">&rarr;</span>
          </button>
        </div>`}
        <div class="week-nav-row week-nav-print-one">${chartPrintLayoutHtml(activeLayout, Boolean(spread.weekday))}${printButtonHtml()}${pdfButtonHtml()}</div>
      </div>
      <div class="pages-fit"><div class="pages"></div></div>`;
    container.innerHTML = showUpcoming ? `<section class="chart-spread" data-chart-current>${previous ? '<h2 class="chart-spread-title no-print">New chart</h2>' : ''}${nav}</section>` : nav;
    const primary = container.querySelector('[data-chart-current]') || container;
    if (previous) {
      const previousLabel = spreadLabel(previous);
      container.insertAdjacentHTML('beforeend', `<section class="chart-spread is-chart-print-hidden" data-chart-previous aria-label="Previous chart">
        <h2 class="chart-spread-title no-print">Previous chart</h2>
        <div class="week-nav no-print"><div class="week-nav-when">${chartEsc(previousLabel.english)}<bdi class="week-nav-hebrew" lang="he">${chartEsc(previousLabel.hebrew)}</bdi></div>
          <div class="week-nav-row week-nav-print-one">${printButtonHtml('chart-previous-print')}${pdfButtonHtml('chart-previous-pdf')}</div>
        </div><div class="pages-fit"><div class="pages"></div></div>
      </section>`);
    }
    useStraightHebrewQuotes(container);
    // Keep the selection until the next print or redraw: Android can return from
    // window.print before its preview has finished reading the document.
    const selectPrint = scope => container.querySelectorAll('.chart-spread').forEach(section => section.classList.toggle('is-chart-print-hidden', section !== scope));
    const watchWeek = () => {
      const next = liveSelection();
      if (confine && !navUnlocked() && (defaultIndex(next) !== at || liveKey(next) !== displayedKey)) {
        at = defaultIndex(next); draw(); return true;
      }
      return false;
    };
    function fill(scope, entry, printId, pdfId, watch) {
      const pagesEl = scope.querySelector('.pages');
      const shabbos = combinedPrint ? buildCombinedChartPages(entry.sheet, entry.weekday, state, { readOnly: true, printLayout: activeLayout })
        : buildSheetPages(entry.sheet, state, { readOnly: true });
      const chol = combinedPrint ? [] : buildSheetPages(entry.weekday, state, { readOnly: true });
      for (const page of [shabbos[entry.index], chol[entry.index]]) if (page) pagesEl.appendChild(page);
      disposers.push(fitChartToWindow(pagesEl, printSize, combinedPrint));
      if (highlightCurrentWeek) disposers.push(wireChartCurrentWeek(scope, state, settings, watch));
      scope.querySelector(`#${printId}`)?.addEventListener('click', () => selectPrint(scope));
      wirePrintButton(scope, printId);
      wirePdfButton(scope, { id: pdfId, host: () => pagesEl, name: () => pdfName(spreadLabel(entry).english),
        sheet: '.page', orientation: 'landscape', size: [printSize.width, printSize.height] });
      if (held) wireSecretTaps(pagesEl, () => { unlockNav(); draw(); });
    }
    fill(primary, spread, 'print-btn', 'pdf-btn', watchWeek);
    if (previous) fill(container.querySelector('[data-chart-previous]'), previous, 'chart-previous-print', 'chart-previous-pdf');
    container.querySelector('#chart-print-layout').addEventListener('change', event => {
      rememberChartPrintLayout(event.target.value); printLayout = chartPrintLayout(); draw();
    });
    wireCombinedChartPrint();
    const go = next => { if (next >= 0 && next < spreads.length) { at = next; draw(); } };
    container.querySelector('.chart-prev')?.addEventListener('click', () => go(at - 1));
    container.querySelector('.chart-next')?.addEventListener('click', () => go(at + 1));
    container.querySelector('.chart-today')?.addEventListener('click', () => go(defaultIndex(liveSelection())));
    if (swipe && !held) wireSwipe(container, () => go(at - 1), () => go(at + 1));
  });
  draw();
  return cleanup;
}

/** A filename from the spread's own dates: "Zmanim July 25 2026 to September 19 2026.pdf".
 *  Everything a filesystem or a mail client might object to comes out, which on a date
 *  string is the commas. */
function pdfName(english) {
  const plain = String(english).replace(/[^A-Za-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  return `Zmanim ${plain}.pdf`;
}

function chartEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
