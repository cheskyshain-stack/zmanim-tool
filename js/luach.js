// The congregation's site, which is the front door: lczmanim.cjaffa.com. The admin app
// lives at /admin and none of it is loaded here.
//
// Everything shown comes from /data/published.json, because a visitor's browser has none
// of the admin app's saved sheets. Until a season is published there is nothing to show,
// which the page says plainly rather than looking broken.
//
// Where it goes is in the URL hash (#week, #chart), so the browser's back button works
// and a page can be linked to directly, with no server configuration to arrange.
import { loadPublished } from './publish.js';
import { renderWeek, currentSerial, wireSwipe } from './ui/week-view.js';
import { buildSheetPages, syncPageHeights } from './ui/sheet-view.js';
import { attachPagePrintToAll } from './ui/print-page.js';
import { splitWeeksIntoPages } from './pagination.js';
import { dateFromSerial } from './zmanim/solar.js';

const main = document.getElementById('main');


function backBar(title, hint) {
  return `<div class="luach-bar no-print">
    <a class="luach-back" href="#">&larr; Menu</a>
    <span class="luach-bar-title">${esc(title)}</span>
    <button type="button" class="btn-primary" id="print-btn">Print all</button>
  </div>${hint ? `<p class="print-hint no-print">${esc(hint)}</p>` : ''}`;
}

/** Said next to anything that has to come out landscape. A phone hands printing to the
 *  system dialog, which carries its own paper size and orientation and does not take them
 *  from the page, so the chart arrives portrait unless the person changes it there. On a
 *  computer the browser follows the stylesheet and there is nothing to do (checked: the
 *  chart prints 792x612 and a week card 612x792, each without being asked). */
const LANDSCAPE_HINT = 'The chart prints landscape. If the print dialog opens portrait, change it in its options.';

function homeHtml(published) {
  const s = published.settings;
  return `<div class="luach-home">
    <header class="luach-masthead">
      <img class="luach-logo" src="/assets/logo-text.png" alt="${esc(s.shulName)}">
      ${s.headerSubtitle ? `<p class="luach-place">${esc(s.headerSubtitle)}</p>` : ''}
    </header>
    <nav class="luach-menu">
      <a class="luach-item" href="#week">
        <span class="luach-item-title">Weekly Zmanim</span>
        <span class="luach-item-sub">This week's schedule, שבת and weekday. Print or save it.</span>
      </a>
      <a class="luach-item" href="#chart">
        <span class="luach-item-title">Zmanim chart</span>
        <span class="luach-item-sub">The wall chart, opening on the stretch covering now. Page through it, print or save it.</span>
      </a>
    </nav>
    <p class="luach-foot">${esc(s.footerAddress)}</p>
  </div>`;
}

function renderHome(published) {
  main.innerHTML = homeHtml(published);
}

function renderWeekPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  let serial = null;
  const draw = () => {
    main.innerHTML = backBar("This week's schedule") + '<div id="week-host"></div>';
    renderWeek(
      main.querySelector('#week-host'),
      state,
      (next) => {
        serial = next;
        draw();
      },
      serial,
      { luach: true }
    );
    main.querySelector('#print-btn').addEventListener('click', () => window.print());
  };
  draw();
}

/** Every stretch of chart there is to look at, in date order: one entry per page of each
 *  published season, carrying the שבת page and the Weekday page that go together.
 *
 *  The page breaks of the two charts fall on the same dates (alignPageSizesTo at
 *  generation time), so one index picks the matching pair. Seasons are ordered by the
 *  week they start on, so paging forward runs קיץ into חורף the way the year does. */
function chartSpreads(published) {
  const seasons = published.sheets.filter((s) => s.season !== 'weekday');
  const spreads = [];
  for (const sheet of seasons) {
    const weekday = published.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
    splitWeeksIntoPages(sheet.weeks, sheet.pageSizes).forEach((weeks, index) => {
      if (!weeks.length) return;
      spreads.push({ sheet, weekday, index, serials: weeks.map((w) => w.serial) });
    });
  }
  return spreads.sort((a, b) => Math.min(...a.serials) - Math.min(...b.serials));
}

/** The spread covering now: the one holding the same week the week page opens on, so the
 *  two views of the site never disagree about which Shabbos is "this" one. */
function spreadIndexForNow(spreads) {
  if (!spreads.length) return 0;
  const target = currentSerial(spreads.flatMap((s) => s.serials));
  const found = spreads.findIndex((s) => s.serials.includes(target));
  return found === -1 ? 0 : found;
}

/** What a spread covers, for the line above the buttons. */
function spreadLabel(spread) {
  const range = [Math.min(...spread.serials), Math.max(...spread.serials)].map((serial) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(dateFromSerial(serial))
  );
  return range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`;
}

function renderChartPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  const spreads = chartSpreads(published);
  // Which stretch is showing. A season chart runs to three pages and there can be two
  // seasons up at once; handing a congregant all of them means finding the right one
  // before reading a single time, so it opens on the one covering now and pages from
  // there, exactly as the week page does.
  let at = spreadIndexForNow(spreads);

  const draw = () => {
    const spread = spreads[at];
    main.innerHTML =
      backBar('The chart', LANDSCAPE_HINT) +
      (spread
        ? `<div class="week-nav no-print">
             <div class="week-nav-when">${esc(spreadLabel(spread))}</div>
             <div class="week-nav-row">
               <button type="button" id="chart-prev" ${at <= 0 ? 'disabled' : ''}>
                 <span aria-hidden="true">&larr;</span><span class="week-nav-word">Previous</span>
               </button>
               <button type="button" id="chart-today">Today</button>
               <button type="button" id="chart-next" ${at >= spreads.length - 1 ? 'disabled' : ''}>
                 <span class="week-nav-word">Next</span><span aria-hidden="true">&rarr;</span>
               </button>
             </div>
           </div>`
        : '') +
      '<div id="pages" class="pages"></div>';
    const pagesEl = main.querySelector('#pages');
    main.querySelector('#print-btn').addEventListener('click', () => window.print());
    if (!spread) {
      pagesEl.innerHTML = '<p class="hint">Nothing has been published yet.</p>';
      return;
    }
    const shabbos = buildSheetPages(spread.sheet, state, () => {}, { readOnly: true });
    const chol = buildSheetPages(spread.weekday, state, () => {}, { readOnly: true });
    for (const page of [shabbos[spread.index], chol[spread.index]]) if (page) pagesEl.appendChild(page);
    syncPageHeights(pagesEl);
    attachPagePrintToAll(pagesEl, '.page', 'Print this page');
    fitPagesToWindow(pagesEl);

    const go = (next) => {
      if (next < 0 || next >= spreads.length) return;
      at = next;
      draw();
    };
    main.querySelector('#chart-prev')?.addEventListener('click', () => go(at - 1));
    main.querySelector('#chart-next')?.addEventListener('click', () => go(at + 1));
    main.querySelector('#chart-today')?.addEventListener('click', () => go(spreadIndexForNow(spreads)));
    // Swipe as well, the same gesture and the same thresholds as the week page.
    wireSwipe(main, () => go(at - 1), () => go(at + 1));
  };
  draw();
}


/** A chart page is a fixed 11in wide, so on anything narrower it is scaled down rather
 *  than scrolled sideways: a congregant should see a whole page at once. Print resets it
 *  (see print.css), since paper has no such problem. */
function fitPagesToWindow(pagesEl) {
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

function route(published) {
  const where = location.hash.replace('#', '');
  if (where === 'week') return renderWeekPage(published);
  if (where === 'chart') return renderChartPage(published);
  return renderHome(published);
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const published = await loadPublished();
  if (!published) {
    main.innerHTML = '<div class="luach-home"><p class="hint">Nothing has been published yet.</p></div>';
    return;
  }
  route(published);
  window.addEventListener('hashchange', () => route(published));
})();
