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
import { renderWeek } from './ui/week-view.js';
import { renderChartBrowser } from './ui/chart-view.js';

const main = document.getElementById('main');


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

function renderChartPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  main.innerHTML = backBar('The chart') + '<div id="chart-host"></div>';
  main.querySelector('#print-btn').addEventListener('click', () => window.print());
  renderChartBrowser(main.querySelector('#chart-host'), state);
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
