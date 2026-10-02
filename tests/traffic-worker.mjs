import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/traffic-worker.js';
import { requestedRange, midnight, civilDate, DAY } from '../worker/traffic-calendar.js';

const NativeDate = Date;
const ORIGIN = 'https://baismedrashoflakewoodcommons.org';
let now = Date.parse('2026-10-02T02:00:00Z');
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};

function fixture({ events = [], archive = true, failGroup, failWrite = false, failRead = false, truncate = false, groupDelta = 0, unknownCategories = false } = {}) {
  const values = new Map();
  const cache = new Map();
  const calls = [];
  const cacheCalls = [];
  const writes = [];
  globalThis.caches = { default: {
    async match(key) { cacheCalls.push(['match', key.url]); return cache.get(key.url)?.clone(); },
    async put(key, value) { cacheCalls.push(['put', key.url]); cache.set(key.url, value.clone()); },
  } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    const { query, variables } = JSON.parse(init.body);
    assert.match(query, /datetime_geq: \$since, datetime_lt: \$until/);
    const dimensions = /dimensions \{ ([^}]+) \}/.exec(query)[1].trim().split(/\s+/);
    const dim = dimensions.find((d) => d !== 'datetimeHour') || 'datetimeHour';
    calls.push({ dim, ...variables });
    if (unknownCategories && dim !== 'datetimeHour') return Response.json({ errors: [{ message: `Unknown dimension ${dim}` }] });
    if (dim === failGroup) return Response.json({ errors: [{ message: 'Analytics is temporarily unavailable' }] });
    const rows = new Map();
    for (const event of events) {
      const at = Date.parse(event.at);
      if (at < Date.parse(variables.since) || at >= Date.parse(variables.until)) continue;
      const hour = new Date(Math.floor(at / 3600000) * 3600000).toISOString();
      const name = event[dim] ?? ({ requestPath: '/', deviceType: 'mobile', userAgentBrowser: 'Chrome', userAgentOS: 'Android', refererHost: '' }[dim]);
      const key = `${hour}/${dim === 'datetimeHour' ? '' : name}`;
      const row = rows.get(key) || { count: 0, sum: { visits: 0 }, dimensions: { datetimeHour: hour, [dim]: dim === 'datetimeHour' ? hour : name } };
      row.count += event.views ?? 1;
      row.sum.visits += event.visits ?? 1;
      rows.set(key, row);
    }
    const result = [...rows.values()];
    if (dim === 'requestPath' && groupDelta && result[0]) result[0].count += groupDelta;
    if (truncate && dim === 'requestPath') {
      result.length = 0;
      for (let i = 0; i < 10000; i++) result.push({ count: 1, sum: { visits: 1 }, dimensions: { datetimeHour: variables.since, requestPath: `/${i}` } });
    }
    return Response.json({ data: { viewer: { accounts: [{ rows: result }] } } });
  };
  const env = { CF_API_TOKEN: 'test-token', CF_ACCOUNT_ID: 'test-account', CF_SITE_TAG: 'test-site' };
  if (archive) env.ARCHIVE = {
    async get(key) { if (failRead) throw new Error('kv unavailable'); return values.has(key) ? JSON.parse(values.get(key)) : null; },
    async put(key, value) { writes.push(key); if (failWrite) throw new Error('kv unavailable'); values.set(key, value); },
  };
  return { values, writes, calls, cacheCalls, cache, env,
    async get(params = '') {
      const pending = [];
      const response = await worker.fetch(new Request(`https://example.workers.dev/?${params}`, { headers: { Origin: ORIGIN } }), env, { waitUntil(p) { pending.push(p); } });
      await Promise.all(pending);
      return { response, body: await response.json() };
    },
  };
}
function record(date, eventHour = 12, count = 1) {
  const v = new Array(24).fill(0);
  v[eventHour] = count;
  const detail = Array.from({ length: 24 }, (_, hour) => hour === eventHour ? { test: [count, count] } : {});
  return { version: 2, v, w: [...v], p: detail, d: detail, b: detail, o: detail, r: detail, errors: {},
    source: { account: 'test-account', site: 'test-site', narrowedBy: 'siteTag' },
    since: `${date}T00:00:00.000Z`, until: new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString(), at: now && new Date(now).toISOString() };
}
function assertSums(body) {
  assert.equal(body.byDay.reduce((n, row) => n + (row.views || 0), 0), body.totals.views);
  assert.equal(body.groups.hour.rows.reduce((n, row) => n + row.views, 0), body.totals.views);
  for (const name of ['page', 'device', 'browser', 'os', 'referer']) {
    assert.equal(body.groups[name].status, 'complete', name);
    assert.equal(body.groups[name].totalViews, body.totals.views, name);
    assert.equal(body.groups[name].totalVisits, body.totals.visits, name);
  }
}

test('calendar is always New York and includes real 23-hour and 25-hour days', () => {
  const spring = requestedRange(new URLSearchParams('start=2026-03-08&end=2026-03-08'), now);
  assert.equal((Date.parse(spring.until) - Date.parse(spring.since)) / 3600000, 23);
  const fall = requestedRange(new URLSearchParams('start=2025-11-02&end=2025-11-02'), now);
  assert.equal((Date.parse(fall.until) - Date.parse(fall.since)) / 3600000, 25);
  assert.equal(civilDate(midnight('2026-10-01')), '2026-10-01');
  const afterMidnight = requestedRange(new URLSearchParams('days=1'), Date.parse('2026-10-02T04:00:01Z'));
  assert.equal(afterMidnight.start, '2026-10-02');
});

test('one exact New York day excludes adjacent evenings and next midnight in every panel', async () => {
  const f = fixture({ events: [
    { at: '2026-09-30T03:59:59Z', requestPath: '/excluded' },
    { at: '2026-09-30T04:00:00Z', requestPath: '/included', views: 3 },
    { at: '2026-10-01T03:59:59Z', requestPath: '/included', views: 2 },
    { at: '2026-10-01T04:00:00Z', requestPath: '/excluded' },
  ] });
  const { body } = await f.get('start=2026-09-30&end=2026-09-30');
  assert.equal(body.schemaVersion, 2);
  assert.equal(body.range.since, '2026-09-30T04:00:00.000Z');
  assert.equal(body.range.until, '2026-10-01T04:00:00.000Z');
  assert.equal(body.totals.views, 5);
  assert.equal(body.coverage.coveredHours, 24);
  assert.equal(body.groups.page.rows.length, 1);
  assertSums(body);
});

test('a frozen asOf excludes later events within the same hour and range buttons reuse it', async () => {
  const f = fixture({ events: [
    { at: '2026-10-01T21:10:00Z' }, { at: '2026-10-01T21:40:00Z' },
  ] });
  const asOf = '2026-10-01T21:30:00Z';
  const first = await f.get(`days=1&asOf=${asOf}`);
  const queries = f.calls.length;
  const second = await f.get(`days=2&asOf=${asOf}`);
  assert.equal(first.body.totals.views, 1);
  assert.equal(second.body.totals.views, 1);
  assert.equal(f.calls.length - queries, 6, 'only the additional completed date is queried');
  assert(!f.writes.includes('d2:2026-10-01'), 'a partial UTC day is never persisted');
  assertSums(first.body);
});

test('measured zero is distinct from unavailable history outside the sync window', async () => {
  const f = fixture();
  const zero = await f.get('start=2026-09-30&end=2026-09-30');
  assert.equal(zero.body.totals.views, 0);
  assert.equal(zero.body.coverage.status, 'complete');
  const missing = await f.get('start=2025-01-01&end=2025-01-01');
  assert.equal(missing.body.totals.views, null);
  assert.equal(missing.body.byDay[0].views, null);
  assert.equal(missing.body.byDay[0].status, 'unavailable');
  assert.equal(missing.response.headers.get('cache-control'), 'no-store');
});

test('legacy nonzero hourly totals are partial and old whole-UTC-day categories are never reused', async () => {
  const f = fixture();
  f.env.CF_ACCOUNT_ID = '04b085d9f19ac1ba6d333e0006fc94c1';
  f.env.CF_SITE_TAG = 'abd00a69157843b2bb7275c8a265d88f';
  const old = record('2026-07-15', 18, 4);
  delete old.version;
  old.p = { '/wrong-whole-day-total': [9, 9] };
  f.values.set('m:2026-07', JSON.stringify({ '2026-07-15': old }));
  const { body, response } = await f.get('start=2026-07-15&end=2026-07-15');
  assert.equal(body.totals.views, 4);
  assert.equal(body.coverage.status, 'partial');
  assert.equal(body.groups.page.status, 'unavailable');
  assert.equal(body.groups.page.rows.length, 0);
  assert.equal(body.groups.page.unattributedViews, 4);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('category failures are explicit while valid totals are saved without caching a successful response', async () => {
  const f = fixture({ failGroup: 'requestPath', events: [{ at: '2026-09-30T12:00:00Z' }] });
  const { body, response } = await f.get('start=2026-09-30&end=2026-09-30');
  assert.equal(body.totals.views, 1);
  assert.equal(body.groups.page.status, 'unavailable');
  assert.equal(body.collection.status, 'degraded');
  assert.match(body.collection.errors[0], /temporarily unavailable/);
  assert.equal(f.writes.length, 2);
  assert.match(JSON.parse(f.values.get('d2:2026-09-30')).errors.page, /temporarily unavailable/);
  assert.equal(f.cache.size, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('a failed category query stays unavailable even when the measured total is zero', async () => {
  const f = fixture({ failGroup: 'requestPath' });
  const { body, response } = await f.get('date=2026-09-30');
  assert.equal(body.totals.views, 0);
  assert.equal(body.coverage.status, 'complete');
  assert.equal(body.groups.page.status, 'unavailable');
  assert.match(body.groups.page.message, /could not be collected/);
  assert.equal(body.coverage.detailStatus, 'partial');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('total query failures cannot create fake zero records', async () => {
  const f = fixture({ failGroup: 'datetimeHour' });
  const { body } = await f.get('days=1');
  assert.equal(body.totals.views, null);
  assert.equal(body.coverage.status, 'unavailable');
  assert.equal(body.collection.status, 'degraded');
  assert.equal(f.writes.length, 0);
});

test('archive write and read errors remain visible and disable response caching', async () => {
  for (const option of ['failWrite', 'failRead']) {
    const f = fixture({ [option]: true, events: [{ at: '2026-09-30T12:00:00Z' }] });
    const { body, response } = await f.get('start=2026-09-30&end=2026-09-30');
    assert.equal(body.totals.views, 1);
    assert.equal(body.collection.status, 'degraded');
    assert.match(body.collection.errors.join(' '), /Archive (read|write) failed/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert(!f.values.has('index'), 'a failed write never advances the old archive index');
  }
});

test('page and referral rows are neither truncated nor mislabeled as unique people', async () => {
  const events = Array.from({ length: 40 }, (_, i) => ({ at: '2026-09-30T12:00:00Z', requestPath: `/page-${i}`,
    refererHost: i % 2 ? 'www.baismedrashoflakewoodcommons.org' : 'https://baismedrashoflakewoodcommons.org/week/' }));
  const f = fixture({ events });
  const { body } = await f.get('start=2026-09-30&end=2026-09-30');
  assert.equal(body.groups.page.rows.length, 40);
  assert.equal(body.groups.referer.rows.length, 1);
  assert.equal(body.groups.referer.rows[0].key, '(same site)');
  assert.match(body.metrics.visits, /not unique people/);
  assertSums(body);
});

test('row-limit and sampling differences stay visible without inventing or scaling counts', async () => {
  const limited = fixture({ truncate: true });
  const limit = await limited.get('start=2026-09-30&end=2026-09-30');
  assert.match(limit.body.collection.errors.join(' '), /row limit/);
  assert.equal(limited.writes.length, 2);
  assert.match(JSON.parse(limited.values.get('d2:2026-09-30')).errors.page, /row limit/);
  const sampled = fixture({ groupDelta: 2, events: [{ at: '2026-09-30T12:00:00Z' }] });
  const { body, response } = await sampled.get('start=2026-09-30&end=2026-09-30');
  assert.equal(body.totals.views, 1);
  assert.equal(body.groups.page.totalViews, 3);
  assert.equal(body.groups.page.differenceViews, -2);
  assert.equal(body.groups.page.status, 'partial');
  assert.match(body.groups.page.message, /Sampling/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('positive sampling differences do not manufacture missing-detail rows', async () => {
  const f = fixture({ groupDelta: -2, events: [{ at: '2026-09-30T12:00:00Z', views: 10 }] });
  const { body } = await f.get('date=2026-09-30');
  assert.equal(body.totals.views, 10);
  assert.equal(body.groups.page.totalViews, 8);
  assert.equal(body.groups.page.differenceViews, 2);
  assert.equal(body.groups.page.unattributedViews, 0);
  assert.equal(body.groups.page.reconciliationDeltaViews, 2);
});

test('missing detail uses measured hourly totals separately from provider differences', async () => {
  const f = fixture();
  const sampled = record('2026-07-15', 12, 10);
  sampled.p = Array.from({ length: 24 }, (_, hour) => hour === 12 ? { test: [3, 8] } : {});
  const missing = record('2026-07-16', 1, 4);
  delete missing.p;
  missing.errors.page = 'The page query failed';
  f.values.set('d2:2026-07-15', JSON.stringify(sampled));
  f.values.set('d2:2026-07-16', JSON.stringify(missing));
  const { body } = await f.get('date=2026-07-15');
  assert.equal(body.totals.views, 14);
  assert.equal(body.groups.page.totalViews, 8);
  assert.equal(body.groups.page.unattributedViews, 4);
  assert.equal(body.groups.page.reconciliationDeltaViews, 2);
  assert.equal(body.groups.page.totalVisits, 3);
  assert.equal(body.groups.page.unattributedVisits, 4);
  assert.equal(body.groups.page.reconciliationDeltaVisits, 7);
});

test('persistent category failures preserve totals and do not starve missing dates', async () => {
  const f = fixture({ failGroup: 'requestPath' });
  await f.get('start=2026-09-10&end=2026-09-20');
  const firstDates = new Set(f.values.keys());
  assert.equal(firstDates.size, 5);
  f.writes.length = 0;
  await f.get('start=2026-09-10&end=2026-09-20');
  assert.equal(f.values.size, 10);
  assert(f.writes.every((key) => !firstDates.has(key)), 'uncollected totals take priority over retrying broken categories');
  const third = await f.get('start=2026-09-10&end=2026-09-20');
  assert.equal(third.body.coverage.status, 'complete');
  assert.equal(third.body.groups.page.status, 'unavailable');
});

test('previous successful category detail is retained when a later repair fails', async () => {
  const f = fixture({ failGroup: 'requestPath', events: [{ at: '2026-09-30T12:00:00Z' }] });
  const prior = record('2026-09-30');
  prior.errors.browser = 'Previous browser query failed';
  delete prior.b;
  f.values.set('d2:2026-09-30', JSON.stringify(prior));
  await f.get('date=2026-09-30');
  const saved = JSON.parse(f.values.get('d2:2026-09-30'));
  assert.deepEqual(saved.retainedDetails.page, prior.p);
  assert.equal(saved.w[12], 1);
  assert.match(saved.errors.page, /temporarily unavailable/);
});

test('source overrides cannot reuse another source response cache or archived record', async () => {
  const events = [{ at: '2026-09-30T12:00:00Z', views: 1 }];
  const live = fixture({ archive: false, events });
  const first = await live.get('date=2026-09-30');
  assert.equal(first.body.totals.views, 1);
  events[0].views = 7;
  live.env.CF_ACCOUNT_ID = 'another-account';
  const second = await live.get('date=2026-09-30');
  assert.equal(second.body.totals.views, 7);
  events[0].views = 9;
  live.env.CF_SITE_TAG = 'another-site';
  const third = await live.get('date=2026-09-30');
  assert.equal(third.body.totals.views, 9);
  const archived = fixture({ events });
  await archived.get('date=2026-09-30');
  const saved = new Map(archived.values);
  archived.env.CF_SITE_TAG = 'different-site';
  const rejected = await archived.get('date=2026-09-30');
  assert.equal(rejected.body.totals.views, null);
  assert.match(rejected.body.collection.errors.join(' '), /source conflict/);
  assert.deepEqual(archived.values, saved, 'conflicting records are not overwritten');
});

test('legacy archive is usable only for its original known analytics source', async () => {
  const f = fixture();
  const old = record('2026-07-15', 12, 99);
  delete old.version;
  delete old.source;
  f.values.set('m:2026-07', JSON.stringify({ '2026-07-15': old }));
  const { body } = await f.get('date=2026-07-15');
  assert.equal(body.totals.views, null);
  assert.match(body.collection.errors.join(' '), /original analytics source/);
  assert.equal(f.writes.length, 0);
});

test('bounded migration targets requested dates and preserves already archived older days', async () => {
  const f = fixture();
  f.values.set('d2:2026-09-10', JSON.stringify(record('2026-09-10', 12, 7)));
  const { body } = await f.get('start=2026-09-10&end=2026-09-20');
  assert.equal(body.totals.views, 7);
  assert.equal(body.collection.collected.length, 5);
  assert.equal(body.collection.remainingDays, 6);
  assert(f.calls.every((call) => call.since >= '2026-09-10' && call.since < '2026-09-22'));
  assert.equal(body.coverage.status, 'partial');
});

test('archive-free 30-day requests query the exact eligible window in only six calls', async () => {
  const f = fixture({ archive: false, events: [
    { at: '2026-09-03T12:00:00Z', views: 4 },
    { at: '2026-09-29T12:00:00Z', views: 5 },
    { at: '2026-10-02T01:59:00Z', views: 6 },
  ] });
  const { body } = await f.get('start=2026-09-03&end=2026-10-01');
  assert.equal(body.archive, 'off');
  assert.equal(body.totals.views, 15);
  assert.equal(f.calls.length, 6);
  assertSums(body);
});

test('Worker handles repeated fall-back hours and skips the missing spring-forward hour', async () => {
  const originalNow = now;
  try {
    now = Date.parse('2026-11-02T12:00:00Z');
    const f = fixture({ archive: false, events: [
      { at: '2026-11-01T05:30:00Z', views: 2 },
      { at: '2026-11-01T06:30:00Z', views: 3 },
    ] });
    const { body } = await f.get('date=2026-11-01');
    assert.equal(body.coverage.expectedHours, 25);
    assert.equal(body.coverage.coveredHours, 25);
    assert.equal(body.totals.views, 5);
    assertSums(body);
    now = Date.parse('2026-03-09T12:00:00Z');
    const spring = fixture({ archive: false });
    const result = await spring.get('date=2026-03-08');
    assert.equal(result.body.coverage.expectedHours, 23);
    assert.equal(result.body.coverage.coveredHours, 23);
    assertSums(result.body);
  } finally { now = originalNow; }
});

test('small future client clock skew clamps the snapshot to server time', async () => {
  const f = fixture({ archive: false });
  const requested = new Date(now + 30000).toISOString();
  const { body, response } = await f.get(`days=1&asOf=${requested}`);
  assert.equal(response.status, 200);
  assert.equal(body.snapshotAt, new Date(now).toISOString());
  assert.equal(body.snapshotAdjusted, true);
  assert.equal(body.until, body.snapshotAt);
  assert.equal((await f.get(`days=1&asOf=${new Date(now + 120001).toISOString()}`)).response.status, 400);
});

test('scheduled collection stays below free upstream limits and advances the archive on later runs', async () => {
  const originalNow = now;
  const f = fixture();
  async function run(at) {
    now = Date.parse(at);
    f.calls.length = 0;
    f.cacheCalls.length = 0;
    f.cache.clear();
    const pending = [];
    await worker.scheduled({ scheduledTime: now }, f.env, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);
    assert(f.calls.length + f.cacheCalls.length <= 48);
    assert(f.calls.length > 0);
  }
  try {
    await run('2026-10-02T04:00:00Z');
    assert.equal(f.values.size, 5);
    assert.equal(f.calls.length, 30);
    await run('2026-10-03T04:00:00Z');
    assert(f.values.size > 5, 'existing days do not prevent older missing days from being collected');
    assert(f.values.has('d2:2026-09-25'));
  } finally { now = originalNow; }
});

test('dimension fallbacks cannot exceed the hard upstream budget', async () => {
  const f = fixture({ unknownCategories: true });
  const { body, response } = await f.get('days=30');
  assert.equal(body.sync.upstreamRequests + body.sync.cacheRequests, 48);
  assert(f.calls.length + f.cacheCalls.length <= 50, 'fetch and Cache API share the free request quota');
  assert.equal(body.collection.status, 'degraded');
  assert.match(body.collection.errors.join(' '), /request budget/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('explicit provider throttling pauses retries for five minutes and preserves prior current-day counts', async () => {
  const originalNow = now;
  try {
    for (const mode of ['graphql', 'http429']) {
      now = Date.parse('2026-10-02T02:00:00Z');
      const f = fixture({ events: [{ at: '2026-10-02T01:00:00Z', views: 7 }] });
      f.env.CF_ACCOUNT_ID = `throttle-test-${mode}`;
      const first = await f.get('days=1');
      assert.equal(first.body.totals.views, 7);
      const workingFetch = globalThis.fetch;
      let upstream = 0;
      let rateLimited = true;
      globalThis.fetch = async (...args) => {
        upstream += 1;
        if (!rateLimited) return workingFetch(...args);
        return mode === 'http429' ? Response.json({ errors: [] }, { status: 429 })
          : Response.json({ errors: [{ message: 'Rate limiter budget depleted. Please try again after 5 minutes.' }] });
      };
      now += 60000;
      const limited = await f.get('days=7');
      assert(upstream <= 6, 'only already-started parallel grouping requests can finish');
      assert.equal(limited.body.totals.views, 7);
      assert.equal(limited.body.collection.status, 'degraded');
      assert.match(limited.body.collection.errors.join(' '), /temporarily rate-limited/);
      assert.equal(limited.body.collection.retryAfterSeconds, 300);
      assert.equal(limited.body.collection.cooldownUntil, new Date(now + 300000).toISOString());
      assert.equal(limited.response.headers.get('cache-control'), 'no-store');
      const sent = upstream;
      now += 1000;
      const retry = await f.get('days=30');
      assert.equal(upstream, sent, 'refreshing during cooldown must not query the provider');
      assert.equal(retry.body.totals.views, 7);
      assert.equal(retry.body.collection.retryAfterSeconds, 299);
      now += 300000;
      rateLimited = false;
      const resumed = await f.get('days=1');
      assert(upstream > sent, 'collection resumes after the cooldown');
      assert.equal(resumed.body.collection.status, 'ok');
      assert.equal(resumed.body.totals.views, 7);
    }
  } finally { now = originalNow; }
});

test('rate limiting is isolated to its source and archive-free readers keep their last good snapshot', async () => {
  const originalNow = now;
  try {
    const f = fixture({ archive: false, events: [{ at: '2026-10-02T01:00:00Z', views: 4 }] });
    f.env.CF_ACCOUNT_ID = 'throttle-test-live';
    assert.equal((await f.get('days=1')).body.totals.views, 4);
    const workingFetch = globalThis.fetch;
    let mode = 'limited';
    let upstream = 0;
    globalThis.fetch = async (...args) => {
      upstream += 1;
      return mode === 'limited' ? Response.json({}, { status: 429 }) : workingFetch(...args);
    };
    now += 60000;
    const limited = await f.get('days=1');
    assert.equal(limited.response.status, 200);
    assert.equal(limited.body.totals.views, 4);
    assert.equal(limited.body.collection.status, 'degraded');
    const sent = upstream;
    now += 1000;
    await f.get('days=1');
    assert.equal(upstream, sent);
    mode = 'working';
    f.env.CF_SITE_TAG = 'unrelated-site';
    const other = await f.get('days=1');
    assert(upstream > sent);
    assert.equal(other.body.collection.status, 'ok');
  } finally { now = originalNow; }
});

test('validation and existing CORS/method behavior are preserved', async () => {
  const f = fixture();
  for (const params of ['start=2026-02-30&end=2026-03-01', 'start=2026-10-01&end=2026-09-30', 'days=801', 'days=-1', 'asOf=2040-01-01T00:00:00Z']) {
    assert.equal((await f.get(params)).response.status, 400, params);
  }
  const ctx = { waitUntil() {} };
  assert.equal((await worker.fetch(new Request('https://example.workers.dev/'), f.env, ctx)).status, 403);
  assert.equal((await worker.fetch(new Request('https://example.workers.dev/', { method: 'POST', headers: { Origin: ORIGIN } }), f.env, ctx)).status, 405);
  assert.equal((await worker.fetch(new Request('https://example.workers.dev/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), f.env, ctx)).status, 204);
});

test.after(() => { globalThis.Date = NativeDate; });
