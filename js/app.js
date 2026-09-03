import { loadState, saveState } from './storage.js';
import { loadTables } from './data-loader.js';
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
import { wireSecretDoor } from './ui/nav-helpers.js';

const state = loadState();
let tables = null;
let currentTab = 'generate';
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
// Making a chart first, then the week you are on, then the sheets you already have, then
// the things you set once. Rules is no longer among them - it is the first panel inside
// Settings, being something configured rather than a place you go. Generate leading also
// matches where the app opens.
const tabs = ['generate', 'week', 'posters', 'saved', 'settings', 'calc', 'program', 'guide'];
// "Saved sheets" in sentence case, matching the heading on the page it opens - the nav
// said "Saved Sheets" and the page said "Saved sheets".
const tabLabels = { generate: 'Generate', settings: 'Settings', saved: 'Saved sheets', calc: 'Calculations', program: 'Get the program', guide: 'Guide', week: 'This week', posters: 'Posters' };

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
  const [tab, ...rest] = routeParts();
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
window.addEventListener('hashchange', () => { if (readRoute()) render(); });

// Inline stroke icons, sized in em and drawn in currentColor so they follow the nav's
// own colour and size. Inline rather than a font or sprite file so the offline/USB build
// stays a single self-contained folder with no extra assets to load.
const tabIcons = {
  generate: '<path d="M4 3h9l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v4h4"/><path d="M10 10v6M7 13h6"/>',
  settings: '<circle cx="10" cy="10" r="3"/><path d="M10 1v2m0 14v2M3.6 3.6l1.4 1.4m10 10 1.4 1.4M1 10h2m14 0h2M3.6 16.4 5 15m10-10 1.4-1.4"/>',
  saved: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4L9 6h7.5A1.5 1.5 0 0 1 18 7.5v8A1.5 1.5 0 0 1 16.5 17h-13A1.5 1.5 0 0 1 2 15.5z"/>',
  week: '<rect x="3" y="4.5" width="14" height="13" rx="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3"/><circle cx="10" cy="12.5" r="1.4"/>',
  guide: '<circle cx="10" cy="10" r="7.5"/><path d="M7.9 7.7a2.1 2.1 0 1 1 2.6 2.5c-.4.15-.5.4-.5.8v.5"/><path d="M10 14.4v.1"/>',
  program: '<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M3.5 13v2.5A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5V13"/>',
  calc: '<rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M7 6h6"/><path d="M7 9.5h2M11 9.5h2M7 13h2M11 13h2"/>',
  // A sheet on a wall, with a pin at the top.
  posters: '<rect x="4.5" y="4" width="11" height="13.5" rx="1"/><path d="M10 1.5v2.5"/><circle cx="10" cy="1.6" r="1.1"/><path d="M7.5 8.5h5M7.5 11.5h5M7.5 14.5h3"/>',
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

function renderNav() {
  nav.innerHTML = tabs
    .map((t) => `<button class="nav-btn ${t === currentTab && !currentSheetId ? 'active' : ''}" data-tab="${t}">${icon(t)}<span>${tabLabels[t]}</span></button>`)
    .join('');
  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      currentSheetId = null;
      writeRoute();
      render();
    });
  });
}

/** This week: the heading, the two buttons that choose what it shows, and whichever of
 *  the two is chosen. The same pair the congregation's site puts on its menu, so the two
 *  screens hold the same things in the same order. */
function renderWeekTab(showPublish) {
  const panes = [
    { key: 'week', label: 'Weekly Zmanim' },
    { key: 'chart', label: 'Zmanim Chart' },
  ];
  main.innerHTML = `
    <h2 class="no-print">This week</h2>
    <p class="hint no-print">Everything the congregation can see: the week's two pages, and the wall chart.</p>
    <div class="pane-switch no-print" role="tablist">
      ${panes
        .map(
          (p) =>
            `<button type="button" role="tab" aria-selected="${p.key === weekPane}" class="pane-btn ${
              p.key === weekPane ? 'is-on' : ''
            }" data-pane="${p.key}">${p.label}</button>`
        )
        .join('')}
    </div>
    <div id="week-pane"></div>`;
  main.querySelectorAll('.pane-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.pane === weekPane) return;
      weekPane = btn.dataset.pane;
      render();
    });
  });

  const host = main.querySelector('#week-pane');
  if (weekPane === 'chart') {
    renderChartBrowser(host, state, { empty: 'Generate a שבת sheet and its chart shows up here.' });
    return;
  }
  renderWeek(
    host,
    state,
    (serial) => {
      weekSerial = serial;
      render();
    },
    weekSerial,
    { openPublish: showPublish, heading: false }
  );
}

function render() {
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
  if (currentTab === 'settings') {
    renderSettings(
      main,
      state,
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
        toast(weekday ? 'Saved to Saved sheets, with its Weekday chart.' : 'Saved to Saved sheets.');
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
    renderCalculations(main, state, (tab) => {
      currentTab = tab;
      render();
    });
  } else if (currentTab === 'posters') {
    renderPosters(main, state, writeRoute, tables);
  } else if (currentTab === 'program') {
    renderProgram(main);
  } else if (currentTab === 'guide') {
    renderGuide(main, (tab) => {
      currentTab = tab;
      render();
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
}


// The way back to the congregation's site: three taps on the name at the top of the navy
// sidebar. The same gesture the congregation's page carries in its own navy cap, in the
// other direction. Wired once, since the sidebar is in the page rather than rendered.
wireSecretDoor(document.querySelector('.sidebar-brand'), '/');

loadTables()
  .then((t) => {
    tables = t;
    // Whatever the address says, before anything is drawn, so a refresh comes back to the
    // screen it was on instead of flashing Generate first.
    readRoute();
    render();
  })
  .catch((err) => {
    main.innerHTML = `<p class="error">Failed to load Hebrew-calendar data files: ${err.message}. Make sure you're serving this folder over http:// (not opening index.html directly) so the data/*.json files can load.</p>`;
  });
