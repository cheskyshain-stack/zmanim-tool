import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

// Exercise the real rendering functions without introducing exports into the offline bundle.
const source = await readFile(new URL('../js/ui/traffic-view.js', import.meta.url), 'utf8');
// The Worker suite replaces global Date. Keep this renderer's clock independent
// so combined tests and later calendar dates cannot expire a cooldown fixture.
const UITestNativeDate = vm.runInNewContext('Date');
const uiNow = UITestNativeDate.parse('2026-10-02T02:00:00Z');
class UITestDate extends UITestNativeDate {
  constructor(...args) { super(...(args.length ? args : [uiNow])); }
  static now() { return uiNow; }
}
const context = vm.createContext({ Intl, Date: UITestDate, URL, URLSearchParams, Map, Set });
vm.runInContext(source.replace('export function renderTraffic', 'function renderTraffic') + `
globalThis.trafficTest = {
  today: trafficToday, dates: trafficDates, validate: trafficValidateRange,
  referrer: trafficReferrer, dailyRows: trafficDailyRows, summary: trafficSummary,
  content: trafficContent, breakdown: trafficBreakdown, patterns: trafficPatterns,
  reconciliation: trafficReconciliation, periods: trafficChartPeriods, daily: trafficDaily,
  adminStats: trafficAdminStats, adminActivity: trafficAdminActivity,
  preset(key, snapshot) { trafficSelection = { preset: key }; trafficSnapshot = snapshot; return trafficWindow(); },
  selectPreset(key, now) { trafficSelectPreset(key, now); return { range: trafficWindow(), snapshot: trafficSnapshot, cached: trafficCache.size }; },
  keepResponse() { trafficCache.set('completed-window', {}); },
};`, context);
const ui = context.trafficTest;
const range = { start: '2026-09-28', end: '2026-09-29', since: '2026-09-28T04:00:00Z', until: '2026-09-30T04:00:00Z' };

function report(overrides = {}) {
  return {
    schemaVersion: 2, timezone: 'America/New_York', range,
    totals: { views: 100, visits: 20 },
    byDay: [
      { date: '2026-09-28', views: 40, visits: 8, status: 'complete' },
      { date: '2026-09-29', views: 60, visits: 12, status: 'complete' },
    ],
    coverage: { status: 'complete', detailStatus: 'complete', coveredHours: 48, expectedHours: 48 },
    groups: {}, collection: { status: 'ok', errors: [] }, archive: 'on',
    fetchedAt: '2026-09-30T12:00:00Z', snapshotAt: '2026-09-30T12:00:00Z',
    ...overrides,
  };
}

test('Today and presets follow New York, including after UTC midnight', () => {
  assert.equal(ui.today('2026-10-02T02:00:00Z'), '2026-10-01');
  const week = ui.preset('7', '2026-10-02T02:00:00Z');
  assert.equal(week.start, '2026-09-25');
  assert.equal(week.end, '2026-10-01');
  const yesterday = ui.preset('yesterday', '2026-10-02T02:00:00Z');
  assert.equal(yesterday.start, '2026-09-30');
  assert.equal(yesterday.end, '2026-09-30');
});

test('preset clicks keep their anchor until New York midnight, then refresh Today and clear old responses', () => {
  const anchor = '2026-10-01T23:30:00.000Z';
  ui.preset('7', anchor);
  ui.keepResponse();
  const before = ui.selectPreset('today', '2026-10-02T03:59:00Z');
  assert.equal(before.snapshot, anchor);
  assert.equal(before.range.start, '2026-10-01');
  assert.equal(before.cached, 1);
  const after = ui.selectPreset('today', '2026-10-02T04:01:00Z');
  assert.equal(after.snapshot, '2026-10-02T04:01:00.000Z');
  assert.equal(after.range.start, '2026-10-02');
  assert.equal(after.range.end, '2026-10-02');
  assert.equal(after.cached, 0);
  const week = ui.selectPreset('7', '2026-10-02T05:01:00Z');
  assert.equal(week.snapshot, after.snapshot);
  assert.equal(week.range.start, '2026-09-26');
});

test('custom ranges validate real dates, order, future dates and the inclusive limit', () => {
  assert.match(ui.validate('2026-02-30', '2026-03-01', '2026-10-01'), /valid start/);
  assert.match(ui.validate('', '2026-10-01', '2026-10-01'), /valid start/);
  assert.match(ui.validate('2026-10-01', '2026-09-30', '2026-10-01'), /on or after/);
  assert.match(ui.validate('2026-10-01', '2026-10-02', '2026-10-01'), /today or an earlier/);
  assert.match(ui.validate('2025-01-01', '2026-01-02', '2026-10-01'), /366 days/);
  assert.equal(ui.validate('2024-01-01', '2024-12-31', '2026-10-01'), '');
  assert.equal(ui.validate('2026-10-01', '2026-10-01', '2026-10-01'), '');
});

test('a missing daily record is unavailable, never a manufactured zero', () => {
  const data = report({ byDay: [{ date: '2026-09-28', views: 0, visits: 0, status: 'complete' }] });
  const days = ui.dailyRows(data, range);
  assert.equal(days.length, 2);
  assert.equal(days[0].views, 0);
  assert.equal(days[0].status, 'complete');
  assert.equal(days[1].views, null);
  assert.equal(days[1].visits, null);
  assert.equal(days[1].status, 'unavailable');
});

test('verified zero and missing history have different headline and empty states', () => {
  const empty = report({ totals: { views: 0, visits: 0 }, byDay: [
    { date: range.start, views: 0, visits: 0, status: 'complete' },
    { date: range.end, views: 0, visits: 0, status: 'complete' },
  ] });
  assert.match(ui.content(empty, range), /No page views recorded/);
  assert.match(ui.summary(empty, empty.byDay), /traffic-total-n">0</);
  const missing = report({ totals: { views: null, visits: null }, byDay: [], coverage: { status: 'unavailable', detailStatus: 'unavailable' } });
  const missingHtml = ui.content(missing, range);
  assert.match(missingHtml, /No record available for this range/);
  assert.match(missingHtml, /traffic-total-n">Unavailable</);
  assert.doesNotMatch(missingHtml, /No page views recorded/);
});

test('partial history qualifies recorded totals without discarding the known counts', () => {
  const partial = report({ totals: { views: 40, visits: 8 }, byDay: [{ date: range.start, views: 40, visits: 8, status: 'complete' }], coverage: { status: 'partial', detailStatus: 'partial' } });
  const html = ui.content(partial, range);
  assert.match(html, /This range has missing history/);
  assert.match(html, /Recorded page views/);
  assert.match(html, /traffic-total-n">40</);
  assert.match(html, /1 complete day, 1 unavailable/);
});

test('provider cooldown retains figures and shows a New York retry time without repeated-refresh advice', () => {
  const data = report({ collection: { status: 'degraded', errors: ['Provider throttled collection'], remainingDays: 12,
    cooldownUntil: new UITestDate(uiNow + 15 * 60000).toISOString(), retryAfterSeconds: 900 } });
  const html = ui.content(data, range);
  assert.match(html, /Collection paused/);
  assert.match(html, /Available figures are retained/);
  assert.match(html, /Next collection retry/);
  assert.match(html, /New York time/);
  assert.match(html, /traffic-total-n">100</);
  assert.doesNotMatch(html, /Collection needs attention/);
  assert.doesNotMatch(html, /Refresh to check progress/);
  assert.match(html, /Repair resumes after the retry time above/);
});

test('breakdown shares use the headline denominator and account for missing detail', () => {
  const data = report({ groups: { device: { status: 'partial', rows: [{ key: 'mobile', views: 25, visits: 5 }], totalViews: 25, totalVisits: 5, unattributedViews: 75, unattributedVisits: 15 } } });
  const html = ui.breakdown(data, 'device', 'Devices', 'Device views');
  assert.match(html, /traffic-share">25%</);
  assert.match(html, /Detail not available/);
  assert.match(html, /traffic-figure">75</);
  assert.match(html, /Shares use 100 recorded page views/);
});

test('sampled or inconsistent breakdowns expose excess counts without rebasing', () => {
  const data = report({ groups: { device: { status: 'partial', rows: [{ key: 'mobile', views: 125, visits: 22 }], totalViews: 125, totalVisits: 22, unattributedViews: 0 } } });
  const html = ui.breakdown(data, 'device', 'Devices', 'Device views');
  assert.match(html, /Source totals differ/);
  assert.match(html, /25 more in this breakdown/);
  assert.match(html, /traffic-share">125%</);
  assert.match(html, /traffic-figure">125</);
  assert.match(ui.reconciliation(data, [{ views: 99 }]), /Daily values do not match the total/);
});

test('provider undercounts remain differences, never manufactured missing-detail rows', () => {
  const data = report({ groups: { page: { status: 'partial', rows: [{ key: '/', views: 80, visits: 18 }], totalViews: 80, totalVisits: 18, unattributedViews: 0, unattributedVisits: 0, reconciliationDeltaViews: 20, reconciliationDeltaVisits: 2 } } });
  const html = ui.breakdown(data, 'page', 'Pages viewed', 'Page views', { visits: true });
  assert.doesNotMatch(html, /class="traffic-residual"/);
  assert.match(html, /Page views: displayed rows total 80, compared with 100 overall \(20 fewer/);
  assert.match(html, /Entry visits: displayed rows total 18, compared with 20 overall \(2 fewer/);
  assert.match(html, /<tfoot>.*traffic-figure">80<.*traffic-figure">18</s);
});

test('entry-visit-only missing detail is a visible row included in the footer', () => {
  const data = report({ groups: { page: { status: 'partial', rows: [{ key: '/', views: 100, visits: 18 }], totalViews: 100, totalVisits: 18, unattributedViews: 0, unattributedVisits: 2, reconciliationDeltaViews: 0, reconciliationDeltaVisits: 0 } } });
  const html = ui.breakdown(data, 'page', 'Pages viewed', 'Page views', { visits: true });
  assert.match(html, /class="traffic-residual".*traffic-figure">0<.*traffic-figure">2</s);
  assert.match(html, /<tfoot>.*traffic-figure">100<.*traffic-figure">20</s);
  assert.doesNotMatch(html, /Source totals differ/);
});

test('entry-visit differences are reported even when page-view totals agree', () => {
  const data = report({ groups: { page: { status: 'partial', rows: [{ key: '/', views: 100, visits: 23 }], totalViews: 100, totalVisits: 23, unattributedViews: 0, unattributedVisits: 0, reconciliationDeltaViews: 0, reconciliationDeltaVisits: -3 } } });
  const html = ui.breakdown(data, 'page', 'Pages viewed', 'Page views', { visits: true });
  assert.match(html, /Entry visits: displayed rows total 23, compared with 20 overall \(3 more/);
  assert.doesNotMatch(html, /Page views: displayed rows total/);
  assert.doesNotMatch(html, /class="traffic-residual"/);
});

test('footers add visible rows rather than trusting an inconsistent supplied subtotal', () => {
  const data = report({ groups: { page: { status: 'partial', rows: [{ key: '/', views: 50, visits: 10 }], totalViews: 100, totalVisits: 20, unattributedViews: 0, unattributedVisits: 0 } } });
  const html = ui.breakdown(data, 'page', 'Pages viewed', 'Page views', { visits: true });
  assert.match(html, /<tfoot>.*traffic-figure">50<.*traffic-figure">10</s);
  assert.match(html, /Source totals differ/);
});

test('normalized and legacy referrer keys receive meaningful labels', () => {
  assert.equal(ui.referrer('(direct)'), 'Direct / no referrer');
  assert.equal(ui.referrer('(none)'), 'Direct / no referrer');
  assert.equal(ui.referrer('(same site)'), 'This site (internal navigation)');
  assert.equal(ui.referrer('https://baismedrashoflakewoodcommons.org/week/'), 'This site (internal navigation)');
  assert.equal(ui.referrer('example.com'), 'example.com');
});

function hourly(since, until, select = () => true) {
  const rows = [];
  for (let at = Date.parse(since); at < Date.parse(until); at += 3600000) {
    if (select(at)) rows.push({ key: new Date(at).toISOString(), views: 1, visits: 1, status: 'complete' });
  }
  return rows;
}

test('spring DST has 23 slots and does not turn the skipped 2 AM into zero views', () => {
  const since = '2027-03-14T05:00:00Z';
  const until = '2027-03-15T04:00:00Z';
  const rows = hourly(since, until);
  assert.equal(rows.length, 23);
  const data = report({ range: { since, until }, groups: { hour: { status: 'complete', rows } } });
  const html = ui.patterns(data, []);
  assert.match(html, /<span>2 AM<\/span><strong>N\/A<\/strong>/);
  assert.match(html, /<span>3 AM<\/span><strong>1<\/strong>/);
});

test('fall DST combines both real 1 AM hours, preserving their two views', () => {
  const since = '2026-11-01T04:00:00Z';
  const until = '2026-11-02T05:00:00Z';
  const rows = hourly(since, until);
  assert.equal(rows.length, 25);
  const data = report({ range: { since, until }, groups: { hour: { status: 'complete', rows } } });
  assert.match(ui.patterns(data, []), /<span>1 AM<\/span><strong>2<\/strong>/);
});

test('partial hourly history marks unknown slots and partial aggregates explicitly', () => {
  const since = '2026-09-28T04:00:00Z';
  const until = '2026-09-30T04:00:00Z';
  const rows = hourly(since, until, (at) => at !== Date.parse('2026-09-29T05:00:00Z') && !['2026-09-28T06:00:00.000Z', '2026-09-29T06:00:00.000Z'].includes(new Date(at).toISOString()));
  const data = report({ range: { since, until }, groups: { hour: { status: 'partial', rows } } });
  const html = ui.patterns(data, []);
  assert.match(html, /<span>1 AM<\/span><strong>1\*<\/strong>/);
  assert.match(html, /<span>2 AM<\/span><strong>N\/A<\/strong>/);
  assert.match(html, /<span>3 AM<\/span><strong>2<\/strong>/);
});

test('untrusted category names and source errors are escaped in the UI', () => {
  const data = report({ groups: { browser: { status: 'complete', rows: [{ key: '<img src=x onerror=alert(1)>', views: 100, visits: 20 }], totalViews: 100, totalVisits: 20 } } });
  const html = ui.breakdown(data, 'browser', 'Browsers', 'Browser views');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

function daysIn(start, end) {
  return ui.dates(start, end).map((date) => ({ date, views: 1, visits: 1, status: 'complete' }));
}

test('short ranges keep individual days and 90 days become thirteen exact weekly blocks', () => {
  const short = ui.periods(daysIn('2026-10-01', '2026-10-31'));
  assert.equal(short.granularity, 'day');
  assert.equal(short.periods.length, 31);
  const daily = daysIn('2026-09-01', '2026-11-29');
  const chart = ui.periods(daily);
  assert.equal(chart.granularity, 'week');
  assert.equal(chart.periods.length, 13);
  assert.equal(chart.periods[0].start, '2026-09-01');
  assert.equal(chart.periods[0].end, '2026-09-07');
  assert.equal(chart.periods.at(-1).start, '2026-11-24');
  assert.equal(chart.periods.at(-1).end, '2026-11-29');
  assert.equal(chart.periods.at(-1).views, 6);
  assert.equal(chart.periods.reduce((sum, row) => sum + row.views, 0), 90);
});

test('long ranges aggregate clipped calendar months and preserve every view', () => {
  const daily = daysIn('2026-09-28', '2027-02-03');
  const chart = ui.periods(daily);
  assert.equal(chart.granularity, 'month');
  assert.equal(chart.periods.length, 6);
  assert.equal(chart.periods[0].start, '2026-09-28');
  assert.equal(chart.periods[0].end, '2026-09-30');
  assert.equal(chart.periods[0].views, 3);
  assert.equal(chart.periods[1].views, 31);
  assert.equal(chart.periods.at(-1).start, '2027-02-01');
  assert.equal(chart.periods.at(-1).end, '2027-02-03');
  assert.equal(chart.periods.reduce((sum, row) => sum + row.views, 0), daily.length);
  assert.equal(ui.periods(daysIn('2026-10-01', '2027-09-30')).periods.length, 12);
});

test('aggregates distinguish missing periods, measured zero and mixed partial records', () => {
  const daily = daysIn('2026-09-01', '2026-10-02');
  daily.forEach((day, index) => {
    if (index < 7) { day.views = null; day.visits = null; day.status = 'unavailable'; }
    if (index >= 7 && index < 14) { day.views = 0; day.visits = 0; }
    if (index === 14) { day.views = null; day.visits = null; day.status = 'unavailable'; }
  });
  const chart = ui.periods(daily);
  assert.equal(chart.periods[0].status, 'unavailable');
  assert.equal(chart.periods[0].views, null);
  assert.equal(chart.periods[1].status, 'complete');
  assert.equal(chart.periods[1].views, 0);
  assert.equal(chart.periods[2].status, 'partial');
  assert.equal(chart.periods[2].views, 6);
});

test('compact chart buttons retain exact ranges while the daily table retains every date', () => {
  const daily = daysIn('2026-09-28', '2027-02-03');
  const data = report({ totals: { views: daily.length, visits: daily.length }, byDay: daily });
  const html = ui.daily(data, daily);
  assert.match(html, /Page views by month/);
  assert.match(html, /data-traffic-start="2026-09-28" data-traffic-end="2026-09-30"/);
  assert.match(html, /data-traffic-start="2027-02-01" data-traffic-end="2027-02-03"/);
  assert.equal((html.match(/data-traffic-start=/g) || []).length, 6);
  assert.equal((html.match(/data-traffic-day=/g) || []).length, daily.length);
});

function adminReport(group = { status: 'complete', rows: [] }) {
  return report({ range: { start: '2026-10-02', end: '2026-10-02', since: '2026-10-02T04:00:00Z', until: '2026-10-03T04:00:00Z' }, groups: { page: group } });
}

test('admin opens use page views across the two admin addresses, excluding display control', () => {
  const data = adminReport({ status: 'complete', rows: [
    { key: '/admin/', views: 6, visits: 0 },
    { key: '/admin/index.html', views: 3, visits: 1 },
    { key: '/admin/display/', views: 90, visits: 50 },
    { key: '/admin/elsewhere', views: 20, visits: 20 },
    { key: '/', views: 50, visits: 20 },
  ] });
  assert.equal(ui.adminStats(data).views, 9);
  assert.equal(ui.adminStats(data).status, 'complete');
  assert.match(ui.adminActivity(data), /Admin page opens<\/h3><strong>9<\/strong>/);
});

test('admin history before tracking began is not presented as zero', () => {
  const data = adminReport();
  data.range.until = '2026-10-02T03:45:00Z';
  assert.equal(ui.adminStats(data).views, null);
  assert.equal(ui.adminStats(data).status, 'not-tracked');
  const html = ui.adminActivity(data);
  assert.match(html, /Not tracked yet/);
  assert.doesNotMatch(html, /<strong>0<\/strong>/);
});

test('admin zero requires complete page detail, while measured partial opens are retained', () => {
  const zero = ui.adminStats(adminReport());
  assert.equal(zero.views, 0);
  assert.equal(zero.status, 'complete');
  const missing = ui.adminStats(adminReport({ status: 'unavailable', rows: [] }));
  assert.equal(missing.views, null);
  const partialEmpty = ui.adminStats(adminReport({ status: 'partial', rows: [] }));
  assert.equal(partialEmpty.views, null);
  const partial = adminReport({ status: 'partial', rows: [{ key: '/admin/', views: 4, visits: 0 }] });
  assert.equal(ui.adminStats(partial).views, 4);
  assert.equal(ui.adminStats(partial).status, 'partial');
  assert.match(ui.adminActivity(partial), /traffic-admin-qualifier">Recorded<\/span><strong>4<\/strong>/);
});

test('admin exclusion indicator safely mirrors this browser stored exclusion', () => {
  try {
    context.localStorage = { getItem(key) { assert.equal(key, 'zmanim-nocount'); return '1'; } };
    assert.match(ui.adminActivity(adminReport()), /This browser is excluded from the count/);
    context.localStorage = { getItem() { return null; } };
    assert.match(ui.adminActivity(adminReport()), /This browser has no counting exclusion set/);
    context.localStorage = { getItem() { throw new Error('storage unavailable'); } };
    assert.match(ui.adminActivity(adminReport()), /exclusion setting could not be read/);
  } finally { delete context.localStorage; }
});
