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

/** How far back, and what each choice is called. Cloudflare's free Web Analytics keeps a
 *  month, so a year is not offered: it would come back short and look like a fault. */
const TRAFFIC_RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

/** The range being looked at, kept for as long as the tab is open. Not stored: it is how
 *  you are looking at this now, the same call the week's own switches make. */
let trafficDays = 7;
/** The last answer, so switching range and coming back does not re-ask for something
 *  already in hand. Keyed by the range. */
const trafficSeen = new Map();

const trafficEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

/** The pages table, busiest first. */
function trafficPages(byPage) {
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
 *  Where the hourly grouping is not available, the UTC days are used as they came and the screen
 *  says so, rather than quietly presenting them as local. */
function trafficLocalDays(data, wanted) {
  const rows = data.groups?.hour?.rows || [];
  if (!rows.length) {
    // Trimmed because one extra day is asked for, to make the oldest local day a whole one.
    return { days: (data.byDay || []).slice(-wanted), utc: true };
  }
  const buckets = new Map();
  for (const r of rows) {
    const at = new Date(r.key);
    if (Number.isNaN(at.getTime())) continue;
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    const b = buckets.get(key) || { date: key, visits: 0, views: 0 };
    b.visits += r.visits;
    b.views += r.views;
    buckets.set(key, b);
  }
  const days = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { days: days.slice(-wanted), utc: false };
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
        visit after about 8pm falls on the next day. That is what happens when the hourly figures
        are not available to count them properly by.</p>` : ''}
      <p class="hint traffic-foot">A visit is one person's stay; a page view is each page
      they opened. Anyone reading with an ad blocker is not counted, so these are a floor
      rather than a headcount.${data.cached ? ' Cloudflare was last asked a few minutes ago.' : ''}</p>`;
  };

  const seen = trafficSeen.get(trafficDays);
  if (seen) show(seen);

  /* One day more than is shown. The hourly buckets get folded back into local days, and the
     oldest local day would otherwise be missing its first few hours: a UTC-midnight boundary is
     8pm the evening before in Lakewood. Asking for the extra day makes every day drawn a whole
     one, and the extra is trimmed off in trafficLocalDays. */
  fetch(`${TRAFFIC_API}?days=${trafficDays + 1}`, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      const data = await res.json().catch(() => ({ error: `Cloudflare's Worker answered ${res.status} and not in JSON.` }));
      if (!res.ok || data.error) throw new Error(data.error || `The Worker answered ${res.status}.`);
      trafficSeen.set(trafficDays, data);
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
