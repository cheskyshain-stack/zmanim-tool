import assert from 'node:assert/strict';
import test from 'node:test';
import published from '../../data/published.json' with { type: 'json' };
import parshaChutz from '../../data/parsha_chutz.json' with { type: 'json' };
import parshaEY from '../../data/parsha_ey.json' with { type: 'json' };
import parshaNames from '../../data/parsha_names.json' with { type: 'json' };
import specialDays from '../../data/special_days.json' with { type: 'json' };
import { buildScheduleFeed } from '../../scripts/schedule-feed.mjs';
import { scheduleSnapshot, scheduleCalendar } from '../src/schedules.js';
import worker from '../src/worker.js';
import { offlineSnapshot } from '../public/display-assets/offline-engine.js';

test('the TV follows the congregation’s November weekday prayer times', () => {
  const at = '2026-11-16T17:00:00.000Z';
  const congregation = buildScheduleFeed(published, { parshaChutz, parshaEY, parshaNames, specialDays }, new Date(at));
  const tv = scheduleSnapshot(at);
  const prayers = new Set(['שחרית', 'מנחה', 'מעריב']);
  const timedPrayers = events => [...new Set(events.filter(event => prayers.has(event.name)).map(event => event.name + ':' + event.minutes))].sort();
  const websiteMinutes = congregation.days[0].events.map(event => {
    const [hour, minute] = event.time.split(':').map(Number);
    return { ...event, minutes: hour * 60 + minute };
  });
  const tvMinutes = tv.today.events.map(event => ({ ...event, minutes: event.mins }));
  assert.equal(congregation.days[0].date, tv.today.date);
  assert.ok(websiteMinutes.some(event => event.name === 'מנחה' && event.minutes === 13 * 60));
  assert.deepEqual(timedPrayers(tvMinutes), timedPrayers(websiteMinutes));
});

test('live and offline TV schedules follow the congregation’s published settings', async t => {
  const now = Date.parse('2026-11-16T17:00:00.000Z');
  const timers = t.mock.timers;
  timers.enable({ apis: ['Date'], now });
  const latest = { ...published, settings: { ...published.settings, shulName: 'Congregation live source', latitude: 41 } };
  const requested = [];
  let available = true;
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    return available ? Response.json(latest) : new Response('', { status: 503 });
  });
  const DB = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
        async first() { return { mode: 'dark', dark_start: '19:00', light_start: '07:00' }; },
      };
    },
  };
  const read = async path => {
    const response = await worker.fetch(new Request('https://baismedrashoflakewoodcommons.org/api/display/' + path), { DB });
    assert.equal(response.status, 200);
    return response.json();
  };
  const live = await read('public');
  const seed = await read('offline');
  assert.deepEqual(requested, ['https://baismedrashoflakewoodcommons.org/data/published.json']);
  assert.equal(live.schedule.shulName, latest.settings.shulName);
  assert.notDeepEqual(live.schedule.zmanim, scheduleSnapshot(now).zmanim);
  assert.deepEqual(offlineSnapshot(seed, now).schedule, live.schedule);

  latest.settings.shulName = 'Updated congregation source';
  latest.settings.elevation = 1500;
  latest.settings.useElevation = false;
  timers.tick(61_000);
  const refreshed = await read('offline');
  const updated = offlineSnapshot(refreshed, Date.now()).schedule;
  assert.equal(updated.shulName, latest.settings.shulName);
  assert.deepEqual(updated.zmanim, live.schedule.zmanim, 'Sunrise and sunset honor the congregation elevation toggle');
  const withElevation = scheduleCalendar({ ...latest, settings: { ...latest.settings, useElevation: true } }).scheduleSnapshot(Date.now());
  assert.notDeepEqual(updated.zmanim, withElevation.zmanim);

  available = false;
  timers.tick(61_000);
  const cached = await read('offline');
  assert.equal(cached.publishedSchedule.settings.shulName, latest.settings.shulName);
  assert.equal(requested.length, 3);
});
