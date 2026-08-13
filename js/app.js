import { loadState, saveState } from './storage.js';
import { loadTables } from './data-loader.js';
import { renderSettings } from './ui/settings-view.js';
import { renderGenerate } from './ui/generate-view.js';
import { renderRules } from './ui/rules-view.js';
import { renderSavedSheets } from './ui/saved-sheets-view.js';
import { renderSheet } from './ui/sheet-view.js';
import { renderGuide } from './ui/guide-view.js';
import { renderWeek } from './ui/week-view.js';
import { loadPublished } from './publish.js';

const state = loadState();
let tables = null;
let currentTab = 'generate';
let currentSheetId = null;
// Which week the This week screen is showing. Null follows whichever Shabbos is next;
// the prev/next buttons pin it to one.
let weekSerial = null;

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
const tabs = ['generate', 'week', 'settings', 'rules', 'saved', 'guide'];
// "Saved sheets" in sentence case, matching the heading on the page it opens - the nav
// said "Saved Sheets" and the page said "Saved sheets".
const tabLabels = { generate: 'Generate', settings: 'Settings', rules: 'Rules', saved: 'Saved sheets', guide: 'Guide', week: 'This week' };

// Inline stroke icons, sized in em and drawn in currentColor so they follow the nav's
// own colour and size. Inline rather than a font or sprite file so the offline/USB build
// stays a single self-contained folder with no extra assets to load.
const tabIcons = {
  generate: '<path d="M4 3h9l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v4h4"/><path d="M10 10v6M7 13h6"/>',
  settings: '<circle cx="10" cy="10" r="3"/><path d="M10 1v2m0 14v2M3.6 3.6l1.4 1.4m10 10 1.4 1.4M1 10h2m14 0h2M3.6 16.4 5 15m10-10 1.4-1.4"/>',
  rules: '<path d="M3 6h14M3 10h14M3 14h14"/><circle cx="7" cy="6" r="1.6"/><circle cx="13" cy="10" r="1.6"/><circle cx="6" cy="14" r="1.6"/>',
  saved: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4L9 6h7.5A1.5 1.5 0 0 1 18 7.5v8A1.5 1.5 0 0 1 16.5 17h-13A1.5 1.5 0 0 1 2 15.5z"/>',
  week: '<rect x="3" y="4.5" width="14" height="13" rx="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3"/><circle cx="10" cy="12.5" r="1.4"/>',
  guide: '<circle cx="10" cy="10" r="7.5"/><path d="M7.9 7.7a2.1 2.1 0 1 1 2.6 2.5c-.4.15-.5.4-.5.8v.5"/><path d="M10 14.4v.1"/>',
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
      render();
    });
  });
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
      }
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
    renderWeek(
      main,
      state,
      (serial) => {
        weekSerial = serial;
        render();
      },
      weekSerial
    );
  } else if (currentTab === 'guide') {
    renderGuide(main, (tab) => {
      currentTab = tab;
      render();
    });
  } else if (currentTab === 'rules') {
    renderRules(main, state, () => persist());
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
      }
    );
  }
}


// The congregation-facing board: index.html?board. It reads the published season from
// data/published.json instead of localStorage, because a visitor's browser has none of
// this app's data. No sidebar, no editing, just the week.
async function startBoard() {
  document.querySelector('.sidebar')?.remove();
  document.body.classList.add('is-board');
  main.innerHTML = '<p class="hint">Loading…</p>';
  const published = await loadPublished();
  if (!published) {
    main.innerHTML = '<p class="hint">Nothing has been published yet.</p>';
    return;
  }
  const boardState = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  let serial = null;
  const draw = () => renderWeek(main, boardState, (s) => { serial = s; draw(); }, serial, { board: true });
  draw();
}

if (new URLSearchParams(location.search).has('board')) {
  startBoard();
} else {
loadTables()
  .then((t) => {
    tables = t;
    render();
  })
  .catch((err) => {
    main.innerHTML = `<p class="error">Failed to load Hebrew-calendar data files: ${err.message}. Make sure you're serving this folder over http:// (not opening index.html directly) so the data/*.json files can load.</p>`;
  });
}
