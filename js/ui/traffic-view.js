// All displayed statistics share the Worker's explicit New York window and snapshot.
// Never infer zero from an absent record or make a breakdown fit by scaling its values.
const TRAFFIC_API = 'https://zmanim-traffic.cheskyshain.workers.dev';
const TRAFFIC_ZONE = 'America/New_York';
const TRAFFIC_ADMIN_TRACKING_START = '2026-10-02T03:45:00Z';
const TRAFFIC_RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'yesterday', label: 'Yesterday', days: 1 },
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '1 year', days: 365 },
];
const TRAFFIC_PAGES = {
  '/': 'Home', '/week/': 'Weekly zmanim', '/chart/': 'Zmanim chart',
  '/schedules/': 'Special schedules', '/donate/': 'Donate', '/tv/': 'Shul View',
  '/display/': 'Former display address', '/texts/': 'Messages', '/admin/': 'Admin', '/admin/index.html': 'Admin',
};
const TRAFFIC_DEVICES = { mobile: 'Phone', desktop: 'Desktop', tablet: 'Tablet' };
let trafficSelection = { preset: '7', start: '', end: '' };
let trafficSnapshot = null;
let trafficRequest = null;
let trafficRevision = 0;
const trafficCache = new Map();
const trafficEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trafficKnown = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const trafficNum = (n) => trafficKnown(n) ? n.toLocaleString('en-US') : 'Unavailable';
const trafficPct = (n, total) => trafficKnown(n) && trafficKnown(total) && total > 0
  ? `${(100 * n / total).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : 'N/A';

function trafficToday(instant = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TRAFFIC_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function trafficShift(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function trafficDateLabel(date, full = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return String(date || 'Unavailable');
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: full ? 'long' : 'short', day: 'numeric',
    ...(full ? { year: 'numeric', weekday: 'long' } : {}),
  });
}
function trafficStamp(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Unavailable';
  return at.toLocaleString('en-US', {
    timeZone: TRAFFIC_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function trafficCooldown(data) {
  const until = Date.parse(data.collection?.cooldownUntil);
  return Number.isFinite(until) && until > Date.now() ? trafficStamp(data.collection.cooldownUntil) : '';
}
function trafficWindow() {
  if (!trafficSelection.preset) return { start: trafficSelection.start, end: trafficSelection.end };
  const today = trafficToday(trafficSnapshot);
  const choice = TRAFFIC_RANGES.find((range) => range.key === trafficSelection.preset);
  const end = trafficSelection.preset === 'yesterday' ? trafficShift(today, -1) : today;
  return { start: trafficShift(end, 1 - choice.days), end };
}
function trafficSelectPreset(key, now = new Date()) {
  if (!trafficSnapshot || trafficToday(trafficSnapshot) !== trafficToday(now)) {
    trafficSnapshot = new Date(now).toISOString();
    trafficCache.clear();
  }
  trafficSelection = { preset: key, start: '', end: '' };
}
function trafficDates(start, end) {
  const dates = [];
  for (let date = start; date <= end && dates.length < 800; date = trafficShift(date, 1)) dates.push(date);
  return dates;
}
function trafficValidateRange(start, end, today = trafficToday()) {
  const valid = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid(start) || !valid(end)) return 'Choose a valid start and end date.';
  const length = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
  if (length < 1) return 'Choose an end date on or after the start date.';
  if (length > 366) return 'Choose a range of 366 days or fewer.';
  if (end > today) return 'Choose today or an earlier date.';
  return '';
}
function trafficPageName(path) {
  const value = String(path || '').split('?')[0];
  return TRAFFIC_PAGES[value] || TRAFFIC_PAGES[`${value}/`] || value || 'Page not supplied';
}
function trafficReferrer(key) {
  if (!key || key === '(none)' || key === '(direct)') return 'Direct / no referrer';
  if (key === '(same site)') return 'This site (internal navigation)';
  try {
    const host = new URL(key.includes('://') ? key : `https://${key}`).hostname;
    if (['baismedrashoflakewoodcommons.org', 'www.baismedrashoflakewoodcommons.org', 'lczmanim.cjaffa.com'].includes(host)) {
      return 'This site (internal navigation)';
    }
    return key;
  } catch { return key; }
}
function trafficStatus(status) {
  return status === 'complete' ? 'Complete' : status === 'partial' ? 'Partial' : 'Unavailable';
}
function trafficPill(status, label = trafficStatus(status)) {
  return `<span class="traffic-status traffic-status-${trafficEsc(status || 'unavailable')}">${trafficEsc(label)}</span>`;
}
function trafficNotice(title, message, kind = 'notice') {
  return `<div class="traffic-notice traffic-notice-${kind}"><strong>${trafficEsc(title)}</strong><p>${trafficEsc(message)}</p></div>`;
}
function trafficDailyRows(data, range) {
  const source = data.byDay || data.coverage?.days || [];
  const dates = new Map(source.map((row) => [row.date, row]));
  return trafficDates(range.start, range.end).map((date) => dates.get(date)
    || { date, views: null, visits: null, status: 'unavailable' });
}
function trafficCoverage(data, daily) {
  const status = data.coverage?.status || 'unavailable';
  const complete = daily.filter((row) => row.status === 'complete').length;
  const partial = daily.filter((row) => row.status === 'partial').length;
  const missing = daily.length - complete - partial;
  let detail = `${complete} complete ${complete === 1 ? 'day' : 'days'}`;
  if (partial) detail += `, ${partial} partial`;
  if (missing) detail += `, ${missing} unavailable`;
  return { status, complete, partial, missing, detail };
}
function trafficSummary(data, daily) {
  const coverage = trafficCoverage(data, daily);
  const qualifier = coverage.status === 'partial' ? 'Recorded ' : '';
  return `<div class="traffic-totals">
    <section class="traffic-total traffic-total-primary" aria-label="Page views">
      <span class="traffic-total-label">${qualifier}page views</span>
      <strong class="traffic-total-n">${trafficNum(data.totals?.views)}</strong>
      <p>Pages opened or viewed. One visit can include several.</p>
    </section>
    <section class="traffic-total" aria-label="Entry visits">
      <span class="traffic-total-label">${qualifier}entry visits</span>
      <strong class="traffic-total-n">${trafficNum(data.totals?.visits)}</strong>
      <p>Entries reported by Cloudflare. Not a count of unique people.</p>
    </section>
    <section class="traffic-total" aria-label="Record coverage">
      <span class="traffic-total-label">Record coverage</span>
      <strong class="traffic-total-coverage">${trafficStatus(coverage.status)}</strong>
      <p>${trafficEsc(coverage.detail)}.<br>Today includes only the time elapsed.</p>
    </section>
  </div>`;
}
function trafficBrowserExcluded() {
  try {
    if (!globalThis.localStorage) return null;
    return Boolean(globalThis.localStorage.getItem('zmanim-nocount'));
  } catch { return null; }
}
function trafficAdminStats(data) {
  const until = Date.parse(data.range?.until || data.until || data.snapshotAt);
  if (Number.isFinite(until) && until <= Date.parse(TRAFFIC_ADMIN_TRACKING_START)) {
    return { views: null, status: 'not-tracked' };
  }
  const group = data.groups?.page;
  if (!Number.isFinite(until) || !group || !['complete', 'partial'].includes(group.status)) {
    return { views: null, status: 'unavailable' };
  }
  const adminRows = (group.rows || []).filter((row) => ['/admin/', '/admin/index.html'].includes(String(row.key ?? row.path ?? '').split('?')[0]));
  const validRows = adminRows.filter((row) => trafficKnown(row.views));
  const views = validRows.reduce((total, row) => total + row.views, 0);
  if (group.status === 'complete' && validRows.length === adminRows.length) return { views, status: 'complete' };
  return views > 0 ? { views, status: 'partial' } : { views: null, status: 'unavailable' };
}
function trafficAdminActivity(data) {
  const count = trafficAdminStats(data);
  const excluded = trafficBrowserExcluded();
  const value = count.status === 'not-tracked' ? 'Not tracked yet' : trafficNum(count.views);
  const detail = count.status === 'not-tracked' ? 'Admin activity was not recorded in this selected period.'
    : count.status === 'unavailable' ? 'A reliable count is not available for this range yet. This does not mean nobody opened the admin.'
      : count.status === 'partial' ? 'Recorded opens from the available page data. This range is incomplete, so the total may be higher.'
        : 'An open is counted after the admin is unlocked. Reloads count again; changing admin tabs does not.';
  const browser = excluded === true ? 'This browser is excluded from the count.'
    : excluded === false ? 'This browser has no counting exclusion set.' : 'This browser’s exclusion setting could not be read.';
  return `<section class="traffic-panel traffic-admin-activity" aria-label="Admin activity">
    <div class="traffic-admin-count"><h3>Admin page opens</h3>${count.status === 'partial' ? '<span class="traffic-admin-qualifier">Recorded</span>' : ''}<strong>${trafficEsc(value)}</strong></div>
    <div class="traffic-admin-explanation"><span class="traffic-admin-browser${excluded === true ? ' is-excluded' : ''}">${trafficEsc(browser)}</span><p>${trafficEsc(detail)}</p>
      <p class="traffic-small">Added with this update on October 1, 2026. Earlier admin opens were not recorded. Counts can arrive late and do not identify who opened the page.</p></div>
  </section>`;
}
function trafficReconciliation(data, daily) {
  const recorded = daily.filter((row) => trafficKnown(row.views));
  if (!recorded.length || !trafficKnown(data.totals?.views)) return '';
  const sum = recorded.reduce((total, row) => total + row.views, 0);
  if (sum !== data.totals.views) return trafficNotice('Daily values do not match the total',
    `The days add up to ${trafficNum(sum)} page views; the headline reports ${trafficNum(data.totals.views)}. No values have been adjusted to hide the difference.`, 'error');
  return `<p class="traffic-reconcile">Daily recorded values add up to <strong>${trafficNum(sum)} page views</strong>, matching the total above.</p>`;
}
function trafficChartPeriods(daily) {
  const granularity = daily.length <= 31 ? 'day' : daily.length <= 120 ? 'week' : 'month';
  const buckets = [];
  daily.forEach((day, index) => {
    const key = granularity === 'day' ? day.date : granularity === 'week' ? String(Math.floor(index / 7)) : day.date.slice(0, 7);
    if (buckets.at(-1)?.key !== key) buckets.push({ key, days: [] });
    buckets.at(-1).days.push(day);
  });
  return { granularity, periods: buckets.map(({ days }) => {
    const known = days.filter((day) => trafficKnown(day.views));
    const visitsKnown = days.every((day) => trafficKnown(day.visits));
    return { start: days[0].date, end: days.at(-1).date, dayCount: days.length,
      views: known.length ? known.reduce((total, day) => total + day.views, 0) : null,
      visits: visitsKnown ? days.reduce((total, day) => total + day.visits, 0) : null,
      status: !known.length ? 'unavailable' : days.every((day) => day.status === 'complete') ? 'complete' : 'partial',
    };
  }) };
}
function trafficDaily(data, daily) {
  const { granularity, periods } = trafficChartPeriods(daily);
  const maximum = Math.max(1, ...periods.map((row) => trafficKnown(row.views) ? row.views : 0));
  const bars = periods.map((row) => {
    const known = trafficKnown(row.views);
    const text = known ? trafficNum(row.views) : 'N/A';
    const rangeLabel = row.start === row.end ? trafficDateLabel(row.start, true) : `${trafficDateLabel(row.start, true)} through ${trafficDateLabel(row.end, true)}`;
    const hint = `${rangeLabel}: ${known ? `${text} recorded page views` : 'data unavailable'}, ${trafficStatus(row.status).toLowerCase()}. Open these dates.`;
    const label = granularity === 'month'
      ? new Date(`${row.start}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' })
      : trafficDateLabel(row.start);
    return `<button type="button" class="traffic-day-bar traffic-day-${trafficEsc(row.status)}" data-traffic-start="${trafficEsc(row.start)}" data-traffic-end="${trafficEsc(row.end)}" aria-label="${trafficEsc(hint)}" title="${trafficEsc(hint)}">
      <span class="traffic-day-value">${text}</span><span class="traffic-day-track"><span class="traffic-day-fill" style="height:${known ? Math.round(row.views / maximum * 1000) / 10 : 100}%"></span></span>
      <span class="traffic-day-label">${trafficEsc(label)}${granularity === 'week' && row.end !== row.start ? `<small>to ${trafficEsc(trafficDateLabel(row.end))}</small>` : ''}</span>
    </button>`;
  }).join('');
  const rows = daily.map((row) => `<tr><th scope="row"><button type="button" class="traffic-text-button" data-traffic-day="${trafficEsc(row.date)}">${trafficEsc(trafficDateLabel(row.date, true))}</button></th>
    <td class="traffic-figure">${trafficNum(row.views)}</td><td class="traffic-figure">${trafficNum(row.visits)}</td><td>${trafficPill(row.status)}</td></tr>`).join('');
  const description = granularity === 'day' ? 'New York dates. Select a day to see all its details.'
    : granularity === 'week' ? 'Seven-day blocks from the selected start date. Select a block to see those dates.'
      : 'Calendar months within your selected New York dates. The first and last bars include only selected days.';
  return `<section class="traffic-panel traffic-daily"><div class="traffic-panel-heading"><div><h3>Page views by ${granularity}</h3><p>${description}</p></div><span class="traffic-unit">Page views</span></div>
    <div class="traffic-chart-scroll" tabindex="0" aria-label="Page views by ${granularity}. Scroll horizontally for more periods if needed."><div class="traffic-chart">${bars}</div></div>
    ${periods.length > 7 ? '<p class="traffic-small">Scroll across for more bars. Every individual date remains in the daily table below.</p>' : ''}
    <div class="traffic-chart-key"><span><i class="traffic-key-recorded"></i>Recorded views</span><span><i class="traffic-key-partial"></i>Partial period record</span><span><i class="traffic-key-missing"></i>Unavailable, not zero</span></div>
    ${trafficReconciliation(data, daily)}
    <details class="traffic-daily-details"><summary>Daily numbers (${daily.length} ${daily.length === 1 ? 'day' : 'days'})</summary>
      <div class="traffic-table-scroll traffic-daily-table"><table class="traffic-table"><caption>Every date in the selected New York range</caption><thead><tr><th>Date</th><th class="traffic-figure">Page views</th><th class="traffic-figure">Entry visits</th><th>Record</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details></section>`;
}

// Combine spellings only when they display as the same page or source. Counts remain additive.
function trafficMerge(rows, getName) {
  const merged = new Map();
  for (const row of rows || []) {
    const key = String(row.key ?? row.path ?? '');
    const name = getName(key);
    const at = merged.get(name);
    if (!at) merged.set(name, { key, name, views: trafficKnown(row.views) ? row.views : null, visits: trafficKnown(row.visits) ? row.visits : null });
    else {
      at.views = trafficKnown(at.views) && trafficKnown(row.views) ? at.views + row.views : null;
      at.visits = trafficKnown(at.visits) && trafficKnown(row.visits) ? at.visits + row.visits : null;
    }
  }
  return [...merged.values()].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}
function trafficBreakdown(data, key, title, description, options = {}) {
  const group = data.groups?.[key];
  const status = group?.status || (group?.error ? 'unavailable' : 'unavailable');
  const head = `<div class="traffic-panel-heading"><div><h3>${trafficEsc(title)}</h3><p>${trafficEsc(description)}</p></div>${trafficPill(status)}</div>`;
  if (!group || status === 'unavailable') {
    return `<section class="traffic-panel ${options.wide ? 'traffic-panel-wide' : ''}">${head}<div class="traffic-unavailable"><strong>Breakdown unavailable</strong><p>${trafficEsc(group?.message || group?.error || 'The selected record does not contain this detail. This does not mean there were zero views.')}</p></div></section>`;
  }
  const getName = options.name || ((value) => value || 'Not supplied');
  const rows = trafficMerge(group.rows, getName);
  const total = data.totals?.views;
  const sumOf = (metric) => rows.every((row) => trafficKnown(row[metric]))
    ? rows.reduce((count, row) => count + row[metric], 0) : null;
  // These missing-detail counts come from measured hours whose category query failed.
  // A disagreement between independent queries is explained separately, never made into a row.
  const knownMissingViews = trafficKnown(group.unattributedViews) ? group.unattributedViews : null;
  const knownMissingVisits = trafficKnown(group.unattributedVisits) ? group.unattributedVisits : null;
  const showMissing = knownMissingViews > 0 || knownMissingVisits > 0;
  const displayedSum = (metric, missing) => {
    const sum = sumOf(metric);
    if (sum === null || (showMissing && missing === null)) return null;
    return sum + (showMissing ? missing : 0);
  };
  const displayedViews = displayedSum('views', knownMissingViews);
  const displayedVisits = displayedSum('visits', knownMissingVisits);
  const differences = [];
  for (const [label, displayed, headline, suppliedDelta] of [
    ['Page views', displayedViews, total, group.reconciliationDeltaViews],
    ['Entry visits', displayedVisits, data.totals?.visits, group.reconciliationDeltaVisits],
  ]) {
    const delta = Number.isFinite(suppliedDelta) ? suppliedDelta
      : trafficKnown(displayed) && trafficKnown(headline) ? headline - displayed : null;
    if (delta !== null && delta !== 0) differences.push(`${label}: displayed rows total ${trafficNum(displayed)}, compared with ${trafficNum(headline)} overall (${trafficNum(Math.abs(delta))} ${delta > 0 ? 'fewer' : 'more'} in this breakdown).`);
  }
  const columns = options.visits ? 4 : 3;
  const body = rows.map((row) => `<tr><th scope="row" class="traffic-row-name">${trafficEsc(row.name)}${options.paths && row.name !== row.key ? `<small>${trafficEsc(row.key || '/')}</small>` : ''}</th>
    <td class="traffic-figure">${trafficNum(row.views)}</td>${options.visits ? `<td class="traffic-figure">${trafficNum(row.visits)}</td>` : ''}<td class="traffic-figure traffic-share">${trafficPct(row.views, total)}</td></tr>`).join('');
  const residual = showMissing ? `<tr class="traffic-residual"><th scope="row">Detail not available<small>Measured traffic from hours missing this category detail</small></th><td class="traffic-figure">${trafficNum(knownMissingViews)}</td>${options.visits ? `<td class="traffic-figure">${trafficNum(knownMissingVisits)}</td>` : ''}<td class="traffic-figure">${trafficPct(knownMissingViews, total)}</td></tr>` : '';
  return `<section class="traffic-panel ${options.wide ? 'traffic-panel-wide' : ''}">${head}
    ${group.message ? `<p class="traffic-small">${trafficEsc(group.message)}</p>` : ''}
    ${differences.length ? trafficNotice('Source totals differ', `${differences.join(' ')} Independent Cloudflare queries can differ because of sampling or collection timing. The original counts are preserved.`, 'error') : ''}
    <div class="traffic-table-scroll"><table class="traffic-table"><caption>${trafficEsc(title)} for the same selected New York range</caption><thead><tr><th>${trafficEsc(options.label || 'Source')}</th><th class="traffic-figure">Page views</th>${options.visits ? '<th class="traffic-figure">Entry visits</th>' : ''}<th class="traffic-figure">Share</th></tr></thead><tbody>${body}${residual}${!rows.length && !residual ? `<tr><td colspan="${columns}">No views recorded in this breakdown.</td></tr>` : ''}</tbody>
      <tfoot><tr><th scope="row">Displayed rows total</th><td class="traffic-figure">${trafficNum(displayedViews)}</td>${options.visits ? `<td class="traffic-figure">${trafficNum(displayedVisits)}</td>` : ''}<td class="traffic-figure">${trafficPct(displayedViews, total)}</td></tr></tfoot></table></div>
    <p class="traffic-denominator">Shares use ${trafficNum(total)} recorded page views in the selected range${total === 0 ? '; percentages are not applicable when the total is zero' : ''}. Rounding may keep percentages from adding to exactly 100%.</p></section>`;
}
function trafficPatterns(data, daily) {
  const groups = data.groups || {};
  let hours;
  if (groups.hour?.status === 'unavailable' || !groups.hour) {
    hours = '<p class="traffic-small">Hourly detail is unavailable for this range.</p>';
  } else {
    const values = new Array(24).fill(0);
    const knownSlots = new Array(24).fill(0);
    const missingSlots = new Array(24).fill(0);
    const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TRAFFIC_ZONE, hour: '2-digit', hourCycle: 'h23' });
    const hourOf = (instant) => Number(hourFormatter.format(instant));
    const recordedSlots = new Map();
    for (const row of groups.hour.rows || []) {
      const instant = new Date(row.key);
      if (Number.isNaN(instant.getTime()) || !trafficKnown(row.views)) continue;
      const hour = hourOf(instant);
      values[hour] += row.views;
      knownSlots[hour] += 1;
      recordedSlots.set(instant.getTime(), row.status || 'complete');
    }
    const since = Date.parse(data.range?.since || data.since);
    const until = Date.parse(data.range?.until || data.until);
    for (let at = since; at < until && at < since + 801 * 86400000; at += 3600000) {
      if (recordedSlots.get(at) !== 'complete') missingSlots[hourOf(new Date(at))] += 1;
    }
    hours = `<div class="traffic-time-grid">${values.map((value, hour) => {
      const missing = missingSlots[hour] > 0;
      const text = !knownSlots[hour] ? 'N/A' : `${trafficNum(value)}${missing ? '*' : ''}`;
      const title = !knownSlots[hour] ? (missing ? 'Record unavailable' : 'No elapsed hours in the selected range') : `${trafficNum(value)} recorded page views${missing ? '; some hours unavailable' : ''}`;
      return `<div title="${trafficEsc(title)}"><span>${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}</span><strong>${text}</strong></div>`;
    }).join('')}</div><p class="traffic-small">${groups.hour.status === 'partial' ? '* Partial total: only recorded hours are included. ' : ''}N/A means unavailable or outside the elapsed part of this range. Page views grouped by New York hour across the selected dates. Repeated hours when daylight saving time ends are combined.</p>`;
  }
  const weekdays = new Array(7).fill(null).map((_, weekday) => ({ weekday, views: 0, dates: 0, missing: 0, partial: 0 }));
  for (const day of daily) {
    const row = weekdays[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
    row.dates += 1;
    if (trafficKnown(day.views)) row.views += day.views;
    else row.missing += 1;
    if (day.status === 'partial') row.partial += 1;
  }
  return `<details class="traffic-panel traffic-patterns"><summary>When pages are viewed</summary><div class="traffic-patterns-content"><section><h3>Hour of day</h3>${hours}</section><section><h3>Day of week</h3><p class="traffic-small">Totals, not daily averages. Longer ranges may contain more of one weekday than another.</p><div class="traffic-table-scroll"><table class="traffic-table"><thead><tr><th>Day</th><th class="traffic-figure">Page views</th><th>Dates included</th></tr></thead><tbody>${weekdays.map((row) => `<tr><th scope="row">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'][row.weekday]}</th><td class="traffic-figure">${row.dates === 0 ? 'Not in range' : row.missing === row.dates ? 'Unavailable' : trafficNum(row.views)}</td><td>${row.dates}${row.missing ? ` (${row.missing} unavailable)` : ''}${row.partial ? ` (${row.partial} partial)` : ''}</td></tr>`).join('')}</tbody></table></div></section></div></details>`;
}
function trafficMethodology(data, range) {
  const coverage = data.coverage || {};
  const missing = coverage.missingDates || [];
  const errors = data.collection?.errors || [];
  const retryAt = trafficCooldown(data);
  return `<details class="traffic-panel traffic-method"><summary>How these numbers work and collection status</summary><div class="traffic-method-content">
    <h3>What is counted</h3><dl class="traffic-definition-list">
      <div><dt>Pages included</dt><dd>This report counts the public Home, Weekly Zmanim, Zmanim Chart, Special Schedules, and Donate pages. Unlocked admin page opens were added with the October 1, 2026 update. Shul View and Messages are not tracked by this report. Historical records can include the site's former address.</dd></div>
      <div><dt>Admin page opens</dt><dd>Page views of /admin/ or /admin/index.html after the admin is unlocked or its remembered access is accepted. Reloads can count again; changing tabs within the admin does not. The existing browser exclusion also applies. Counts can be delayed and do not reveal names, identities, or individual actions. Earlier admin activity was not recorded.</dd></div>
      <div><dt>Page views</dt><dd>Views reported by the website's Cloudflare Web Analytics beacon, including repeated views. This is the primary count used in every chart and percentage.</dd></div>
      <div><dt>Entry visits</dt><dd>Cloudflare counts a visit when a page view arrives from another site or without a referrer. This is not a unique-person count or a count of everyone in the shul. Repeat entries can count again.</dd></div>
      <div><dt>One date range</dt><dd>Every panel uses ${trafficEsc(trafficDateLabel(range.start, true))} through ${trafficEsc(trafficDateLabel(range.end, true))}, in New York. Today's record stops at the snapshot time. Daylight saving changes are included.</dd></div>
      <div><dt>Missing information</dt><dd>Zero means a collected period reported no views. Unavailable means a record or breakdown is missing or cannot be verified. Partial means the shown values cover only the available part. Older archives did not verify every quiet hour. Missing history is never filled with invented zeros.</dd></div>
      <div><dt>Limits</dt><dd>Blocked analytics, offline use, and browsers that opted out are not counted. Cloudflare may sample analytics queries. Counts are reported analytics, not an exact audience census. Data can settle after collection.</dd></div>
      <div><dt>Referrers</dt><dd>Referrers describe page views, including internal navigation. Direct / no referrer can include bookmarks, home-screen shortcuts, email, or apps that do not send a referrer.</dd></div>
    </dl><h3>Collection status</h3><dl class="traffic-technical-list">
      <div><dt>Snapshot</dt><dd>${trafficEsc(trafficStamp(data.snapshotAt || trafficSnapshot))} New York</dd></div>
      <div><dt>Response fetched</dt><dd>${trafficEsc(trafficStamp(data.fetchedAt))} New York${data.cached ? ' (cached response)' : ''}</dd></div>
      <div><dt>Record coverage</dt><dd>${trafficEsc(trafficStatus(coverage.status))}${trafficKnown(coverage.coveredHours) && trafficKnown(coverage.expectedHours) ? `: ${trafficNum(coverage.coveredHours)} of ${trafficNum(coverage.expectedHours)} requested hours` : ''}</dd></div>
      <div><dt>Breakdown coverage</dt><dd>${trafficEsc(trafficStatus(coverage.detailStatus))}</dd></div>
      <div><dt>Archive</dt><dd>${data.archive === 'on' ? 'Enabled' : data.archive === 'unreadable' ? 'Temporarily unreadable' : 'Not enabled'}</dd></div>
      ${coverage.oldestCollectedAt ? `<div><dt>Oldest collection in this range</dt><dd>${trafficEsc(trafficStamp(coverage.oldestCollectedAt))} New York</dd></div>` : ''}
      ${coverage.newestCollectedAt ? `<div><dt>Newest collection in this range</dt><dd>${trafficEsc(trafficStamp(coverage.newestCollectedAt))} New York</dd></div>` : ''}
      <div><dt>Collection</dt><dd>${trafficEsc(data.collection?.status || 'Not reported')}</dd></div>
      ${retryAt ? `<div><dt>Next collection retry</dt><dd>After ${trafficEsc(retryAt)} New York time. Requests are paused until then; available figures are retained.</dd></div>` : ''}
      ${data.collection?.remainingDays > 0 ? `<div><dt>History awaiting repair</dt><dd>${trafficNum(data.collection.remainingDays)} days. Collection repairs a few days at a time. ${retryAt ? 'Repair resumes after the retry time above.' : 'Refresh to check progress.'}</dd></div>` : ''}
      <div><dt>Site filter</dt><dd>${trafficEsc(data.narrowedBy || 'Site')}: <code>${trafficEsc(data.site || 'Not reported')}</code></dd></div>
    </dl>${missing.length ? `<p class="traffic-small"><strong>Dates with gaps:</strong> ${missing.map((date) => trafficEsc(trafficDateLabel(date))).join(', ')}.</p>` : ''}
    ${errors.length ? `<div class="traffic-notice traffic-notice-error"><strong>Collection messages</strong><ul>${errors.map((error) => `<li>${trafficEsc(typeof error === 'string' ? error : error.message || JSON.stringify(error))}</li>`).join('')}</ul></div>` : ''}
  </div></details>`;
}
function trafficContent(data, range) {
  const daily = trafficDailyRows(data, range);
  const coverage = trafficCoverage(data, daily);
  const retryAt = trafficCooldown(data);
  const notices = [];
  if (coverage.status === 'partial') notices.push(trafficNotice('This range has missing history',
    `The totals include only recorded traffic: ${coverage.detail}. Missing dates are unavailable, not zero.${data.coverage?.detailStatus !== 'complete' ? ' Some page, device, and referrer details are also incomplete; each panel shows its coverage.' : ''}`));
  if (coverage.status === 'unavailable') notices.push(trafficNotice('No record available for this range',
    'There is not enough collected information to report a total. Unavailable does not mean nobody visited. Try a more recent range, then check collection status below.'));
  if (data.coverage?.detailStatus !== 'complete' && coverage.status === 'complete') notices.push(trafficNotice('Some breakdowns are incomplete',
    'Daily totals may be available even when older records do not contain matching page, device, or referrer details. Each panel states what is available for this exact range.'));
  if (retryAt) notices.push(trafficNotice('Collection paused',
    `Cloudflare has temporarily limited requests. Available figures are retained. Try again after ${retryAt} New York time; refreshing before then will not restart collection.`));
  else if (data.collection?.errors?.length) notices.push(trafficNotice('Collection needs attention',
    'Some source requests did not complete. Available records are still shown. Open collection status below for the reported errors.', 'error'));
  if (coverage.status === 'complete' && data.totals?.views === 0) notices.push(trafficNotice('No page views recorded',
    'This selected period was collected successfully and reported zero views. Analytics blockers and device opt-outs can prevent visits from being counted.', 'quiet'));
  return `${trafficSummary(data, daily)}${trafficAdminActivity(data)}${notices.join('')}${trafficDaily(data, daily)}
    <div class="traffic-breakdowns">
      ${trafficBreakdown(data, 'page', 'Pages viewed', 'Which pages were opened. Entry visits show where a visit began.', { wide: true, visits: true, paths: true, name: trafficPageName, label: 'Page' })}
      ${trafficBreakdown(data, 'device', 'Devices', 'Page views by device type.', { name: (key) => TRAFFIC_DEVICES[key.toLowerCase()] || key || 'Not supplied', label: 'Device' })}
      ${trafficBreakdown(data, 'referer', 'Referrers', 'The source attached to each page view, including internal links.', { name: trafficReferrer, label: 'Source' })}
    </div>${trafficPatterns(data, daily)}
    <details class="traffic-panel traffic-browser-details"><summary>Browsers and operating systems</summary><div class="traffic-breakdowns">
      ${trafficBreakdown(data, 'browser', 'Browsers', 'Page views by browser.', { label: 'Browser' })}
      ${trafficBreakdown(data, 'os', 'Operating systems', 'Page views by operating system.', { label: 'System' })}
    </div></details>${trafficMethodology(data, range)}`;
}

/** The Traffic tab. A selection change never reuses a response for another window. */
export function renderTraffic(container, options = {}) {
  trafficRequest?.abort();
  const revision = ++trafficRevision;
  if (!options.keepSnapshot || !trafficSnapshot) trafficSnapshot = new Date().toISOString();
  const range = trafficWindow();
  container.className = 'is-wide traffic-view';
  const rangeLabel = range.start === range.end ? trafficDateLabel(range.start, true)
    : `${trafficDateLabel(range.start)}${range.start.slice(0, 4) !== range.end.slice(0, 4) ? `, ${range.start.slice(0, 4)}` : ''} to ${trafficDateLabel(range.end)}, ${range.end.slice(0, 4)}`;
  const offline = location.protocol === 'file:';
  container.innerHTML = `<header class="traffic-header"><div><p class="traffic-eyebrow">Bais Medrash of Lakewood Commons</p><h2>Site statistics</h2><p>Page views and entry visits, using New York dates.</p></div><button type="button" class="traffic-refresh" id="traffic-refresh" ${offline ? 'disabled' : ''}>Refresh data</button></header>
    ${offline ? trafficNotice('Statistics need an internet connection', 'Open the online admin to read the Cloudflare analytics record. The offline copy does not contain visitor data.') : `<section class="traffic-controls" aria-label="Statistics date range">
      <div class="traffic-ranges" role="group" aria-label="Date range presets">${TRAFFIC_RANGES.map((choice) => `<button type="button" class="traffic-range${trafficSelection.preset === choice.key ? ' is-on' : ''}" data-traffic-preset="${choice.key}" aria-pressed="${trafficSelection.preset === choice.key}">${choice.label}</button>`).join('')}</div>
      <form id="traffic-range-form" class="traffic-range-form"><label>From<input type="date" name="start" value="${range.start}" max="${trafficToday()}" required></label><label>Through<input type="date" name="end" value="${range.end}" max="${trafficToday()}" required></label><button type="submit" class="traffic-apply">Apply dates</button><p class="traffic-range-error" id="traffic-range-error" role="alert"></p></form>
      <div class="traffic-range-summary"><div><strong>${trafficEsc(rangeLabel)}</strong><span>New York time · Same range for every panel</span></div><span id="traffic-freshness">Snapshot: ${trafficEsc(trafficStamp(trafficSnapshot))}</span></div>
    </section><p id="traffic-load-status" class="traffic-load-status" role="status" aria-live="polite">Loading the selected record...</p><div id="traffic-body" class="traffic-body" aria-busy="true"><div class="traffic-loading">Reading recorded activity...</div></div>`}`;
  if (offline) return;
  const body = container.querySelector('#traffic-body');
  const loadStatus = container.querySelector('#traffic-load-status');
  const refresh = container.querySelector('#traffic-refresh');
  const active = () => revision === trafficRevision && container.contains(body);
  const rerender = () => renderTraffic(container, { keepSnapshot: true });
  refresh.addEventListener('click', () => {
    trafficCache.clear();
    renderTraffic(container);
  });
  container.querySelectorAll('[data-traffic-preset]').forEach((button) => button.addEventListener('click', () => {
    trafficSelectPreset(button.dataset.trafficPreset);
    rerender();
  }));
  container.querySelector('#traffic-range-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = String(values.get('start') || '');
    const end = String(values.get('end') || '');
    const error = trafficValidateRange(start, end);
    container.querySelector('#traffic-range-error').textContent = error;
    if (error) return;
    trafficSelection = { preset: '', start, end };
    // A date later than the held snapshot needs a fresh anchor, such as after midnight.
    if (end > trafficToday(trafficSnapshot)) trafficSnapshot = new Date().toISOString();
    rerender();
  });
  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-traffic-day], [data-traffic-start]');
    if (!button) return;
    trafficSelection = { preset: '', start: button.dataset.trafficStart || button.dataset.trafficDay,
      end: button.dataset.trafficEnd || button.dataset.trafficDay };
    rerender();
    container.querySelector('#traffic-range-form input')?.focus({ preventScroll: true });
  });
  const show = (data) => {
    if (!active()) return;
    body.innerHTML = trafficContent(data, range);
    body.setAttribute('aria-busy', 'false');
    refresh.disabled = false;
    const retryAt = trafficCooldown(data);
    loadStatus.textContent = retryAt ? `Available figures retained. Collection can retry after ${retryAt} New York time.`
      : `Showing ${trafficStatus(data.coverage?.status).toLowerCase()} records. Snapshot held while changing ranges. Refresh for newer data.`;
    container.querySelector('#traffic-freshness').textContent = `Snapshot: ${trafficStamp(data.snapshotAt || trafficSnapshot)} NY · Updated ${trafficStamp(data.fetchedAt)} NY`;
  };
  const cacheKey = `${range.start}/${range.end}/${trafficSnapshot}`;
  const cached = trafficCache.get(cacheKey);
  if (cached) { show(cached); return; }
  refresh.disabled = true;
  trafficRequest = new AbortController();
  const parameters = new URLSearchParams({ start: range.start, end: range.end, asOf: trafficSnapshot });
  fetch(`${TRAFFIC_API}?${parameters}`, { headers: { accept: 'application/json' }, signal: trafficRequest.signal })
    .then(async (response) => {
      const data = await response.json().catch(() => ({ error: `The statistics service returned HTTP ${response.status} without a readable response.` }));
      if (!response.ok || data.error) throw new Error(data.error || `The statistics service returned HTTP ${response.status}.`);
      if (data.schemaVersion !== 2 || data.timezone !== TRAFFIC_ZONE || data.range?.start !== range.start || data.range?.end !== range.end) {
        throw new Error('The statistics service needs the matching update before it can provide consistent New York date ranges. Old figures have not been displayed under new dates.');
      }
      if (active()) {
        if (data.snapshotAdjusted && Number.isFinite(Date.parse(data.snapshotAt))) trafficSnapshot = data.snapshotAt;
        // Partial history may have been repaired by a different range request in this tab.
        if (data.coverage?.status === 'complete' && data.coverage?.detailStatus === 'complete'
          && data.collection?.status !== 'degraded' && !data.collection?.errors?.length) {
          trafficCache.set(`${range.start}/${range.end}/${trafficSnapshot}`, data);
        }
        show(data);
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError' || !active()) return;
      refresh.disabled = false;
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = trafficNotice('Statistics could not be loaded', error.message, 'error')
        + '<p class="traffic-small">Your date selection is unchanged. Use Refresh data to retry. A failed request does not mean zero visits.</p>';
      loadStatus.textContent = 'The record could not be loaded.';
    });
}
