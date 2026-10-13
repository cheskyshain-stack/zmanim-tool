import { escAttr } from '../util.js';
import { keepPosition } from './keep-position.js';

const MODE_KEY = 'zmanim-print-navigation';
const TAB_KEY = 'zmanim-print-navigation-tabs';
let modeFallback = null;
let tabsFallback = {};

function preservePreviousChoices() {
  try {
    const key = 'zmanim-print-choices-before-simple-v1';
    if (localStorage.getItem(key)) return;
    const state = JSON.parse(localStorage.getItem('zmanim-app-state-v1') || '{}');
    localStorage.setItem(key, JSON.stringify({
      baseline: '82793f6e19e91e3a71de3c40a575d6d9a9696636',
      posterBar: localStorage.getItem('zmanim-poster-bar-v1'),
      chartLayout: localStorage.getItem('zmanim-chart-print-layout'),
      chartDefaults: Object.fromEntries(['sheetStyle', 'chartInk', 'showMolad', 'moladFormat']
        .filter(key => state.settings && key in state.settings).map(key => [key, state.settings[key]])),
      layouts: (state.sheets || []).map(sheet => ({ id: sheet.id, pageSizes: sheet.pageSizes, style: sheet.style })),
    }));
  } catch { /* Never erase preferences when browser storage is unavailable or full. */ }
}

export function previousPrintSetup() {
  try { return (modeFallback ?? localStorage.getItem(MODE_KEY)) === 'classic'; }
  catch { return modeFallback === 'classic'; }
}

function rememberMode(mode) {
  modeFallback = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* Use the session fallback. */ }
}

function rememberedTabs() {
  try { return { ...JSON.parse(localStorage.getItem(TAB_KEY) || '{}'), ...tabsFallback }; }
  catch { return tabsFallback; }
}

function rememberTab(key, tab) {
  tabsFallback[key] = tab;
  try { localStorage.setItem(TAB_KEY, JSON.stringify(rememberedTabs())); } catch { /* Use the session fallback. */ }
}

export function printSetupNote(text) {
  const note = document.createElement('p');
  note.className = 'print-setup-note';
  note.textContent = text;
  return note;
}

export function printSetupLink(text, href) {
  const link = document.createElement('a');
  link.className = 'print-setup-link';
  link.textContent = text;
  link.href = href;
  return link;
}

// Move the existing controls with their listeners. The renderers and saved settings
// remain authoritative, and a redraw can still restore the original control layout.
export function setupPrintNavigation(root, {
  key, anchor, mount, context = [], schedules = [], pages = [], appearance = [],
  actions = [], onRedraw, defaults = 'schedules', summaries = {}, searchLinks = [],
  enhance, summary, refresh,
}) {
  if (!anchor || root.querySelector('.print-setup-mode-row')) return;
  const previous = previousPrintSetup();
  if (previous) root.classList.remove('has-simple-print');
  const modeRow = document.createElement('div');
  modeRow.className = 'print-setup-mode-row no-print';
  modeRow.innerHTML = `<button type="button" id="print-navigation-mode" class="print-setup-mode">${previous ? 'Use new print setup' : 'Use previous print setup'}</button>`;
  const modeButton = modeRow.querySelector('button');
  modeButton.addEventListener('click', () => {
    rememberMode(previous ? 'simple' : 'classic');
    keepPosition(root, onRedraw);
  });
  anchor.before(modeRow);
  if (previous) return;

  preservePreviousChoices();

  root.classList.add('has-simple-print');
  const setup = document.createElement('section');
  setup.className = 'print-setup no-print';
  setup.setAttribute('aria-label', 'Print setup');
  setup.innerHTML = `<div class="print-setup-heading"><h3>Print setup</h3><button type="button" id="print-setup-find">Find a setting</button></div>
    <div class="print-setup-context"></div>
    <div class="print-setup-search" hidden><label for="print-setup-search">Find a print setting</label>
      <input id="print-setup-search" type="search" placeholder="Try margins, Molad, half pages…"><div class="print-setup-results"></div></div>
    <div class="print-setup-tabs" role="tablist" aria-label="Print settings sections">
      ${['schedules', 'pages', 'appearance'].map(tab => `<button type="button" id="print-tab-${tab}" role="tab" data-print-tab="${tab}"
        aria-controls="print-pane-${tab}">${tab[0].toUpperCase() + tab.slice(1)}<small>${escAttr(summaries[tab] || '')}</small></button>`).join('')}
    </div>
    ${['schedules', 'pages', 'appearance'].map(tab => `<section id="print-pane-${tab}" role="tabpanel" aria-labelledby="print-tab-${tab}" class="print-setup-pane" data-print-pane="${tab}"></section>`).join('')}
    <div class="print-setup-actions"><div class="print-setup-job"><strong id="print-setup-summary"></strong><small id="print-setup-paper"></small></div><div class="print-setup-buttons"></div></div>`;
  (mount || anchor.parentElement).insertBefore(setup, mount ? null : anchor);
  modeRow.remove();
  setup.querySelector('.print-setup-heading').append(modeRow);
  for (const node of context.filter(Boolean)) setup.querySelector('.print-setup-context').append(node);
  for (const [tab, nodes] of Object.entries({ schedules, pages, appearance })) {
    const pane = setup.querySelector(`[data-print-pane="${tab}"]`);
    for (const node of nodes.filter(Boolean)) pane.append(node);
    if (!pane.children.length) pane.append(printSetupNote(tab === 'appearance'
      ? 'This format uses its established printed appearance.' : 'This layout sets these options automatically.'));
  }
  for (const node of actions.filter(Boolean)) setup.querySelector('.print-setup-buttons').append(node);
  enhance?.(setup);

  let active = rememberedTabs()[key];
  if (!['schedules', 'pages', 'appearance'].includes(active)) active = defaults;
  const selectTab = (tab, focus = false) => keepPosition(root, () => {
    active = tab;
    rememberTab(key, tab);
    for (const button of setup.querySelectorAll('[data-print-tab]')) {
      const selected = button.dataset.printTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const pane of setup.querySelectorAll('[data-print-pane]')) pane.hidden = pane.dataset.printPane !== tab;
    if (focus) setup.querySelector(`[data-print-tab="${tab}"]`).focus({ preventScroll: true });
  }, { panels: false, focus: false });
  for (const button of setup.querySelectorAll('[data-print-tab]')) {
    button.addEventListener('click', () => selectTab(button.dataset.printTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const names = ['schedules', 'pages', 'appearance'];
      const at = names.indexOf(active);
      selectTab(event.key === 'Home' ? names[0] : event.key === 'End' ? names[2]
        : names[(at + (event.key === 'ArrowRight' ? 1 : 2)) % 3], true);
    });
  }
  selectTab(active);

  const updateSummary = () => {
    const job = summary?.() || {};
    setup.querySelector('#print-setup-summary').textContent = job.text || 'Print the selected pages';
    setup.querySelector('#print-setup-paper').textContent = job.paper || 'Use the paper size shown in the preview';
  };
  updateSummary();
  setup.addEventListener('change', () => { refresh?.(setup); updateSummary(); });
  refresh?.(setup);

  const search = setup.querySelector('#print-setup-search');
  const results = setup.querySelector('.print-setup-results');
  const describe = control => {
    const labelled = control.getAttribute('aria-labelledby');
    const ids = labelled?.split(/\s+/).map(id => root.querySelector(`#${CSS.escape(id)}`)?.textContent).filter(Boolean).join(' ');
    const label = control.labels?.[0]?.firstChild?.textContent || control.closest('label')?.firstChild?.textContent;
    const group = control.closest('.poster-bar-switch,.print-setup-field');
    const question = group?.querySelector('.week-switch-label')?.textContent;
    return (control.getAttribute('aria-label') || ids || (control.type === 'radio' && question ? `${question}: ${label}` : label) || question
      || control.textContent || '').trim().replace(/\s+/g, ' ');
  };
  const findResults = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const entries = [];
    const seen = new Set();
    for (const control of setup.querySelectorAll('[data-print-pane] select,[data-print-pane] input,[data-print-pane] summary,[data-print-pane] button,[data-print-pane] a')) {
      if (control.type === 'radio' && !control.checked) continue;
      if (control.hidden || control.closest('[data-print-search-hidden]')) continue;
      const pane = control.closest('[data-print-pane]');
      const hidden = control.closest('[hidden]');
      if (hidden && hidden !== pane) continue;
      const tab = pane.dataset.printPane;
      const label = describe(control);
      if (!label || seen.has(label)) continue;
      const words = label + ' ' + (control.tagName === 'SELECT' ? [...control.options].map(option => option.text).join(' ') : '');
      if (query && !words.toLocaleLowerCase().includes(query)) continue;
      seen.add(label);
      entries.push({ label, tab, control });
    }
    for (const entry of searchLinks) if (!query || `${entry.label} ${entry.words || ''}`.toLocaleLowerCase().includes(query)) entries.push(entry);
    results.replaceChildren();
    for (const entry of entries.slice(0, 12)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'print-setup-result';
      button.innerHTML = `<strong>${escAttr(entry.label)}</strong><small>${escAttr(entry.tab ? entry.tab[0].toUpperCase() + entry.tab.slice(1) : entry.where || 'Another print screen')}</small>`;
      button.addEventListener('click', () => {
        if (entry.open) { entry.open(); return; }
        selectTab(entry.tab);
        setup.querySelector('.print-setup-search').hidden = true;
        let target = entry.control;
        for (let panel = target.closest('details'); panel && setup.contains(panel); panel = panel.parentElement?.closest('details')) panel.open = true;
        if (target.type === 'radio' && target.id) target = root.querySelector(`label[for="${CSS.escape(target.id)}"]`) || target;
        target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        entry.control.focus({ preventScroll: true });
        target.classList.add('print-setup-highlight');
        setTimeout(() => target.classList.remove('print-setup-highlight'), 1800);
      });
      results.append(button);
    }
    if (!results.children.length) results.append(printSetupNote('No matching option for this layout. Try another schedule or format.'));
  };
  setup.querySelector('#print-setup-find').addEventListener('click', () => keepPosition(root, () => {
    const box = setup.querySelector('.print-setup-search');
    box.hidden = !box.hidden;
    if (!box.hidden) { findResults(); search.focus({ preventScroll: true }); }
  }, { panels: false, focus: false }));
  search.addEventListener('input', findResults);
  return { selectTab, updateSummary, setup };
}

export function currentPrintSummary(root) {
  const css = document.querySelector('#print-page-size')?.textContent || '';
  const wide = css.includes('17in');
  const landscape = wide || css.includes('landscape');
  const size = wide ? '11 × 17' : 'Letter';
  const count = root.querySelectorAll('.poster-paired-page').length || root.querySelectorAll('.poster-all-item').length
    || root.querySelectorAll('.poster-half-sheet').length || root.querySelectorAll('.page').length
    || root.querySelectorAll('.week-pair').length || root.querySelectorAll('.week-card').length
    || root.querySelectorAll('.poster').length;
  return { text: count ? `${count} ${count === 1 ? 'sheet' : 'sheets'} · ${size} · ${landscape ? 'Landscape' : 'Portrait'}` : 'Choose schedules to print',
    paper: `Print dialog: ${wide ? 'Ledger / Tabloid' : 'Letter'} paper${landscape ? ', landscape' : ', portrait'}` };
}
