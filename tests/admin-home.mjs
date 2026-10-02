import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ADMIN_NAV_SECTIONS, ADMIN_TAB_LABELS } from '../js/ui/admin-home.js';

const adminShellSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
function adminShellFixture({ open = true, hash = '' } = {}) {
  const calls = [];
  const listeners = new Map();
  let unlock;
  let posterParts = [];
  const element = () => ({
    innerHTML: '', classList: { toggle() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, focus() {}, remove() {}, prepend() {},
    querySelector() { return element(); }, querySelectorAll() { return []; },
  });
  const main = element();
  const nav = element();
  const location = { hash };
  const scope = {
    console, Event, Map, Set, location, ADMIN_NAV_SECTIONS, ADMIN_TAB_LABELS,
    document: { addEventListener() {}, getElementById(id) { return id === 'main' ? main : nav; }, querySelector() { return element(); }, createElement: element },
    window: { scrollY: 0, scrollTo() {}, addEventListener(name, fn) { listeners.set(name, fn); }, dispatchEvent(event) { calls.push(event.type); } },
    loadState: () => ({ sheets: [], settings: {} }), saveState() {}, wireSecretDoor() {},
    loadTables: async () => { calls.push('loadTables'); return {}; }, showDataError() {},
    isOpen: () => open, renderLock: (_, callback) => { unlock = callback; calls.push('lock'); },
    buildAutomaticCharts: () => ({}), posterRoute: () => posterParts, setPosterRoute: parts => { posterParts = parts; },
  };
  for (const name of ['AdminHome', 'Settings', 'Generate', 'SavedSheets', 'Sheet', 'Guide', 'Program', 'Posters', 'Calculations', 'Week', 'ChartBrowser', 'Traffic', 'Status']) {
    scope[`render${name}`] = () => calls.push(`render${name}`);
  }
  const context = vm.createContext(scope);
  vm.runInContext(adminShellSource.replace(/^import .*;\r?\n/gm, '')
    + '\nglobalThis.adminShell = { openTab, readRoute, current: () => currentTab };', context);
  return { calls, main, nav, location, scope: context.adminShell,
    async ready() { await Promise.resolve(); await Promise.resolve(); },
    unlock() { unlock(); }, hashChange(value) { location.hash = value; listeners.get('hashchange')(); },
    posterParts: () => posterParts,
  };
}

test('admin landing opens home and navigation keeps screen routes distinct', async () => {
  const f = adminShellFixture();
  await f.ready();
  assert.equal(f.scope.current(), 'home');
  assert(f.calls.includes('renderAdminHome'));
  assert.match(f.nav.innerHTML, /aria-controls="admin-navigation"/);
  assert.match(f.nav.innerHTML, /aria-expanded="false"/);
  assert.match(f.nav.innerHTML, /href="\/admin\/display\/"/);
  assert.match(f.nav.innerHTML, /href="\/tv\/"/);
  assert(!f.nav.innerHTML.includes('href="/display/"'));
});

test('locked admin neither renders tabs nor dispatches an open event on hash changes', async () => {
  const f = adminShellFixture({ open: false });
  f.hashChange('#traffic');
  await f.ready();
  assert.deepEqual(f.calls, ['lock']);
  f.unlock();
  await f.ready();
  assert.deepEqual(f.calls.slice(0, 3), ['lock', 'zmanim-admin-open', 'loadTables']);
  assert(f.calls.includes('renderTraffic'));
  f.scope.openTab('home');
  assert.equal(f.calls.filter(name => name === 'zmanim-admin-open').length, 1);
});

test('existing direct links and chart navigation retain their routes', async () => {
  for (const tab of ['traffic', 'generate', 'saved', 'settings']) {
    const f = adminShellFixture({ hash: `#${tab}` });
    await f.ready();
    assert.equal(f.scope.current(), tab);
    f.scope.openTab('saved');
    assert.equal(f.location.hash, '#saved');
    assert(f.calls.includes('renderSavedSheets'));
    f.hashChange('');
    assert.equal(f.scope.current(), 'home');
    assert.equal(f.calls.at(-1), 'renderAdminHome');
  }
});

test('special-schedule deep links preserve their selected schedule and page', async () => {
  const f = adminShellFixture({ hash: '#posters/sukkos/2' });
  await f.ready();
  assert.equal(f.scope.current(), 'posters');
  assert.equal(Array.from(f.posterParts()).join('/'), 'sukkos/2');
  assert(f.calls.includes('renderPosters'));
});
