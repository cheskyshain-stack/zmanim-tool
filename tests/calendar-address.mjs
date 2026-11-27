import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const legacy = await readFile(new URL('../admin/calendar/index.html', import.meta.url), 'utf8');
const redirect = legacy.match(/<script>([\s\S]*?)<\/script>/)[1];
const origin = 'https://baismedrashoflakewoodcommons.org';

test('saved calendar addresses preserve event, message and account destinations', async () => {
  assert.equal(await readFile(new URL('../calendar/index.html', import.meta.url), 'utf8'), legacy);
  for (const path of ['/calendar/', '/calendar/index.html', '/admin/calendar/', '/admin/calendar/index.html']) {
    for (const suffix of ['', '?view=congregation', '?preview=congregation',
      '?view=congregation&simcha=2026-11-24&event=saved-event&post=1',
      '?messages=1', '#invite=synthetic-private-token', '#setup=synthetic-private-token',
      '#google-calendar=synthetic-private-state', '?next=https%3A%2F%2Funrelated.example#invite=private']) {
      const old = new URL(path + suffix, origin);
      let destination;
      vm.runInNewContext(redirect, { URL, location: { origin, search: old.search, hash: old.hash, replace(value) { destination = new URL(value); } } });
      assert.equal(destination.origin, origin);
      assert.equal(destination.pathname, '/messages/');
      assert.equal(destination.hash, old.hash);
      const expected = new URLSearchParams(old.search);
      if (expected.get('view') === 'congregation') expected.delete('view');
      assert.deepEqual([...destination.searchParams], [...expected]);
    }
  }
  assert.doesNotMatch(legacy, /cloudflareinsights|calendar-app\.js|http-equiv="refresh"/);
});

test('installed calendar identity stays the same while the starting address changes', async () => {
  const canonical = JSON.parse(await readFile(new URL('../calendar/site.webmanifest', import.meta.url), 'utf8'));
  const previous = JSON.parse(await readFile(new URL('../admin/calendar/site.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual(previous, canonical);
  assert.deepEqual(JSON.parse(await readFile(new URL('../messages/site.webmanifest', import.meta.url), 'utf8')), canonical);
  assert.equal(canonical.id, '/admin/calendar/');
  assert.equal(canonical.start_url, '/messages/');
  assert.equal(canonical.scope, '/messages/');
  const registration = await readFile(new URL('../js/ui/calendar-phone-reminders.js', import.meta.url), 'utf8');
  assert.match(registration, /const calendarPath = '\/admin\/calendar\/';/);
});
