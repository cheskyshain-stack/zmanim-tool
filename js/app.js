import { loadState, saveState, exportStateToFile, importStateFromText } from './storage.js';
import { loadTables } from './data-loader.js';
import { renderSettings } from './ui/settings-view.js';
import { renderGenerate } from './ui/generate-view.js';
import { renderRules } from './ui/rules-view.js';
import { renderSavedSheets } from './ui/saved-sheets-view.js';
import { renderSheet } from './ui/sheet-view.js';

const state = loadState();
let tables = null;
let currentTab = 'generate';
let currentSheetId = null;

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const tabs = ['generate', 'settings', 'rules', 'saved'];
const tabLabels = { generate: 'Generate', settings: 'Settings', rules: 'Rules', saved: 'Saved Sheets' };

function persist() {
  saveState(state);
}

function renderNav() {
  nav.innerHTML = tabs.map((t) => `<button class="nav-btn ${t === currentTab && !currentSheetId ? 'active' : ''}" data-tab="${t}">${tabLabels[t]}</button>`).join('');
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
  nav.style.display = currentSheetId ? 'none' : '';
  if (currentSheetId) {
    const sheet = state.sheets.find((s) => s.id === currentSheetId);
    renderSheet(main, state, sheet, (evt) => {
      if (evt.back) {
        currentSheetId = null;
        render();
      } else if (evt.save) {
        persist();
        render(); // re-render so the ✎ overridden-cell flag appears immediately
      }
    });
    return;
  }
  if (currentTab === 'settings') {
    renderSettings(main, state, (next) => {
      state.settings = next;
      persist();
      render();
    });
  } else if (currentTab === 'generate') {
    renderGenerate(main, state, tables, (sheet) => {
      state.sheets.push(sheet);
      persist();
      currentSheetId = sheet.id;
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
      (id) => {
        state.sheets = state.sheets.filter((s) => s.id !== id);
        persist();
        render();
      }
    );
  }
}

document.getElementById('export-btn').addEventListener('click', () => exportStateToFile(state));
document.getElementById('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const imported = importStateFromText(text);
    Object.assign(state, imported);
    persist();
    currentSheetId = null;
    render();
    alert('Backup restored.');
  } catch (err) {
    alert('Could not read that backup file: ' + err.message);
  }
  e.target.value = '';
});

loadTables()
  .then((t) => {
    tables = t;
    render();
  })
  .catch((err) => {
    main.innerHTML = `<p class="error">Failed to load Hebrew-calendar data files: ${err.message}. Make sure you're serving this folder over http:// (not opening index.html directly) so the data/*.json files can load.</p>`;
  });
