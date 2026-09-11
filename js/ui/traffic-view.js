// How many people are reading the site, and what they open.
//
// The numbers are Cloudflare's. They are counted by the beacon the congregation's pages
// carry (see ANALYTICS_TOKEN in build-offline.py) and they are read back through a small
// Worker in the shul's own Cloudflare account, because reading them needs an API token and
// a token cannot live in this page: /admin/ is a public address behind four digits that are
// not security, and this repository is public. See worker/traffic-worker.js, which is the
// whole of that side and carries its own deploying instructions.
//
// What this screen is careful about is saying which of three things is true when there is
// nothing to show: nothing is set up yet, the Worker said no, or nobody has visited. Those
// want three different answers from whoever is looking, and "no data" answers none of them.

/** The Worker's address. Not a secret: it is one URL that hands out visit counts.
 *
 *  Empty until the Worker is deployed, and while it is empty this screen is the deploying
 *  instructions rather than an error. */
const TRAFFIC_API = 'https://zmanim-traffic.cheskyshain.workers.dev';

/** How far back, and what each choice is called.
 *
 *  Cloudflare's free Web Analytics keeps about a month, which used to be the end of it. The
 *  Worker now keeps the shul's own copy as the days go by, so the longer ranges are answerable
 *  for as long as it has been running: they will be short to begin with and fill in from here.
 *  See the archive note at the top of worker/traffic-worker.js. */
const TRAFFIC_RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
];

/** The range being looked at, kept for as long as the tab is open. Not stored: it is how
 *  you are looking at this now, the same call the week's own switches make. */
let trafficDays = 7;
/** The last answer, so switching range and coming back does not re-ask for something
 *  already in hand. Keyed by the range, and each one remembers when it was taken.
 *
 *  The age matters. Each range is its own question and its own answer, so a kept one can be
 *  minutes older than the one beside it, and that is how a screen once showed 30 days reading
 *  lower than 7 days: an old long range next to a fresh short one. A longer range showing less
 *  than a shorter one is not a stale number, it is an impossible one. So nothing is shown from
 *  here once it is older than the Worker's own cache: past that, wait for the real answer rather
 *  than paint a figure that might contradict the one already on screen. */
const TRAFFIC_KEEP_MS = 45000;
const trafficSeen = new Map();

const trafficEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A time of day on this device's clock, from the instant the Worker stamped the answer with. */
function trafficClock(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A whole number with thousands separated, which is the only formatting these need. */
const trafficNum = (n) => Number(n || 0).toLocaleString('en-US');

/** The name of a page, from the path the beacon reported.
 *
 *  The site is five addresses and they are worth reading as their own names rather than as
 *  paths. Anything else is shown as it came, since a path this does not know about is
 *  either new or is somebody poking at the site, and both are worth seeing plainly. */
const TRAFFIC_PAGES = {
  '/': 'Menu',
  '/week/': 'Weekly Zmanim',
  '/chart/': 'Zmanim Chart',
  '/schedules/': 'Special Schedules',
  '/donate/': 'Donate',
};
function trafficPageName(path) {
  const clean = String(path || '').split('?')[0];
  return TRAFFIC_PAGES[clean] || TRAFFIC_PAGES[`${clean}/`] || clean || '(not said)';
}

/** The day's own label, short, from the YYYY-MM-DD the API returns.
 *
 *  Built out of the parts rather than through Date, which would read a bare date as UTC
 *  midnight and print the day before it in this timezone. */
function trafficDayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The bars. One per day, each as tall a share of the tallest as its own count.
 *
 *  Percentages of a fixed-height row rather than anything measured, so it is right at any
 *  width and on paper, and a day with nothing still shows its own label under an empty
 *  place rather than being missing from the row. */
function trafficChart(byDay) {
  if (!byDay.length) return '';
  const top = Math.max(...byDay.map((d) => d.visits), 1);
  const bars = byDay.map((d) => `
    <div class="traffic-bar" title="${trafficEsc(trafficDayLabel(d.date))}: ${trafficNum(d.visits)} visits, ${trafficNum(d.views)} page views">
      <div class="traffic-bar-fill" style="height: ${Math.round((d.visits / top) * 100)}%"></div>
      <span class="traffic-bar-day">${trafficEsc(trafficDayLabel(d.date))}</span>
    </div>`).join('');
  return `<div class="traffic-chart" role="img"
    aria-label="Visits a day, ${trafficEsc(trafficDayLabel(byDay[0].date))} to ${trafficEsc(trafficDayLabel(byDay[byDay.length - 1].date))}">${bars}</div>`;
}

/** One row a page, not one row an address.
 *
 *  Cloudflare reports the path it saw, and one page can be several: `/donate` and `/donate/` are
 *  both counted, and so is anything carrying a query string. On the screen they all print the
 *  same name, so the table showed "Donate" twice with the visits divided between them and no
 *  way to tell why. Rows that resolve to the same page are added together, and the address
 *  underneath is the busiest spelling of it. */
function trafficMergePages(byPage) {
  const merged = new Map();
  for (const p of byPage) {
    const name = trafficPageName(p.path);
    const at = merged.get(name);
    if (!at) {
      merged.set(name, { ...p, name });
      continue;
    }
    if (p.views > at.views) at.path = p.path;
    at.visits += p.visits;
    at.views += p.views;
  }
  return [...merged.values()].sort((a, b) => b.views - a.views);
}

/** The pages table, busiest first. */
function trafficPages(rawPages) {
  const byPage = trafficMergePages(rawPages);
  if (!byPage.length) return '';
  const rows = byPage.map((p) => `
    <tr>
      <td class="traffic-page">${trafficEsc(trafficPageName(p.path))}${
        // The address under the name, except where the name is the address: a path this does
        // not know is shown as it came, and twice over says nothing the once did not.
        trafficPageName(p.path) === p.path ? '' : `<span class="traffic-path">${trafficEsc(p.path)}</span>`
      }</td>
      <td class="traffic-figure">${trafficNum(p.visits)}</td>
      <td class="traffic-figure">${trafficNum(p.views)}</td>
    </tr>`).join('');
  return `
    <h3 class="traffic-heading">What was opened</h3>
    <table class="traffic-table">
      <thead><tr><th>Page</th><th class="traffic-figure">Visits</th><th class="traffic-figure">Page views</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** A panel that could not be had, said in Cloudflare's own words.
 *
 *  These panels are asked for one at a time precisely so that one of them failing is a note in
 *  its own place rather than a blank screen, and what makes the note worth reading is the real
 *  message: what goes wrong here is a dimension this project guessed the name of, and only
 *  Cloudflare can say how it is actually spelled. */
const trafficPanelError = (title, message) => `
  <h3 class="traffic-heading">${trafficEsc(title)}</h3>
  <p class="hint traffic-panel-error">Cloudflare would not answer this one:
  ${trafficEsc(message)}</p>`;

/** A breakdown: one row a thing, with a bar behind it for its share.
 *
 *  The bar is drawn as a background on the row rather than as an element of its own, so the
 *  numbers stay in an ordinary table that lines up its columns and can be read out by a screen
 *  reader as a table. Share is of the largest row, not of the total, because the question these
 *  answer is "which of these is the big one" rather than "what percentage". */
function trafficBreakdown(title, group, { name = (k) => k, col = 'Name', empty = 'Nothing recorded.' } = {}) {
  if (!group) return '';
  if (group.error) return trafficPanelError(title, group.error);
  const rows = (group.rows || []).filter((r) => r.views > 0);
  if (!rows.length) {
    return `<h3 class="traffic-heading">${trafficEsc(title)}</h3><p class="hint">${trafficEsc(empty)}</p>`;
  }
  const top = Math.max(...rows.map((r) => r.views), 1);
  const total = rows.reduce((n, r) => n + r.views, 0);
  const body = rows.map((r) => {
    const share = Math.round((r.views / top) * 100);
    const pct = Math.round((r.views / total) * 100);
    return `
    <tr>
      <td class="traffic-page" style="--share: ${share}%">${trafficEsc(name(r.key))}</td>
      <td class="traffic-figure">${trafficNum(r.views)}</td>
      <td class="traffic-figure traffic-pct">${pct}%</td>
    </tr>`;
  }).join('');
  return `
    <h3 class="traffic-heading">${trafficEsc(title)}</h3>
    <table class="traffic-table traffic-shares">
      <thead><tr><th>${trafficEsc(col)}</th><th class="traffic-figure">Page views</th><th class="traffic-figure">Share</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/** Tidier names for what the device dimension calls things. */
const TRAFFIC_DEVICES = { mobile: 'Phone', desktop: 'Desktop', tablet: 'Tablet' };
const trafficDeviceName = (k) => TRAFFIC_DEVICES[String(k).toLowerCase()] || k || '(not said)';

/** Where somebody came from. An empty referrer is not a gap in the data: it is the address
 *  typed in, opened from a home screen, or followed from a link in an app that sends no
 *  referrer, which for this site means WhatsApp and email. That is the common case here and
 *  deserves a name rather than a blank. */
const SITE_HOST_NAME = 'lczmanim.cjaffa.com';
function trafficRefererName(host) {
  const h = String(host || '').trim();
  if (!h || h === 'null' || h === '(none)') return 'Typed in, or a link in an app';
  if (h === SITE_HOST_NAME) return 'Another page on this site';
  return h;
}

/** The days of the range, counted on a Lakewood clock rather than on UTC.
 *
 *  This is not a detail. Cloudflare buckets by UTC day, and Lakewood is four or five hours
 *  behind it, so from about 8pm local the UTC day has already turned over. What that produced on
 *  screen was a bar labelled with tomorrow's date, at 9:40 at night, holding that evening's
 *  visits. The stray bar is the harmless half. The half that matters is that **every evening
 *  visit was being filed under the next day**, and on a zmanim board the evening is exactly when
 *  people look: Friday night counted as Shabbos and מוצאי שבת counted as Sunday, in a panel
 *  whose whole point is telling those days apart.
 *
 *  So the days are rebuilt here out of the hourly buckets, which are real instants and can be
 *  put in whatever day they fell on locally. `new Date(instant)` and `getFullYear` are the
 *  browser's own timezone, which is the one the person reading this is standing in.
 *
 *  Both figures add up across the fold. A page view is one event. A visit is a pageload that did
 *  not come from this site, so it belongs to exactly one hour, which is why it can be summed
 *  rather than being double counted: the per-page table on this screen already demonstrates it,
 *  its visits column summing to the same total shown at the top.
 *
 *  Where the hourly grouping does not reach back far enough to answer the range, the UTC days are
 *  used as they came and the screen says so, rather than quietly presenting them as local.
 *
 *  **The days are the calendar's, not the ones that happen to have traffic in them.** This used to
 *  take the last `wanted` buckets that had rows, and that is two wrong answers at once. A quiet day
 *  vanished instead of being drawn empty, so the chart's bars were not consecutive days. Worse, the
 *  newest bucket with rows is not necessarily today: for the hours before the first visit of the
 *  morning it is yesterday, and the screen put yesterday's whole day under a button marked Today.
 *  The shul saw both, which is what this now asks the calendar rather than the data.
 *
 *  `new Date(y, m, d - i)` rather than subtracting 86400000, which lands on 23:00 or 01:00 across a
 *  daylight saving change and can name the same date twice. */
const trafficDayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function trafficCalendarDays(wanted, utc = false) {
  const now = new Date();
  const out = [];
  for (let i = wanted - 1; i >= 0; i -= 1) {
    out.push(utc
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10)
      : trafficDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

/** How far past the start of the range the first hourly bucket may sit and the hours still be
 *  taken as covering it.
 *
 *  A day with nothing in it has no rows, so the earliest row is not the same thing as how far back
 *  the hourly figures reach, and a quiet morning at the start of the range would read as a gap. A
 *  whole day of slack is enough for that and nowhere near enough to hide the real case, which is
 *  hourly detail that stops after a day or two while thirty were asked for. That case was on the
 *  shul's screen: every range, Today and 7 days and 30 days alike, was drawing one bar, because one
 *  day was all the hourly rows there were. A month cannot read lower than a day, and it did. */
const TRAFFIC_HOUR_SLACK_MS = 24 * 3600 * 1000;

function trafficLocalDays(data, wanted) {
  const rows = data.groups?.hour?.rows || [];
  const stamps = rows.map((r) => new Date(r.key).getTime()).filter((t) => !Number.isNaN(t));
  const want = trafficCalendarDays(wanted);
  const now = new Date();
  const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (wanted - 1)).getTime();
  const covered = stamps.length > 0 && Math.min(...stamps) - startsAt <= TRAFFIC_HOUR_SLACK_MS;

  if (!covered) {
    /* Cloudflare's own UTC days, laid onto the calendar so the chart is consecutive days and the
       range asked for is the range added up. A day it did not mention is a day with nothing in it,
       which is a bar of zero rather than a day left out. */
    const utcDays = new Map((data.byDay || []).map((d) => [d.date, d]));
    return {
      days: trafficCalendarDays(wanted, true).map((date) => utcDays.get(date) || { date, visits: 0, views: 0 }),
      utc: true,
    };
  }

  const buckets = new Map(want.map((date) => [date, { date, visits: 0, views: 0 }]));
  for (const r of rows) {
    const at = new Date(r.key);
    if (Number.isNaN(at.getTime())) continue;
    const b = buckets.get(trafficDayKey(at));
    // Rows outside the days being drawn are the extra day asked for, and the hours of today that
    // have not happened yet cannot appear at all. Neither belongs in the total.
    if (!b) continue;
    b.visits += r.visits;
    b.views += r.views;
  }
  return { days: want.map((date) => buckets.get(date)), utc: false };
}

/** When the board is read, folded into the 24 hours of a day.
 *
 *  The Worker asks for real hours, one bucket per hour of the range, and they are added up
 *  here into hour-of-day. Done in the browser on purpose: these are UTC instants, and the hour
 *  worth showing a Lakewood gabbai is the hour it was on his clock, which is the clock this code
 *  is running on. Doing it at the Worker would have fixed it to whatever timezone the edge that
 *  answered happened to think in. */
function trafficHours(group) {
  if (!group) return '';
  if (group.error) return trafficPanelError('When people look', group.error);
  const hours = new Array(24).fill(0);
  let seen = 0;
  for (const r of group.rows || []) {
    const at = new Date(r.key);
    if (Number.isNaN(at.getTime())) continue;
    hours[at.getHours()] += r.views;
    seen += r.views;
  }
  if (!seen) {
    return '<h3 class="traffic-heading">When people look</h3><p class="hint">Nothing recorded.</p>';
  }
  const top = Math.max(...hours, 1);
  const label = (h) => (h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`);
  /* An hour with nothing gets no fill at all, not a short one. The fill has a 2px floor so that
     a quiet day is still visible on the chart above, and across 24 bars that floor turned every
     empty hour into a stub, which reads as somebody checking the zmanim at three in the morning.
     Most hours here really are empty and the chart should say so. */
  const bars = hours.map((n, h) => `
    <div class="traffic-bar" title="${label(h)}: ${trafficNum(n)} page views">
      ${n ? `<div class="traffic-bar-fill" style="height: ${Math.round((n / top) * 100)}%"></div>` : ''}
      <span class="traffic-bar-day">${h % 3 === 0 ? label(h) : ''}</span>
    </div>`).join('');
  return `
    <h3 class="traffic-heading">When people look</h3>
    <div class="traffic-chart traffic-hours" role="img" aria-label="Page views by hour of the day">${bars}</div>
    <p class="hint">Hour of the day, on this device's clock, added up across the whole period.</p>`;
}

/** Which day of the week, worked out of the per-day figures rather than asked for.
 *
 *  Nothing extra is fetched: the days are already in hand for the chart at the top, and a date
 *  knows which weekday it is. Worth having on a zmanim board, where Friday is not an ordinary
 *  day and neither is מוצאי שבת. */
function trafficWeekdays(byDay) {
  if (byDay.length < 7) return '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
  const sums = new Array(7).fill(0);
  for (const d of byDay) {
    const [y, m, day] = String(d.date).split('-').map(Number);
    if (!y || !m || !day) continue;
    sums[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] += d.views;
  }
  const rows = names.map((n, i) => ({ key: n, views: sums[i], visits: 0 }));
  return trafficBreakdown('Which day of the week', { rows }, { col: 'Day' });
}

/** Whether anything is being kept, said plainly.
 *
 *  Cloudflare forgets after about a month. The Worker can keep the shul's own copy, and whether
 *  it is doing so is the difference between the long ranges filling in over the coming year and
 *  them staying stuck at a month forever. That is worth a line on the screen: it is the kind of
 *  thing nobody notices is switched off until they want last Pesach and it is not there.
 *
 *  Only shown while it is off, or while it is on and still shallow. Once there is more history
 *  than the range being looked at, it is just working and needs no announcement. */
function trafficArchiveNote(data) {
  if (data.archive === 'off') {
    return `<p class="hint">Nothing is being kept: Cloudflare forgets after about a month, and no
      archive is set up on the Worker, so the longer ranges will stay short. See the archive note
      at the top of <code>worker/traffic-worker.js</code>.</p>`;
  }
  if (data.archive === 'unreadable') {
    return `<p class="hint traffic-panel-error">The Worker has an archive bound but could not read
      it, so nothing is being kept.</p>`;
  }
  if (data.archive === 'on' && data.archiveDays && data.archiveDays < (data.days || 0)) {
    return `<p class="hint">Keeping the shul's own copy, ${trafficNum(data.archiveDays)}
      ${data.archiveDays === 1 ? 'day' : 'days'} of it so far. Cloudflare forgets after about a
      month; from here on this does not.</p>`;
  }
  return '';
}

/** What is on the screen while there is no Worker to ask. Not an error: nothing is wrong,
 *  it has not been set up, and the thing to do about it is a list. */
function trafficSetup() {
  return `
    <div class="panel traffic-setup">
      <h3>Not set up yet</h3>
      <p>The site is counting visits already: every page the congregation sees carries the
      beacon, and the numbers are at Cloudflare under Web Analytics. What is missing is the
      part that lets this screen read them.</p>
      <p>Reading them needs a Cloudflare API token, and a token cannot live in this page:
      <code>/admin/</code> is a public address and the four digits in front of it are not
      security. So the token goes in a small Worker in the shul's own Cloudflare account,
      and this screen asks the Worker.</p>
      <ol>
        <li>Cloudflare, My Profile, API Tokens, Create Token, Custom token. One permission:
        Account, Account Analytics, Read.</li>
        <li>Workers and Pages, Create, and paste in <code>worker/traffic-worker.js</code>
        from this repository.</li>
        <li>On that Worker, Settings, Variables and Secrets: <code>CF_API_TOKEN</code>, as a
        Secret, holding the token from the first step. That is the only setting it needs.</li>
        <li>Put the Worker's address into <code>TRAFFIC_API</code> in
        <code>js/ui/traffic-view.js</code> and rebuild.</li>
      </ol>
      <p class="hint">Until then the numbers are at dash.cloudflare.com, under Analytics,
      Web Analytics.</p>
    </div>`;
}

/** The screen. */
export function renderTraffic(container) {
  container.className = '';
  const range = TRAFFIC_RANGES.map((r) => `
    <button type="button" class="traffic-range ${r.days === trafficDays ? 'is-on' : ''}"
      data-days="${r.days}">${r.label}</button>`).join('');

  /* The USB copy is this program with no internet behind it, and these numbers are a
     request over the internet. Said plainly rather than left to fail as an error, which is
     what it would look like otherwise. */
  if (location.protocol === 'file:') {
    container.innerHTML = `
      <h2>Traffic</h2>
      <div class="panel"><p>This is the offline copy, and the site's visitor numbers come
      from Cloudflare over the internet. Open the admin at the shul's own address to read
      them.</p></div>`;
    return;
  }

  container.innerHTML = `
    <h2>Traffic</h2>
    <p class="hint">How many people are reading the site. Counted by Cloudflare, which keeps
    nothing about a person: it can say how many and which pages, and it cannot say who.</p>
    ${TRAFFIC_API ? `
      <div class="traffic-ranges">${range}</div>
      <div id="traffic-body" class="traffic-body"><p class="hint">Asking Cloudflare...</p></div>
    ` : trafficSetup()}`;

  if (!TRAFFIC_API) return;

  const body = container.querySelector('#traffic-body');
  container.querySelectorAll('.traffic-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      trafficDays = Number(btn.dataset.days);
      renderTraffic(container);
    });
  });

  const show = (data) => {
    const { days: byDay, utc: daysAreUtc } = trafficLocalDays(data, trafficDays);
    const byPage = data.byPage || [];
    const visits = byDay.reduce((n, d) => n + d.visits, 0);
    const views = byDay.reduce((n, d) => n + d.views, 0);
    /* Nothing at all is its own answer, and a likely one on a site that has just started
       counting: it is not a fault and should not read as one. */
    if (!visits && !views) {
      body.innerHTML = `<div class="panel"><p>No visits counted in this period yet.</p>
        <p class="hint">Counting started when the beacon went on the site. If you have
        opened the site yourself since then and it is not here, that is the opt-out doing
        its job: this device asked not to be counted.</p>
        <p class="hint">Asked Cloudflare for
        <code>${trafficEsc(data.narrowedBy || 'site')}</code> =
        <code>${trafficEsc(data.site || '(not said)')}</code>. If dash.cloudflare.com shows visits
        for this period and this does not, the two are not looking at the same site.</p></div>`;
      return;
    }
    body.innerHTML = `
      <div class="traffic-totals">
        <div class="traffic-total"><span class="traffic-total-n">${trafficNum(visits)}</span><span class="traffic-total-w">visits</span></div>
        <div class="traffic-total"><span class="traffic-total-n">${trafficNum(views)}</span><span class="traffic-total-w">page views</span></div>
      </div>
      ${trafficChart(byDay)}
      ${trafficPages(byPage)}
      ${trafficBreakdown('Phone or desktop', data.groups?.device, { name: trafficDeviceName, col: 'Device' })}
      ${trafficHours(data.groups?.hour)}
      ${trafficWeekdays(byDay)}
      ${trafficBreakdown('How people arrive', data.groups?.referer, { name: trafficRefererName, col: 'Came from' })}
      ${trafficBreakdown('Browser', data.groups?.browser, { col: 'Browser' })}
      ${trafficBreakdown('Operating system', data.groups?.os, { col: 'System' })}
      ${
        /* What Cloudflare answered to. Only worth a line on the screen while some panel is
           missing: the names are guesses probed until one works, and these are the answer to
           "which one was it", which is what gets written back into the Worker so it stops
           probing. When every panel drew, nobody needs to know. */
        Object.values(data.groups || {}).some((g) => g?.error) && data.dims
          ? `<p class="hint">Dimensions Cloudflare accepted: <code>${
            trafficEsc(Object.entries(data.dims).map(([k, v]) => `${k}=${v}`).join(', '))}</code></p>`
          : ''
      }
      ${daysAreUtc ? `<p class="hint">Days here are counted in UTC, not on a Lakewood clock, so a
        visit after about 8pm falls on the next day. That is what happens when Cloudflare's hourly
        figures do not reach back over the whole period, which is the only way to count these days
        properly. The totals are still the whole period.</p>` : ''}
      ${trafficArchiveNote(data)}
      <p class="hint traffic-foot">The panels under the chart count the whole period Cloudflare was
      asked about, which begins at midnight UTC and so reaches a few hours further back than the
      days above: on Today they take in the last of yesterday evening. Only the two figures at the
      top and the chart are counted on a Lakewood clock. A visit is one person's stay; a page view
      is each page they opened. Anyone reading with an ad blocker is not counted, so these are a
      floor rather than a headcount.${
        /* When these particular numbers were taken. Each range is its own question with its own
           answer, so two of them on the same screen can be from moments apart; printing the time
           is what makes that readable rather than a contradiction. */
        data.fetchedAt ? ` Counted as of ${trafficEsc(trafficClock(data.fetchedAt))}.` : ''
      }${data.cached ? ' (from the last look, not asked again)' : ''}</p>`;
  };

  const seen = trafficSeen.get(trafficDays);
  if (seen && Date.now() - seen.at < TRAFFIC_KEEP_MS) show(seen.data);

  /* One day more than is shown. The hourly buckets get folded back into local days, and the
     oldest local day would otherwise be missing its first few hours: a UTC-midnight boundary is
     8pm the evening before in Lakewood. Asking for the extra day makes every day drawn a whole
     one, and the extra is trimmed off in trafficLocalDays. */
  fetch(`${TRAFFIC_API}?days=${trafficDays + 1}`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      const data = await res.json().catch(() => ({ error: `Cloudflare's Worker answered ${res.status} and not in JSON.` }));
      if (!res.ok || data.error) throw new Error(data.error || `The Worker answered ${res.status}.`);
      trafficSeen.set(trafficDays, { at: Date.now(), data });
      show(data);
    })
    .catch((err) => {
      /* The real message, not a friendly one. The one thing about this that cannot be
         checked from this repository is the shape of Cloudflare's analytics schema, so when
         it is wrong the useful thing on the screen is exactly how. */
      body.innerHTML = `<div class="panel traffic-error">
        <h3>Could not read the numbers</h3>
        <p>${trafficEsc(err.message)}</p>
        <p class="hint">That came from the Worker at <code>${trafficEsc(TRAFFIC_API)}</code>,
        or from trying to reach it. The numbers themselves are safe either way: they are at
        dash.cloudflare.com under Analytics, Web Analytics.</p>
      </div>`;
    });
}
