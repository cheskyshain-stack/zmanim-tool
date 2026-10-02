import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the exact generated loader with a fake DOM. No analytics requests are sent.
const adminHtml = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
const publicHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const offlineHtml = await readFile(new URL('../offline/index.html', import.meta.url), 'utf8');
const loader = (html) => {
  const code = html.match(/<!-- analytics: [^>]+-->\s*<script>(.*?)<\/script>/s)?.[1];
  assert.ok(code, 'Generated analytics loader must exist');
  return code;
};

function browser({ host = 'baismedrashoflakewoodcommons.org', search = '', excluded = false, storageFails = false, page = adminHtml } = {}) {
  const records = new Map(excluded ? [['zmanim-nocount', '1']] : []);
  const scripts = [], listeners = new Map();
  const localStorage = {
    getItem(key) { if (storageFails) throw new Error('Storage blocked'); return records.get(key) || null; },
    setItem(key, value) { if (storageFails) throw new Error('Storage blocked'); records.set(key, value); },
    removeItem(key) { if (storageFails) throw new Error('Storage blocked'); records.delete(key); },
  };
  const window = { addEventListener(name, fn, options) { listeners.set(name, { fn, options }); } };
  const document = {
    createElement(name) { return { name, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  vm.runInNewContext(loader(page), { location: { hostname: host, search }, URLSearchParams, localStorage, window, document, alert() {} });
  return { scripts, records, open() { const listener = listeners.get('zmanim-admin-open'); if (!listener) return; if (listener.options?.once) listeners.delete('zmanim-admin-open'); listener.fn(); } };
}

test('admin tracking starts only after unlock and starts once per document', () => {
  const b = browser();
  assert.equal(b.scripts.length, 0, 'The PIN screen must not count');
  b.open(); b.open();
  assert.equal(b.scripts.length, 1);
  assert.equal(b.scripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.equal(JSON.parse(b.scripts[0].attributes['data-cf-beacon']).spa, false, 'Changing tabs must not add admin opens');
});

test('existing excluded browsers stay excluded from admin tracking', () => {
  const b = browser({ excluded: true }); b.open();
  assert.equal(b.scripts.length, 0);
  assert.equal(b.records.get('zmanim-nocount'), '1');
});

test('admin supports the existing count off and on controls', () => {
  const off = browser({ search: '?count=off' }); off.open();
  assert.equal(off.scripts.length, 0);
  assert.equal(off.records.get('zmanim-nocount'), '1');
  const on = browser({ search: '?count=on', excluded: true }); on.open();
  assert.equal(on.scripts.length, 1);
  assert.equal(on.records.has('zmanim-nocount'), false);
});

test('localhost, offline and preview hosts never load the admin beacon', () => {
  for (const host of ['localhost', '127.0.0.1', '', 'preview.example.org']) {
    const b = browser({ host }); b.open(); assert.equal(b.scripts.length, 0);
  }
  assert.doesNotMatch(offlineHtml, /static\.cloudflareinsights\.com|analytics: stamped/);
});

test('blocked browser storage does not break the admin', () => {
  const b = browser({ storageFails: true });
  assert.doesNotThrow(() => b.open());
  assert.equal(b.scripts.length, 1);
});

test('public page measurement retains its existing behavior and exclusion', () => {
  const normal = browser({ page: publicHtml });
  assert.equal(normal.scripts.length, 1);
  assert.equal(JSON.parse(normal.scripts[0].attributes['data-cf-beacon']).spa, undefined);
  assert.equal(browser({ page: publicHtml, excluded: true }).scripts.length, 0);
});
