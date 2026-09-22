// What the congregation site is actually showing, right now: which week, which chart page,
// and which of the Special Schedules, with how long before each one goes up and how long
// until it comes back down.
//
// Read off data/published.json, the same file the congregation's own pages fetch, rather than
// off whatever is sitting unsaved in this browser's Settings. Those two usually agree - the
// admin edits and the published file are meant to be kept in step - but this page answers a
// question about the site, not about the admin, and the shul has been caught once before by a
// screen that quietly answered from the wrong one of the two (see the note on RETIRED_SETTINGS
// and loadPublished in storage.js and publish.js). If the two ever disagree, this page is the
// one that is honest about it.
//
// Nothing here is worked out a second time. Which week, which chart page and which occasions
// are showing are the exact functions the congregation's own pages call - currentReaderWeek,
// spreadIndexForNow, onePageOccasionSpans - so this cannot describe a calendar the site itself
// does not agree with.

import { loadPublished } from '../publish.js';
import { resolveSettings } from '../settings.js';
import { readerWeekIndex } from './weekly-reader.js';
import { currentReaderWeek, weekTitle } from './week-view.js';
import { chartSpreads, spreadIndexForNow, spreadLabel } from './chart-view.js';
import { onePageOccasionSpans, ONEPAGE_LEAD_DAYS } from './posters-view.js';
import { weekEndsMins } from '../upcoming.js';
import { excelSerial, dateFromSerial } from '../zmanim/solar.js';
import { formatTime } from '../format.js';
import { escAttr } from '../util.js';

const statusDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const statusDate = (serial) => statusDateFmt.format(dateFromSerial(serial));

/** "Sat, Sep 19, 2026 at 8:11" - the exact instant a week or a chart page turns to the next
 *  one, in the shul's own twelve hour clock with no am or pm on it, the same as the boards
 *  print (see format.js). Worked from the day it turns on and the minute-of-day weekEndsMins
 *  already gives every other reader of this rule. */
function turnsAt(serial, published, settings) {
  const mins = weekEndsMins(serial, published, settings);
  return `${statusDate(serial)} at ${formatTime(mins / 1440)}`;
}

/** One row of the Special Schedules table: the sheet, what it covers, when it goes up, when
 *  it comes down, and where today sits against those three dates. */
function scheduleRow(entry, today) {
  const { from, to } = entry.span;
  const appears = from - ONEPAGE_LEAD_DAYS;
  const disappears = to + 1;
  const status = today > to ? { text: 'Passed', cls: 'is-past' }
    : today >= appears ? { text: 'Showing now', cls: 'is-live' }
    : { text: `Not yet · in ${appears - today} day${appears - today === 1 ? '' : 's'}`, cls: 'is-upcoming' };
  return `<tr class="${status.cls}">
    <td><bdi lang="he">${escAttr(entry.label)}</bdi></td>
    <td>${escAttr(statusDate(from))}${to !== from ? ` &ndash; ${escAttr(statusDate(to))}` : ''}</td>
    <td>${escAttr(statusDate(appears))}</td>
    <td>${escAttr(statusDate(disappears))}</td>
    <td><span class="status-badge ${status.cls}">${escAttr(status.text)}</span></td>
  </tr>`;
}

/** The three congregation-facing screens, read off one published snapshot. */
function statusBody(published) {
  const settings = resolveSettings(published.settings);
  const today = excelSerial(new Date());

  // Weekly Schedule, /week/.
  const index = readerWeekIndex(published);
  const showing = currentReaderWeek(published, settings);
  const weekBlock = showing == null
    ? '<p class="hint">Nothing published yet, so the weekly page has nothing to show.</p>'
    : (() => {
        const { week } = index.get(showing);
        const title = week.parsha ? weekTitle(showing, index) : 'זמני השבוע';
        return `<p><bdi lang="he">${escAttr(title)}</bdi> &middot; week of ${escAttr(statusDate(showing - 6))}.</p>
          <p class="hint">Always shows something: there is no lead time and no coming down. It moves itself
          to the next week the moment there is nothing left on this one, which is
          ${escAttr(turnsAt(showing, published, settings))}, unless the next week is empty too, in which
          case it skips ahead to the first one that has something on it.</p>`;
      })();

  // Zmanim Chart, /chart/.
  const spreads = chartSpreads(published);
  const at = spreadIndexForNow(spreads, published, settings);
  const spread = spreads[at];
  const chartBlock = !spread
    ? '<p class="hint">Nothing published yet, so the chart page has nothing to show.</p>'
    : (() => {
        const label = spreadLabel(spread);
        const next = spreads[at + 1];
        const turn = next ? statusDate(Math.min(...next.serials)) : null;
        return `<p><bdi lang="he">${escAttr(spread.sheet.season === 'kayitz' ? 'שבת קיץ' : 'שבת חורף')}</bdi>
          chart, ${escAttr(label.english)}.</p>
          <p class="hint">Always shows the one page covering the current week; no lead time and nothing
          comes down.${next ? ` Turns to the next page, ${escAttr(spreadLabel(next).english)}, on the
          Sunday it starts: ${escAttr(turn)}.` : ' This is the last page there is.'}</p>`;
      })();

  // Special Schedules, /schedules/.
  const spans = onePageOccasionSpans(published, settings);
  const rows = spans.map((e) => scheduleRow(e, today)).join('');
  const scheduleBlock = spans.length
    ? `<p class="hint">Each sheet goes up ${ONEPAGE_LEAD_DAYS} days before its first date and comes down the
        day after its last: see currentOnePageSheets in posters-view.js, which is the one rule every row
        below is measured against.</p>
      <div class="status-table-wrap">
        <table class="status-table">
          <thead><tr><th>Sheet</th><th>Covers</th><th>Appears</th><th>Disappears</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    : '<p class="hint">Nothing to show: no occasion built for either of the two years around now.</p>';

  return `
    <section class="status-section">
      <h3 class="status-heading">Weekly Schedule &middot; /week/</h3>
      ${weekBlock}
    </section>
    <section class="status-section">
      <h3 class="status-heading">Zmanim Chart &middot; /chart/</h3>
      ${chartBlock}
    </section>
    <section class="status-section">
      <h3 class="status-heading">Special Schedules &middot; /schedules/</h3>
      ${scheduleBlock}
    </section>`;
}

export function renderStatus(main) {
  main.innerHTML = `
    <h2 class="no-print">What the Congregation Sees</h2>
    <p class="hint no-print">Read off the live site itself, data/published.json, not off whatever is
      unsaved here in Settings. If a change here has not been pushed yet, this page and the one you are
      editing will disagree, and this page is the one describing what a visitor sees right now.</p>
    <div id="status-body"><p class="hint">Reading the congregation's own site&hellip;</p></div>`;
  const body = main.querySelector('#status-body');
  loadPublished({ automatic: true })
    .then((published) => { body.innerHTML = statusBody(published); })
    .catch((err) => {
      /* Named the way loadPublished already names it, so a filtered browser is told the truth
         instead of "nothing published" - the exact mistake this project has been caught making
         once already (see the note on GenTech block pages in publish.js). */
      body.innerHTML = `<p class="hint">${err?.message === 'blocked'
        ? 'Could not read the congregation’s site: something between here and it answered instead, most likely a filter or an ad blocker.'
        : 'Nothing is published yet, or it could not be read.'}</p>`;
    });
}
