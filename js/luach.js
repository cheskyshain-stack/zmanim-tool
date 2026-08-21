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
import { wireSecretDoor } from './ui/nav-helpers.js';
import { renderWeek } from './ui/week-view.js';
import { renderChartBrowser } from './ui/chart-view.js';

const main = document.getElementById('main');


/* The two marks on the menu, and the chevron on the end of each. The clock goes on the
   week, which is a list of times, and the calendar on the chart, which is the whole
   season laid out by date. Inline rather than image files: they are three small shapes,
   they take their colour from the text beside them, and a file each would be three more
   things to fetch on a page whose whole point is opening fast on a phone. aria-hidden
   because the words beside them already say it. */
const ICON_CALENDAR = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
  <rect x="3" y="5" width="18" height="16" rx="2.6"/><path d="M8 2.6v4M16 2.6v4M3 10h18"/>
  <path d="M7.6 13.6h.01M12 13.6h.01M16.4 13.6h.01M7.6 17.4h.01M12 17.4h.01M16.4 17.4h.01" stroke-width="2.3"/>
</svg>`;
const ICON_CLOCK = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9.1"/><path d="M12 6.6v5.7l3.6 2.1"/>
</svg>`;
const CHEVRON = `<svg class="luach-item-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5l7.5 7.5L9 19.5"/></svg>`;

/** The two things this site offers, named once.
 *
 *  The button on the menu and the bar at the top of the page it opens say the same words,
 *  so pressing one lands somewhere that confirms what you pressed. They used to disagree:
 *  Weekly Zmanim opened a page headed "This week's schedule" and Zmanim chart opened one
 *  headed "The chart", which is two names for each of two things on a site that only has
 *  two things. Written here rather than in both places, so they cannot drift apart again. */
const PAGE_NAMES = { week: 'Weekly Zmanim', chart: 'Zmanim chart' };

/** A gold hairline with a diamond in the middle. Decoration, so it says nothing to a
 *  screen reader. */
const rule = () => '<div class="luach-rule" aria-hidden="true"><i></i></div>';

/** The navy cap at the top of every screen here, curved and edged in gold. It carries
 *  nothing on the menu and the way back on the pages behind it, so that going in and
 *  coming out look like one site. */
function backBar(title) {
  return `<div class="luach-bar no-print">
    <a class="luach-back" href="#">&larr; Menu</a>
    <span class="luach-bar-title">${esc(title)}</span>
  </div>`;
}

/** The masthead is a sibling of the menu rather than sitting inside it, so that its navy
 *  band reaches both edges of the window the way the band on the pages behind it does. In
 *  the middle of the centred column it stopped at the column's own 34rem and read as a
 *  navy card floating in the page: measured at 1280px, it ran 352 to 928 instead of 0 to
 *  1280. On a phone the two are the same thing, which is how it went unnoticed. */
function homeHtml(published) {
  const s = published.settings;
  return `<div class="luach-bar luach-bar-plain no-print" aria-hidden="true"></div>
    <header class="luach-masthead">
      <img class="luach-logo" src="/assets/logo-text-navy.png" alt="${esc(s.shulName)}">
      ${s.headerSubtitle ? `${rule()}<p class="luach-place">${esc(s.headerSubtitle)}</p>` : ''}
    </header>
    <div class="luach-home">
    <nav class="luach-menu">
      <a class="luach-item" href="#week">
        ${ICON_CLOCK}<span class="luach-item-title">${esc(PAGE_NAMES.week)}</span>${CHEVRON}
      </a>
      <a class="luach-item" href="#chart">
        ${ICON_CALENDAR}<span class="luach-item-title">${esc(PAGE_NAMES.chart)}</span>${CHEVRON}
      </a>
    </nav>
    ${rule()}
    <p class="luach-foot">${esc(s.footerAddress)}</p>
  </div>`;
}

function renderHome(published) {
  // The menu, and only the menu, is laid out to fill the screen (see is-home in app.css).
  // The pages behind it are as tall as the board on them and must not be stretched.
  main.className = 'is-home';
  main.innerHTML = homeHtml(published);
  openTheDoor();
}

/** Three taps in the navy cap go to the generator. Wired after every render, since each
 *  one builds a new cap. */
function openTheDoor() {
  wireSecretDoor(main.querySelector('.luach-bar'), '/admin/');
}

function renderWeekPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  let serial = null;
  const draw = () => {
    main.className = '';
    main.innerHTML = backBar(PAGE_NAMES.week) + '<div id="week-host"></div>';
    openTheDoor();
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
  };
  draw();
}

function renderChartPage(published) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  main.className = '';
  main.innerHTML = backBar(PAGE_NAMES.chart) + '<div id="chart-host"></div>';
  openTheDoor();
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
