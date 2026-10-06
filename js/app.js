import { buildAutomaticCharts } from './publish.js';
import { loadState, saveState } from './storage.js';
import { loadTables, showDataError } from './data-loader.js';
import { renderSettings } from './ui/settings-view.js';
import { renderGenerate } from './ui/generate-view.js';
import { renderSavedSheets } from './ui/saved-sheets-view.js';
import { renderSheet } from './ui/sheet-view.js';
import { renderGuide } from './ui/guide-view.js';
import { renderProgram } from './ui/program-view.js';
import { renderPosters, posterRoute, setPosterRoute } from './ui/posters-view.js';
import { renderCalculations } from './ui/calculations-view.js';
import { renderWeek } from './ui/week-view.js';
import { renderChartBrowser } from './ui/chart-view.js';
import { renderTraffic } from './ui/traffic-view.js';
import { renderStatus } from './ui/status-view.js';
import { renderAdminHome, ADMIN_NAV_SECTIONS, ADMIN_TAB_LABELS } from './ui/admin-home.js';
import { wireSecretDoor } from './ui/nav-helpers.js';
import { isOpen, renderLock } from './ui/lock.js';
import { installTimeExplanations } from './ui/time-explanations.js';

const state = loadState();
let tables = null;
let currentTab = 'home';
let adminStarted = false;
let currentSheetId = null;
// Which week the This week screen is showing. Null follows whichever Shabbos is next;
// the prev/next buttons pin it to one.
let weekSerial = null;
// Set when This week is opened from "Publishing" on Saved sheets, so the panel it wants
// is already open when the screen arrives. Cleared as it is used: it describes one trip.
let openPublish = false;
// Which half of This week is showing: 'week' for the week's two pages, 'chart' for the
// wall chart. The same two things the congregation's site offers from its menu, and one
// at a time here for the same reason: they page by different units (a week against a
// stretch of season), so stacked they gave the screen two sets of buttons doing
// different things.
let weekPane = 'week';

// Chrome hijacks the mouse wheel for any focused <input type=number> (scrolling over it
// changes its value instead of scrolling the page) - on a long form like Generate, that
// makes the page feel "stuck" if the cursor happens to be over a number field like Number
// of pages/Hebrew year when the user tries to scroll back up. Blur the field the moment a
// wheel event reaches it so the page scrolls normally instead; the field is still fully
// editable by typing or clicking its up/down arrows.
document.addEventListener(
  'wheel',
  (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') {
      document.activeElement.blur();
    }
  },
  { passive: true }
);

const main = document.getElementById('main');
const nav = document.getElementById('nav');
installTimeExplanations(main, document.querySelector('.sidebar-foot'));
// Keep existing hashes so saved links and the chart workflows continue to work.
const tabs = ['home', 'week', 'charts', 'generate', 'saved', 'posters', 'status', 'settings', 'traffic', 'calc', 'program', 'guide'];
const tabLabels = ADMIN_TAB_LABELS;

/* --- The screen you are on, in the address ------------------------------------------
   Without this the tab was a variable that started at Generate and was never written
   anywhere, so every refresh threw you back to Generate no matter what you were looking
   at, and the browser's back button did nothing.

   The hash rather than the History API, because the offline copy runs from file:// where
   pushState throws and a hash does not. It also means back and forward walk the tabs, and
   a screen can be linked to.

   The Posters tab puts its poster and, where the poster has one, its Page choice in the
   address too, since those are what a refresh was losing. Its year is not in there on
   purpose: it defaults to the yomim noraim coming up, and a year in a link goes stale. */
const routeTabs = new Set(tabs);

function routeParts() {
  return location.hash.replace(/^#/, '').split('/').filter(Boolean);
}

/** What the address should say for what is on screen now. */
function currentRoute() {
  return ['', currentTab, ...(currentTab === 'posters' ? posterRoute() : [])].join('/').replace('/', '#');
}

/** Put it there. Assigning location.hash, so this leaves a history entry and back works. */
function writeRoute() {
  const want = currentRoute();
  if (location.hash !== want) location.hash = want;
}

/** Take it from there, on load and on back or forward. Returns whether anything moved, so
 *  the caller can decide whether a redraw is needed. */
function readRoute() {
  const [requestedTab, ...rest] = routeParts();
  const tab = requestedTab || 'home';
  if (!routeTabs.has(tab)) return false;
  const same = tab === currentTab && !currentSheetId
    && (tab !== 'posters' || rest.join('/') === posterRoute().join('/'));
  if (same) return false;
  currentTab = tab;
  currentSheetId = null;
  if (tab === 'posters') setPosterRoute(rest);
  return true;
}

// Back and forward. Our own writes come back through here too and are recognised as
// already applied, so they do not cause a second render.
window.addEventListener('hashchange', () => { if (adminStarted && tables && readRoute()) render(); });

// Inline stroke icons, sized in em and drawn in currentColor so they follow the nav's
// own colour and size. Inline rather than a font or sprite file so the offline/USB build
// stays a single self-contained folder with no extra assets to load.
const tabIcons = {
  home: '<path d="M3 9.5 10 3.5l7 6"/><path d="M4.8 8.2v8.3h10.4V8.2M8.2 16.5v-5h3.6v5"/>',
  screen: '<rect x="2" y="3.5" width="16" height="11" rx="1.5"/><path d="M10 14.5v3M6.5 17.5h7"/>',
  generate: '<path d="M4 3h9l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v4h4"/><path d="M10 10v6M7 13h6"/>',
  settings: '<circle cx="10" cy="10" r="3"/><path d="M10 1v2m0 14v2M3.6 3.6l1.4 1.4m10 10 1.4 1.4M1 10h2m14 0h2M3.6 16.4 5 15m10-10 1.4-1.4"/>',
  saved: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4L9 6h7.5A1.5 1.5 0 0 1 18 7.5v8A1.5 1.5 0 0 1 16.5 17h-13A1.5 1.5 0 0 1 2 15.5z"/>',
  week: '<rect x="3" y="4.5" width="14" height="13" rx="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3"/><circle cx="10" cy="12.5" r="1.4"/>',
  guide: '<circle cx="10" cy="10" r="7.5"/><path d="M7.9 7.7a2.1 2.1 0 1 1 2.6 2.5c-.4.15-.5.4-.5.8v.5"/><path d="M10 14.4v.1"/>',
  program: '<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13"/>',
  calc: '<rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M7 6h6"/><path d="M7 9.5h2M11 9.5h2M7 13h2M11 13h2"/>',
  // A line climbing over two low bars: what the screen itself draws.
  traffic: '<path d="M3 16.5h14"/><rect x="4.5" y="11" width="3" height="5.5" rx="0.6"/><rect x="9" y="8" width="3" height="8.5" rx="0.6"/><rect x="13.5" y="4.5" width="3" height="12" rx="0.6"/>',
  // A speech bubble with two lines in it: the message, rather than the sheet it is read off.
  texts: '<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H8l-4 3.5V14h-.5A1.5 1.5 0 0 1 3 12.5z"/><path d="M6.5 7.5h7M6.5 10.5h4"/>',
  // A house, for the congregation's own site: its home page is what this opens.
  site: '<path d="M3 9.5 10 3.5l7 6"/><path d="M4.8 8.2v8.3a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V8.2"/><path d="M8.2 17.5v-5h3.6v5"/>',
  // A sheet on a wall, with a pin at the top.
  posters: '<rect x="4.5" y="4" width="11" height="13.5" rx="1"/><path d="M10 1.5v2.5"/><circle cx="10" cy="1.6" r="1.1"/><path d="M7.5 8.5h5M7.5 11.5h5M7.5 14.5h3"/>',
  // An open eye: what the congregation is looking at right now.
  status: '<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z"/><circle cx="10" cy="10" r="2.4"/>',
};
const icon = (name) =>
  `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${tabIcons[name]}</svg>`;

/** A brief confirmation, bottom right. Generating a sheet saves it immediately and then
 *  opens it, which looked like nothing had been saved at all: there is no Save button to
 *  press, so nothing told you the sheet already exists in Saved sheets. */
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast no-print';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  // Long enough to read a sentence, and it fades rather than vanishing.
  setTimeout(() => el.classList.add('is-leaving'), 4000);
  setTimeout(() => el.remove(), 4600);
}

function persist() {
  saveState(state);
}

function openTab(tab) {
  currentTab = tab;
  currentSheetId = null;
  writeRoute();
  render();
  window.scrollTo(0, 0);
  const heading = main.querySelector('h2');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}

function renderNav() {
  const active = currentSheetId || ['generate', 'saved'].includes(currentTab) ? 'charts'
    : currentTab === 'program' ? 'guide' : currentTab;
  const link = item => `<a class="nav-btn ${active === item.tab ? 'active' : ''}" href="${item.tab ? `#${item.tab}` : item.href}" ${active === item.tab ? 'aria-current="page"' : ''}${item.tab ? ` data-tab="${item.tab}"` : ''}>${icon(item.icon || item.tab)}<span>${item.tab ? tabLabels[item.tab] : item.label}</span></a>`;
  nav.classList.remove('is-expanded');
  nav.setAttribute('aria-label', 'Admin navigation');
  nav.innerHTML = `<button type="button" class="admin-nav-toggle" aria-expanded="false" aria-controls="admin-navigation"><span><small>Menu</small>${tabLabels[currentTab]}</span><span class="admin-nav-chevron" aria-hidden="true">⌄</span></button>
    <div class="admin-nav-sections" id="admin-navigation">
      ${link({ tab: 'home' })}
      ${ADMIN_NAV_SECTIONS.map(section => `<section class="admin-nav-group" aria-label="${section.title}"><h2 class="admin-nav-label">${section.title}</h2>${section.items.map(link).join('')}</section>`).join('')}
      <div class="admin-nav-public-links">
        <a class="nav-btn" href="/tv/" target="_blank" rel="noopener">${icon('screen')}<span>Open Shul View <small>(new tab)</small></span></a>
        <a class="nav-btn" href="/" target="_blank" rel="noopener">${icon('site')}<span>Open website <small>(new tab)</small></span></a>
      </div>
    </div>`;
  const toggle = nav.querySelector('.admin-nav-toggle');
  toggle.addEventListener('click', () => {
    const expanded = nav.classList.toggle('is-expanded');
    toggle.setAttribute('aria-expanded', String(expanded));
  });
  nav.onkeydown = event => {
    if (event.key === 'Escape' && nav.classList.contains('is-expanded')) {
      nav.classList.remove('is-expanded'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus();
    }
  };
  nav.querySelectorAll('[data-tab]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); openTab(link.dataset.tab);
  }));
}

function addSectionTabs(items) {
  const bar = document.createElement('div');
  bar.className = 'pane-switch no-print admin-section-tabs';
  bar.setAttribute('aria-label', 'Section navigation');
  bar.innerHTML = items.map(t => `<button type="button" class="pane-btn ${currentTab === t ? 'is-on' : ''}" ${currentTab === t ? 'aria-current="page"' : ''} data-section="${t}">${t === 'charts' ? 'View charts' : tabLabels[t]}</button>`).join('');
  bar.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => openTab(btn.dataset.section)));
  main.prepend(bar);
}

/** This week: the heading, the two buttons that choose what it shows, and whichever of
 *  the two is chosen. The same pair the congregation's site puts on its menu, so the two
 *  screens hold the same things in the same order. */
function renderWeekTab(showPublish) {
  main.innerHTML = '<h2 class="no-print">Weekly schedules</h2><div id="week-pane"></div>';
  renderWeek(main.querySelector('#week-pane'), buildAutomaticCharts(state, tables),
    serial => { weekSerial = serial; render(); }, weekSerial, { heading: false });
  main.querySelector('#publish-panel')?.remove();
}

/* The screen the last paint drew, so a redraw that stays on the same screen can put the page
 * back where it was.
 *
 * Every button on a tab redraws the whole tab: main.innerHTML is replaced, and for the moment
 * the container is empty the document has no height, so the browser clamps the scroll position
 * to 0 and it never comes back. On a desktop it does not show, the page being tall enough
 * either way that there is nothing to clamp. On a phone it is every press: This week's
 * Previous, Today, Next and all three Layout switches are below the fold with the sheet under
 * them, and each one threw the page back to the top, so reading the next week meant scrolling
 * down again first. The Posters tab has had its own answer to this for a while, redrawInPlace;
 * this is the same answer for every tab at once.
 *
 * Only when the screen has not changed. Arriving at a different tab, or opening or closing a
 * sheet, should start at the top, and does. Nor when Publishing has just been asked for, since
 * that trip scrolls itself to the panel it came for. */
let painted = { tab: null, sheet: null };

function render() {
  const held = painted.tab === currentTab && painted.sheet === currentSheetId && !openPublish;
  const y = window.scrollY;
  painted = { tab: currentTab, sheet: currentSheetId };
  paint();
  if (held) window.scrollTo(0, y);
}

function paint() {
  renderNav();
  // A sheet needs the full width (a page is a fixed 11in); every other screen is held to
  // a column next to the sidebar. Saved sheets gets a wider one: it's a six-column table,
  // and at the standard width every cell in it wrapped. See app.css.
  main.classList.toggle('is-sheet-view', Boolean(currentSheetId));
  main.classList.toggle('is-wide', !currentSheetId && currentTab === 'saved');
  // The nav used to be hidden while a sheet was open (it sat in a top bar that competed
  // with the sheet's own toolbar). In the sidebar it just stays put - a persistent
  // sidebar with its links blanked out reads as broken. Clicking one does exactly what
  // the sheet's Back button does, and a pending cell edit still commits on blur first.
  if (currentSheetId) {
    const sheet = state.sheets.find((s) => s.id === currentSheetId);
    renderSheet(main, state, sheet, (evt) => {
      if (evt.back) {
        currentSheetId = null;
        render();
      } else if (evt.save) {
        persist();
        render(); // re-render so the ✎ overridden-cell flag appears immediately
      } else if (evt.openSheetId) {
        currentSheetId = evt.openSheetId; // e.g. the Weekday chart <-> Shabbos sheet companion link
        render();
      }
    });
    return;
  }
  if (currentTab === 'home') {
    renderAdminHome(main, openTab);
  } else if (currentTab === 'settings') {
    renderSettings(
      main,
      state,
      tables,
      (next) => {
        state.settings = next;
        persist();
        render();
      },
      // Called after an Import replaced the whole state object's contents (settings,
      // sheets, and rules together) - persist it and re-render from scratch.
      () => {
        persist();
        currentSheetId = null;
        render();
      },
      // Rules live inside Settings now. They are saved on the same state object but not
      // through the settings form, so they get their own save: a rule is written the
      // moment it is added or edited, with no Save button to press.
      () => persist()
    );
  } else if (currentTab === 'charts') {
    main.innerHTML = '<h2 class="no-print">Seasonal charts</h2><p class="hint no-print">Automatic seasonal schedules. Use Print layouts for your own page splits, or Saved copies to reopen a chart saved on this device.</p><div id="season-chart-view"></div>';
    renderChartBrowser(main.querySelector('#season-chart-view'), buildAutomaticCharts(state, tables), { confine: false });
  } else if (currentTab === 'generate') {
    renderGenerate(
      main,
      state,
      tables,
      (sheet) => {
        state.sheets.push(sheet);
        persist();
        currentSheetId = sheet.id;
        render();
        const weekday = state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id);
        toast(weekday ? 'Saved in Seasonal charts → Saved copies, with its weekday chart.' : 'Saved in Seasonal charts → Saved copies.');
      },
      (tab) => {
        currentTab = tab;
        render();
      }
    );
  } else if (currentTab === 'week') {
    const showPublish = openPublish;
    openPublish = false;
    // Coming from "Publishing" on Saved sheets, which is a panel under the week's pages:
    // whichever half was last open, that trip wants this one.
    if (showPublish) weekPane = 'week';
    renderWeekTab(showPublish);
  } else if (currentTab === 'calc') {
    /* The automatic sheets, not the raw state. The saved-sheet list is empty now that the
       charts are computed rather than generated, and this page reads one real week off it to
       work every column through: handed state it found nothing and quietly printed "blank
       that week" in every cell, which is the shape of failure this page is written to avoid.
       Same call the week card and the chart browser make, so all three show one week. */
    renderCalculations(main, buildAutomaticCharts(state, tables), (tab) => {
      openTab(tab);
    });
  } else if (currentTab === 'traffic') {
    renderTraffic(main);
  } else if (currentTab === 'posters') {
    renderPosters(main, state, writeRoute, tables);
  } else if (currentTab === 'status') {
    renderStatus(main);
  } else if (currentTab === 'program') {
    renderProgram(main);
  } else if (currentTab === 'guide') {
    renderGuide(main, (tab) => {
      openTab(tab);
    });
  } else if (currentTab === 'saved') {
    renderSavedSheets(
      main,
      state,
      (id) => {
        currentSheetId = id;
        render();
      },
      // An array: a row in Saved sheets is a Shabbos sheet plus the Weekday chart made
      // with it, and Delete takes the pair.
      (ids) => {
        state.sheets = state.sheets.filter((s) => !ids.includes(s.id));
        persist();
        render();
      },
      // Lock/unlock mutates the sheet in place, so this just saves and redraws the list.
      () => {
        persist();
        render();
      },
      // "Publishing" on the list goes to the panel on This week, which is the one place
      // that shows what the congregation has in front of it and can take a season down.
      () => {
        currentTab = 'week';
        openPublish = true;
        render();
      }
    );
  }
  if (['charts', 'generate', 'saved'].includes(currentTab)) {
    addSectionTabs(['charts', 'generate', 'saved']);
    if (currentTab === 'saved') {
      const heading = main.querySelector('h2');
      if (heading) heading.textContent = tabLabels.saved;
      main.querySelectorAll('button').forEach(btn => {
        if (btn.textContent.trim().startsWith('Publishing')) btn.remove();
      });
    }
  }
  if (['guide', 'program'].includes(currentTab)) addSectionTabs(['guide', 'program']);
  if (['posters', 'traffic', 'calc', 'status', 'settings', 'guide', 'program', 'generate'].includes(currentTab)) {
    const heading = main.querySelector('h2');
    if (heading) heading.textContent = tabLabels[currentTab];
  }

}


// The way back to the congregation's site: three taps on the name at the top of the navy
// sidebar. The same gesture the congregation's page carries in its own navy cap, in the
// other direction. Wired once, since the sidebar is in the page rather than rendered.
wireSecretDoor(document.querySelector('.sidebar-brand'), '/');


function start() {
  window.dispatchEvent(new Event('zmanim-admin-open'));
  adminStarted = true;
  loadTables()
    .then((t) => {
      tables = t;
      // Whatever the address says, before anything is drawn, so a refresh comes back to the
      // screen it was on instead of flashing Generate first.
      readRoute();
      render();
    })
    .catch((err) => {
      /* Set as text, not as markup. What this prints quotes whatever answered instead of the
         data, and that is by definition something that is not the site. See dataErrorMessage. */
      showDataError(main, err);
    });
}

/* The PIN, before any of it. The admin is a page on a public site and anybody who guesses
   the address lands on it, so a device that has not answered in three days answers now.
   Ahead of loadTables as well as ahead of the drawing: nothing is fetched and nothing is
   built for a visitor who is not getting in. The nav is left empty while the lock is up,
   since it is filled by the first render and that is the other side of this.
   What this is and is not worth is written at the top of ui/lock.js. */
if (isOpen()) start();
else renderLock(main, start);
