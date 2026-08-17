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
import { renderWeek, currentSerial } from './ui/week-view.js';
import { buildSheetPages, syncPageHeights } from './ui/sheet-view.js';
import { attachPagePrintToAll } from './ui/print-page.js';
import { splitWeeksIntoPages } from './pagination.js';

const main = document.getElementById('main');

/** The Shabbos sheet covering today, or the nearest one. Everything on the site is about
 *  "now", so this is what both the week page and the chart open on. */
function currentSheet(published) {
  const seasons = published.sheets.filter((s) => s.season !== 'weekday');
  const today = Date.now();
  const spans = seasons.map((sheet) => {
    const dates = sheet.weeks.map((w) => new Date(w.date).getTime());
    return { sheet, from: Math.min(...dates), to: Math.max(...dates) };
  });
  const covering = spans.find((s) => today >= s.from && today <= s.to);
  if (covering) return covering.sheet;
  // Otherwise whichever season starts next, or failing that the most recent one.
  const upcoming = spans.filter((s) => s.from > today).sort((a, b) => a.from - b.from)[0];
  return (upcoming || spans.sort((a, b) => b.to - a.to)[0])?.sheet || null;
}

function backBar(title) {
  return `<div class="luach-bar no-print">
    <a class="luach-back" href="#">&larr; Menu</a>
    <span class="luach-bar-title">${esc(title)}</span>
    <button type="button" class="btn-primary" id="print-btn">Print all</button>
  </div>`;
}

function homeHtml(published) {
  const s = published.settings;
  return `<div class="luach-home">
    <header class="luach-masthead">
      <img class="luach-logo" src="/assets/logo-text.png" alt="${esc(s.shulName)}">
      ${s.headerSubtitle ? `<p class="luach-place">${esc(s.headerSubtitle)}</p>` : ''}
    </header>
    <nav class="luach-menu">
      <a class="luach-item" href="#week">
        <span class="luach-item-title">זמני השבוע</span>
        <span class="luach-item-sub">This week's times, with the weekday schedule. Print or save it.</span>
      </a>
      <a class="luach-item" href="#chart">
        <span class="luach-item-title">לוח הזמנים לכל העונה</span>
        <span class="luach-item-sub">The part of the wall chart covering now. Print or save it.</span>
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
    main.innerHTML = backBar("This week's times") + '<div id="week-host"></div>';
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

function renderChartPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  const sheet = currentSheet(published);
  const weekday = published.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet?.id);
  main.innerHTML = backBar('The chart') + '<div id="pages" class="pages"></div>';
  const pagesEl = main.querySelector('#pages');
  if (!sheet) {
    pagesEl.innerHTML = '<p class="hint">Nothing has been published yet.</p>';
    return;
  }
  // Only the stretch of the season we are actually in. A season chart runs to three
  // pages, and handing a congregant all of them means finding the right one before
  // reading a single time. The page breaks of the two charts fall on the same dates
  // (alignPageSizesTo at generation time), so one index picks the matching pair: the
  // שבת page and its Weekday page, in the order they print.
  const shabbos = buildSheetPages(sheet, state, () => {}, { readOnly: true });
  const chol = buildSheetPages(weekday, state, () => {}, { readOnly: true });
  const i = pageIndexForNow(sheet);
  for (const page of [shabbos[i], chol[i]]) if (page) pagesEl.appendChild(page);
  syncPageHeights(pagesEl);
  attachPagePrintToAll(pagesEl, '.page', 'Print this page');
  fitPagesToWindow(pagesEl);
  main.querySelector('#print-btn').addEventListener('click', () => window.print());
}

/** Which page of a chart covers now: the one holding the same week the week page opens
 *  on, so the two views of the site never disagree about which Shabbos is "this" one.
 *  Falls back to the first page for a season that has not started or is already over. */
function pageIndexForNow(sheet) {
  const target = currentSerial(sheet.weeks.map((w) => w.serial));
  const pages = splitWeeksIntoPages(sheet.weeks, sheet.pageSizes);
  const index = pages.findIndex((page) => page.some((w) => w.serial === target));
  return index === -1 ? 0 : index;
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
