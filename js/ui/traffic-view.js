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

/** One day, or nothing. While this is set the whole tab is about that day.
 *
 *  The reason it exists: every panel under the chart is a Cloudflare aggregate over the window
 *  the Worker was asked about, so over a range they describe the range and there was no way to
 *  ask "what was opened on Tuesday". Asked for. Now the browser sends the two instants that
 *  bound one day on this device's clock and every panel in the answer is about that day.
 *
 *  A local date string, "2026-09-14", which is what an <input type="date"> speaks and what the
 *  chart's own bars carry. Not stored: it is how you are looking at this now, the same as the
 *  range beside it. */
let trafficDay = null;

/** The two instants that bound one local day, as the Worker wants them.
 *
 *  Local midnight to the next local midnight, built with new Date(y, m - 1, d + 1) rather than by
 *  adding 86400000, so the day a clock changes is still one whole day and not 23 or 25 hours of
 *  one and an hour of its neighbour. This is the whole point of the browser working it out rather
 *  than the Worker: the Worker does not know which timezone its reader is standing in. */
function trafficDayWindow(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return {
    since: new Date(y, m - 1, d).toISOString(),
    until: new Date(y, m - 1, d + 1).toISOString(),
  };
}

/** Today on this device's clock, as an <input type="date"> writes it. */
function trafficToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A local date string as a person reads it. */
function trafficDayFull(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
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
function trafficChart(byDay, utc = false) {
  if (!byDay.length) return '';
  const top = Math.max(...byDay.map((d) => d.visits), 1);
  /* Every bar is a button that opens its own day. Asked for: the chart already had a shape per
     day on it, so the day somebody wants to look into is the one they are already pointing at.
     A real <button> rather than a click handler on the div, so it is in the tab order and a
     screen reader is told it does something. The whole chart is no longer role="img" for the
     same reason: a picture cannot have buttons in it.

     **Except where these are UTC days, and then no bar opens anything.** A day view is always
     the reader's own midnight to midnight, so the day behind a UTC bar is not the day clicking
     it would have opened: the bar over today holds last night's visits and the day it opened
     would not, and the screen would have answered two different numbers for one shape somebody
     had just pointed at. The shul found the same disagreement between Today and this chart the
     hard way (see trafficUtcNote), and a bar that cannot be honest about which day it is should
     not invite the question. Rendered as plain shapes, which is what .traffic-bar already is on
     the hours chart, so nothing about how it looks changes. */
  const bars = byDay.map((d) => {
    const fill = `<div class="traffic-bar-fill" style="height: ${Math.round((d.visits / top) * 100)}%"></div>
      <span class="traffic-bar-day">${trafficEsc(trafficDayLabel(d.date))}</span>`;
    const counts = `${trafficNum(d.visits)} visits, ${trafficNum(d.views)} page views`;
    const title = `${trafficDayLabel(d.date)}${utc ? ' UTC' : ''}: ${counts}`;
    return utc
      ? `<div class="traffic-bar" title="${trafficEsc(title)}"
          aria-label="${trafficEsc(trafficDayFull(d.date))}, counted in UTC: ${counts}.">${fill}</div>`
      : `<button type="button" class="traffic-bar" data-day="${trafficEsc(d.date)}"
          title="${trafficEsc(title)}"
          aria-label="${trafficEsc(trafficDayFull(d.date))}: ${counts}. Open this day.">${fill}</button>`;
  }).join('');
  return `<div class="traffic-chart ${utc ? '' : 'is-pickable'}"
    aria-label="Visits a day${utc ? ', counted in UTC' : ''}, ${trafficEsc(trafficDayLabel(byDay[0].date))} to ${trafficEsc(trafficDayLabel(byDay[byDay.length - 1].date))}">${bars}</div>`;
}

/** Why the chart's days are not the reader's days, said under the chart rather than at the foot.
 *
 *  **The shul reported this one as two screens that could not both be right**: Today said no
 *  visits counted yet, and the seven day chart beside it drew a bar on the 14th, which was that
 *  same day. Both numbers were correct and they were answers to different questions. Today is
 *  counted from local midnight, and where Cloudflare's hourly figures do not reach back over the
 *  whole range there is nothing to fold the older days with, so the chart falls back to
 *  Cloudflare's own UTC days, each of which starts at 8pm the evening before in Lakewood. The bar
 *  over today therefore held last night, and Today did not.
 *
 *  This was already said, at the very bottom of the tab, under six panels. That is not where the
 *  contradiction is. It is said here, next to the chart it is about, and it names the consequence
 *  rather than only the cause: a reader who has just seen the two numbers needs to be told they
 *  do not disagree, not told how UTC works.
 *
 *  And it names the cure, because there is one and it is not on this screen: the Worker's archive
 *  keeps the hours Cloudflare drops, and with it the fold reaches back over any range. */
function trafficUtcNote(utc, data) {
  if (!utc) return '';
  /* Why it happened, which is a different sentence depending on whether anything is being kept.
     With no record it is Cloudflare's hourly detail running out, and the answer is to start
     keeping one. With a record it is a day in the range from before the record began, and the
     answer is only time. Naming the wrong one would send somebody to switch on something that is
     already on. */
  const why = data?.store
    ? `This range reaches back past the record, which begins
       ${trafficEsc(trafficDayLabel(data.store.from || ''))}. A day from before then has a total
       but no hours under it, and the hours are the only way to count a day on a local clock, so
       the whole chart falls back rather than mixing two kinds of day in one row of bars.`
    : `This happens when Cloudflare's hourly figures do not reach back over the period asked for,
       and those hours are the only way to count these days locally. Binding a KV namespace called
       <code>ARCHIVE</code> to the Worker starts keeping them, and then every range is counted on a
       Lakewood clock.`;
  return `<p class="hint traffic-utc-note">These days are counted in UTC, not on a Lakewood clock,
    so each one begins at 8pm the evening before. <strong>The bar over today holds last night as
    well, which is why Today can read lower than it.</strong> That is also why no bar here opens
    its own day: a day view is always your own midnight to midnight, so it would not be the day
    the bar is. The two totals above are still the whole period. ${why}</p>`;
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
/** Both of the site's hosts: the shul's own domain, and the one it was on before the move.
 *  A referer recorded before then carries the old name and is still this same site. */
const SITE_HOST_NAMES = ['baismedrashoflakewoodcommons.org', 'lczmanim.cjaffa.com'];
function trafficRefererName(host) {
  const h = String(host || '').trim();
  if (!h || h === 'null' || h === '(none)') return 'Typed in, or a link in an app';
  if (SITE_HOST_NAMES.includes(h)) return 'Another page on this site';
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

/** Whether the hourly figures account for every day that has traffic in it.
 *
 *  This is the test that decides whether the days can be counted on a Lakewood clock at all, and
 *  it used to be a guess: how far back the earliest hourly row sat, with a day of slack for a
 *  quiet morning. A guess was needed because a day with nothing in it has no rows, so the earliest
 *  row is not the same thing as how far back the hours reach.
 *
 *  There is an exact test and this is it: **no day may carry a total while carrying no hours.**
 *  A day the hourly rows do not mention, but which the day totals say had visits, is a day that
 *  cannot be folded onto a local clock, and one such day is enough to make the whole chart a
 *  mixture. Every other day, quiet or busy, folds correctly whether or not it has rows.
 *
 *  The guess was not merely inelegant, it was wrong in the direction that matters now the Worker
 *  keeps a record. Asked for three months with a record thirty days deep, the earliest hour was
 *  two months past the start of the range, so the old test said "not covered" and threw the whole
 *  chart onto UTC days, when in fact every day with anything in it had its hours and folded
 *  exactly. The screen gave up local days precisely because it had been given more history. */
function trafficHoursCover(rows, byDay) {
  if (!rows.length) return !(byDay || []).some((d) => d.visits || d.views);
  // Both sides as UTC dates, which is what a day total is. Taking the hour's local date instead
  // would let a UTC day at the very edge of the record be called covered when it has no hours.
  const firstHourDay = rows.map((r) => String(r.key).slice(0, 10)).reduce((a, b) => (a < b ? a : b));
  return !(byDay || []).some((d) => (d.visits || d.views) && d.date < firstHourDay);
}

function trafficLocalDays(data, wanted) {
  const rows = (data.groups?.hour?.rows || []).filter((r) => !Number.isNaN(new Date(r.key).getTime()));
  const want = trafficCalendarDays(wanted);
  const covered = trafficHoursCover(rows, data.byDay);

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
/** How old the record may be before the screen stops taking it on trust.
 *
 *  The collection runs once a day, so a day and a bit is late rather than merely recent. This is
 *  the number that matters most on this tab, because **a collector that has stopped does not look
 *  broken, it looks like a quiet week**: the figures are all still there, all still drawn, and all
 *  wrong in the one direction nobody checks. Every other failure here announces itself. */
const TRAFFIC_STALE_MS = 26 * 3600 * 1000;

/** What is being kept, how far back, and when it was last added to.
 *
 *  The shul asked for the whole tab to work this way, in these words: collect everything from
 *  Cloudflare on a schedule, and let the screen be a view onto what was collected rather than a
 *  question put to Cloudflare every time a button is pressed. That is what the Worker does now,
 *  and this line is the part of it the reader has to be able to see. */
function trafficArchiveNote(data) {
  if (data.archive === 'off') {
    return `<p class="hint">Nothing is being collected, so this is reading Cloudflare live and can
      only ever reach back the month Cloudflare keeps. Bind a KV namespace called
      <code>ARCHIVE</code> to the Worker and it starts keeping the shul's own record. See the note
      at the top of <code>worker/traffic-worker.js</code>.</p>`;
  }
  if (data.archive === 'unreadable') {
    return `<p class="hint traffic-panel-error">The Worker has a store bound but could not read it,
      so this is reading Cloudflare live and nothing is being kept.</p>`;
  }
  const store = data.store;
  if (!store) return '';

  const age = store.filledAt ? Date.now() - new Date(store.filledAt).getTime() : null;
  const stale = age !== null && age > TRAFFIC_STALE_MS;
  const lines = [];
  if (stale) {
    /* Loud, and a panel rather than a hint. Everything on the screen above it is drawn from a
       record that stopped being written, which is the one failure on this tab that looks exactly
       like success. */
    lines.push(`<p class="traffic-panel-error"><strong>The record has not been added to since
      ${trafficEsc(trafficDayFull(String(store.filledAt).slice(0, 10)))}.</strong> Everything above
      is what was collected up to then, so a quiet few days here may be a collector that stopped
      rather than a quiet few days. The daily trigger on the Worker is what fills it: Settings,
      Triggers, Cron Triggers.</p>`);
  }
  if (store.held < store.asked) {
    lines.push(`<p class="hint">The record holds ${trafficNum(store.held)} of the
      ${trafficNum(store.asked)} days in this range so far. It fills a little on every opening of
      this tab and the rest on the daily run, and Cloudflare can only be asked back about a month,
      so this is as far back as it will ever reach for days before it started.</p>`);
  }
  if (!stale && store.from && store.days) {
    lines.push(`<p class="hint">Read out of the shul's own record, ${trafficNum(store.days)}
      ${store.days === 1 ? 'day' : 'days'} of it, from
      ${trafficEsc(trafficDayLabel(store.from))}. Cloudflare forgets after about a month; from here
      on this does not.</p>`);
  }
  return lines.join('');
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
      <div class="traffic-pick">
        <label class="traffic-pick-label" for="traffic-date">Or one day</label>
        <input type="date" id="traffic-date" class="traffic-date"
          max="${trafficEsc(trafficToday())}" value="${trafficEsc(trafficDay || '')}">
        ${trafficDay ? '<button type="button" class="traffic-range" id="traffic-day-clear">Back to the range</button>' : ''}
      </div>
      <div id="traffic-body" class="traffic-body"><p class="hint">Asking Cloudflare...</p></div>
    ` : trafficSetup()}`;

  if (!TRAFFIC_API) return;

  const body = container.querySelector('#traffic-body');
  container.querySelectorAll('.traffic-range[data-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      trafficDays = Number(btn.dataset.days);
      // Choosing a range is how you leave a single day, as well as how you change the range.
      trafficDay = null;
      renderTraffic(container);
    });
  });
  container.querySelector('#traffic-date')?.addEventListener('change', (e) => {
    trafficDay = e.target.value || null;
    renderTraffic(container);
  });
  container.querySelector('#traffic-day-clear')?.addEventListener('click', () => {
    trafficDay = null;
    renderTraffic(container);
  });

  /* The chart is redrawn on every answer, so its buttons are bound after each draw rather than
     once: a listener put on the old row would be sitting on nodes nobody can see any more. */
  const wireBars = () => {
    body.querySelectorAll('.traffic-bar[data-day]').forEach((bar) => {
      bar.addEventListener('click', () => {
        trafficDay = bar.dataset.day;
        renderTraffic(container);
      });
    });
  };

  const show = (data) => {
    /* A Worker that did not understand the window is the one failure that looks like a success:
       an older deploy ignores since and until and answers about its own range, so the screen
       would put a whole week's pages under one day's date and nothing would say so. Checked
       before anything is drawn. */
    if (trafficDay && data.window !== 'exact') {
      body.innerHTML = `<div class="panel traffic-error">
        <h3>The Worker cannot answer for one day yet</h3>
        <p>It answered about its own range instead of the day asked for, which means the copy
        running at <code>${trafficEsc(TRAFFIC_API)}</code> is an older one.</p>
        <p class="hint">Deploy <code>worker/traffic-worker.js</code> again from this repository and
        this will work. Nothing else on this tab is affected: the ranges above still read
        correctly.</p></div>`;
      return;
    }
    /* Over a day, the answer is already only that day: the Worker was asked for exactly the two
       instants that bound it, so everything in it, panels included, is about that day and there
       is nothing to fold or trim. Over a range the days are still rebuilt from the hourly buckets
       on a Lakewood clock. */
    const { days: byDay, utc: daysAreUtc } = trafficDay
      ? { days: data.byDay || [], utc: false }
      : trafficLocalDays(data, trafficDays);
    const byPage = data.byPage || [];
    const visits = byDay.reduce((n, d) => n + d.visits, 0);
    const views = byDay.reduce((n, d) => n + d.views, 0);
    /* Nothing at all is its own answer, and a likely one on a site that has just started
       counting: it is not a fault and should not read as one. */
    if (!visits && !views) {
      body.innerHTML = `<div class="panel"><p>${trafficDay
        ? `Nothing counted on ${trafficEsc(trafficDayFull(trafficDay))}.`
        : 'No visits counted in this period yet.'}</p>
        ${trafficDay ? `<p class="hint">Cloudflare keeps about a month. A day older than that reads
        as nothing unless the Worker's own archive was running by then.${
          data.archive === 'off' ? ' It is not switched on.' : ''}</p>` : ''}
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
      ${trafficDay
        ? `<p class="traffic-oneday">${trafficEsc(trafficDayFull(trafficDay))}</p>`
        : trafficChart(byDay, daysAreUtc) + trafficUtcNote(daysAreUtc, data)}
      ${trafficPages(byPage)}
      ${trafficBreakdown('Phone or desktop', data.groups?.device, { name: trafficDeviceName, col: 'Device' })}
      ${trafficHours(data.groups?.hour)}
      ${trafficDay ? '' : trafficWeekdays(byDay)}
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
      ${trafficArchiveNote(data)}
      <p class="hint traffic-foot">${trafficDay
        ? `The two figures and the hours are that one day, midnight to midnight on this device's
           clock.${data.store ? ` The panels under them are the UTC day of the same date, which runs
           from 8pm the evening before: a local day straddles two UTC days, and the record keeps
           those breakdowns a day at a time.` : ` The Worker was asked for exactly those two
           moments, so the pages, the devices and the rest are the day's own.`}`
        : `${data.store ? `The panels under the chart count whole UTC days, so they reach back to
      8pm the evening before the first day above.` : `The panels under the chart count the whole
      period Cloudflare was asked about, which begins at midnight UTC and so reaches a few hours
      further back than the days above: on Today they take in the last of yesterday evening.`}${daysAreUtc
        ? ' The two figures at the top are counted on a Lakewood clock; the days in the chart are'
          + ' not, for the reason given under it.'
        : ' Only the two figures at the top and the chart are counted on a Lakewood clock.'}`} A visit is one person's stay; a page view
      is each page they opened. Anyone reading with an ad blocker is not counted, so these are a
      floor rather than a headcount.${
        /* When these particular numbers were taken. Each range is its own question with its own
           answer, so two of them on the same screen can be from moments apart; printing the time
           is what makes that readable rather than a contradiction. */
        data.fetchedAt ? ` Counted as of ${trafficEsc(trafficClock(data.fetchedAt))}.` : ''
      }${data.cached ? ' (from the last look, not asked again)' : ''}</p>`;
    wireBars();
  };

  /* What to ask for. Over a day it is the two instants that bound it on this clock, and the
     answer is then about that day and nothing else. Over a range it is one day more than is shown:
     the hourly buckets get folded back into local days, and the oldest local day would otherwise
     be missing its first few hours, a UTC midnight being 8pm the evening before in Lakewood. The
     extra is trimmed off in trafficLocalDays. */
  const span = trafficDay ? trafficDayWindow(trafficDay) : null;
  const url = span
    ? `${TRAFFIC_API}?days=1&since=${encodeURIComponent(span.since)}&until=${encodeURIComponent(span.until)}`
    : `${TRAFFIC_API}?days=${trafficDays + 1}`;
  // Kept per question, and a day is its own question, so a day and a range cannot serve each
  // other's answer out of the same slot.
  const cacheKey = trafficDay ? `day:${trafficDay}` : trafficDays;

  const seen = trafficSeen.get(cacheKey);
  if (seen && Date.now() - seen.at < TRAFFIC_KEEP_MS) show(seen.data);

  fetch(url, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      const data = await res.json().catch(() => ({ error: `Cloudflare's Worker answered ${res.status} and not in JSON.` }));
      if (!res.ok || data.error) throw new Error(data.error || `The Worker answered ${res.status}.`);
      trafficSeen.set(cacheKey, { at: Date.now(), data });
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
