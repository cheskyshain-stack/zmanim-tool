import { loadState, saveState } from './storage.js';
import { loadTables } from './data-loader.js';
import { renderSettings } from './ui/settings-view.js';
import { renderGenerate } from './ui/generate-view.js';
import { renderRules } from './ui/rules-view.js';
import { renderSavedSheets } from './ui/saved-sheets-view.js';
import { renderSheet } from './ui/sheet-view.js';
import { renderGuide } from './ui/guide-view.js';

const state = loadState();
let tables = null;
let currentTab = 'generate';
let currentSheetId = null;

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
const tabs = ['generate', 'settings', 'rules', 'saved', 'guide'];
// "Saved sheets" in sentence case, matching the heading on the page it opens - the nav
// said "Saved Sheets" and the page said "Saved sheets".
const tabLabels = { generate: 'Generate', settings: 'Settings', rules: 'Rules', saved: 'Saved sheets', guide: 'Guide' };

// Inline stroke icons, sized in em and drawn in currentColor so they follow the nav's
// own colour and size. Inline rather than a font or sprite file so the offline/USB build
// stays a single self-contained folder with no extra assets to load.
const tabIcons = {
  generate: '<path d="M4 3h9l4 4v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v4h4"/><path d="M10 10v6M7 13h6"/>',
  settings: '<circle cx="10" cy="10" r="3"/><path d="M10 1v2m0 14v2M3.6 3.6l1.4 1.4m10 10 1.4 1.4M1 10h2m14 0h2M3.6 16.4 5 15m10-10 1.4-1.4"/>',
  rules: '<path d="M3 6h14M3 10h14M3 14h14"/><circle cx="7" cy="6" r="1.6"/><circle cx="13" cy="10" r="1.6"/><circle cx="6" cy="14" r="1.6"/>',
  saved: '<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h4L9 6h7.5A1.5 1.5 0 0 1 18 7.5v8A1.5 1.5 0 0 1 16.5 17h-13A1.5 1.5 0 0 1 2 15.5z"/>',
  guide: '<circle cx="10" cy="10" r="7.5"/><path d="M7.9 7.7a2.1 2.1 0 1 1 2.6 2.5c-.4.15-.5.4-.5.8v.5"/><path d="M10 14.4v.1"/>',
};
const icon = (name) =>
  `<svg class="nav-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${tabIcons[name]}</svg>`;

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
      },
      (tab) => {
        currentTab = tab;
        render();
      }
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

loadTables()
  .then((t) => {
    tables = t;
    render();
  })
  .catch((err) => {
    main.innerHTML = `<p class="error">Failed to load Hebrew-calendar data files: ${err.message}. Make sure you're serving this folder over http:// (not opening index.html directly) so the data/*.json files can load.</p>`;
  });
