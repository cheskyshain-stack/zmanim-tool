// One week on its own page, for the congregation to read rather than for printing a
// season on a wall: the parsha at the top, then a row per minyan with its name on the
// right and its time on the left, running top to bottom.
//
// Nothing here is a new kind of saved sheet. A week card is the corresponding row of an
// already-generated chart, turned on its side: the chart's column headers become the row
// labels and the week's cells become the times. That means every manual edit, rule and
// override already in a sheet shows up here with no extra work, and the two can never
// drift apart.

import { resolveSettings } from '../settings.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { buildWeekdayRow, WEEKDAY_COLUMNS } from '../sheets/weekday.js';
import { inSpringDstWindow } from '../sheets/common.js';
import { applyRules } from '../rules.js';
import { mergeRow } from '../overrides.js';
import { hebrewDateExtended, hasRoshChodesh, hasBehab, hasTaanis } from '../hebrew-calendar.js';
import { UL_START, UL_END } from '../format.js';
import { buildPublishedPayload, publishableGroups, getPublishToken, publishToSite, unpublishFromSite, fetchPublished } from '../publish.js';
import { dateFromSerial } from '../zmanim/solar.js';
import { SLASH } from '../util.js';
import { attachPagePrintToAll } from './print-page.js';

/** Every week of every saved Shabbos sheet, newest sheet first, so a week that appears
 *  in more than one saved sheet resolves to the most recently generated one. */
function weekIndex(state) {
  const sheets = [...state.sheets].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const bySerial = new Map();
  for (const sheet of sheets) {
    if (sheet.season === 'weekday') continue;
    // A saved week's date is an ISO string, not a Date: it went through localStorage.
    // The zmanim code calls Date methods on it, so revive it the way sheet-view does.
    for (const week of sheet.weeks) {
      if (!bySerial.has(week.serial)) bySerial.set(week.serial, { week: { ...week, date: new Date(week.date) }, sheet });
    }
  }
  return bySerial;
}

/** The weekday chart generated alongside a given Shabbos sheet, if there is one. */
function weekdayCompanionOf(sheet, state) {
  return state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
}

/** The week the congregation should be looking at: the next Shabbos still to come.
 *
 *  It rolls over once Shabbos is behind us, so Sunday morning already shows the coming
 *  week. Compared as a date rather than a moment, so the switch happens at midnight on
 *  Motzei Shabbos rather than at an exact tzais. */
export function currentSerial(serials) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const upcoming = serials.filter((s) => dateFromSerial(s).getTime() >= todayUtc);
  return upcoming.length ? Math.min(...upcoming) : Math.max(...serials);
}

/** The chart row for one week, with rules and manual overrides applied, exactly as the
 *  printed chart would show it. */
function rowFor(week, sheet, state, settings) {
  const effectiveSeason = sheet.season === 'choref' && inSpringDstWindow(week.date, settings) ? 'kayitz' : sheet.season;
  const columns = effectiveSeason === 'kayitz' ? KAYITZ_COLUMNS : CHOREF_COLUMNS;
  const build = effectiveSeason === 'kayitz' ? buildKayitzRow : buildChorefRow;
  const hebrew = hebrewDateExtended(week.serial, settings.useGregorianBefore1582);
  const computed = build(week, settings);
  const ruled = applyRules(computed, { ...week, hebrew }, state.rules, effectiveSeason, new Set());
  const { row, overriddenKeys } = mergeRow(ruled, sheet, week.serial);
  return { row, columns, overriddenKeys };
}

/** The ר"ח / בה"ב / תענית days falling in the week leading up to this Shabbos, named and
 *  with the day they fall on.
 *
 *  A week card is anchored on its Shabbos, and the weekday times are for the days before
 *  it, so this walks Sunday through Friday. Yom Kippur and Tisha B'Av are skipped: those
 *  have their own schedule entirely, and listing them beside a regular שחרית time would
 *  be worse than saying nothing. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

function specialDaysInWeek(shabbosSerial, settings) {
  // Grouped by name, so a two-day ראש חודש reads "ראש חדש חשון (Sunday, Monday)" rather
  // than naming the same month twice, and בה״ב lists its Monday and Thursday together.
  const byName = new Map();
  for (let offset = 6; offset >= 1; offset--) {
    const serial = shabbosSerial - offset;
    // offset 6 is the Sunday of that week, offset 1 the Friday.
    const day = DAY_NAMES[6 - offset];
    const names = [hasRoshChodesh(serial, settings), hasBehab(serial, settings), hasTaanis(serial, settings)].filter(Boolean);
    for (const name of names) {
      if (/יום כפור|Yom Kippur|תשעה באב|Tishah/.test(name)) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(day);
    }
  }
  return [...byName.entries()].map(([name, days]) => ({ name, day: days.join(', ') }));
}

const fmtDate = (date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);

/** At most three times to a line, applied to the rendered cell rather than to a string.
 *
 *  Two reasons it is done here. A typed מנחה or מעריב is stored as HTML, and splitting
 *  HTML on "/" would cut through the slash in a closing tag; and a hand-typed value
 *  separates times with a plain "/", where the formulas use a padded one, so a string
 *  split had to know which kind it was holding. Walking text nodes sidesteps both: only
 *  real text is touched, whatever produced it.
 *
 *  Counting resets at every existing break, so a value that already comes in two lines
 *  keeps them and only over-long lines are broken further. */
function capTimesPerLine(root, max = 3) {
  // Counting times rather than separators, because there is no one separator to count.
  // The formulas join with "/", the שחרית schedule uses commas, and a typed list is
  // spaced. Splitting on punctuation therefore missed typed times entirely and left the
  // שחרית line at three. A time is recognisable on its own, so that is what is counted,
  // and a break goes in front of the one that would start a line too many.
  const TIME = /\d{1,2}:\d{2}\*{0,3}/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let onThisLine = 0;
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') onThisLine = 0;
      continue;
    }
    const text = node.nodeValue;
    if (text.includes('\n')) onThisLine = 0;
    const frag = document.createDocumentFragment();
    let cut = 0;
    let match;
    TIME.lastIndex = 0;
    while ((match = TIME.exec(text))) {
      onThisLine++;
      if (onThisLine <= max) continue;
      // Everything up to this time, with the separator that would have preceded it
      // trimmed away so the next line starts at the time itself.
      frag.append(text.slice(cut, match.index).replace(/[\s,/]+$/, ''));
      frag.append(document.createElement('br'));
      cut = match.index;
      onThisLine = 1;
    }
    if (!frag.childNodes.length) continue;
    frag.append(text.slice(cut));
    node.replaceWith(frag);
  }
  trimSeparatorsBeforeBreaks(root);
}

/** The text node immediately before `node` in reading order, without crossing a line
 *  break or leaving `root`. Returns null at either boundary. */
function previousTextNode(from, root) {
  let node = from;
  while (node && node !== root) {
    if (!node.previousSibling) {
      node = node.parentNode;
      continue;
    }
    node = node.previousSibling;
    while (node.lastChild) node = node.lastChild;
    if (node.nodeType === Node.TEXT_NODE) return node;
    if (node.nodeName === 'BR') return null; // a line already ends here, nothing to tidy
  }
  return null;
}

/** Removes the separator stranded at the end of a line by a break inserted above.
 *
 *  The in-node trim can only reach text it is already holding. An underlined time is its
 *  own <u>, so the "/" in front of it lives in the text node *outside* that element and
 *  survives, leaving lines ending in a bare "10:30 /". Every underlined column hits this,
 *  which is most of them, so the tidy-up walks back out of the element and strips it. */
function trimSeparatorsBeforeBreaks(root) {
  for (const br of root.querySelectorAll('br')) {
    let node = previousTextNode(br, root);
    while (node) {
      // No early-out on "nothing changed": the break is usually preceded by an empty
      // text node (the trim above leaves one behind when the whole slice was separator),
      // and stopping there would never reach the real separator further back.
      node.nodeValue = node.nodeValue.replace(/[\s,/]+$/, '');
      if (node.nodeValue) break; // ends in real content now
      node = previousTextNode(node, root); // nothing left here, keep walking back
    }
  }
}

/** A label/time line. The label keeps its line breaks as spaces, since a column header
 *  is wrapped to fit a narrow column and has no reason to wrap here. */
function line(label, value, isHtml = false, keepEmpty = false, labelHtml = '') {
  const text = String(value ?? '').trim();
  if (!text && !keepEmpty) return '';
  return `<div class="week-line">
    <span class="week-label">${labelHtml || weekEsc(label.replace(/\n/g, ' ').trim())}</span>
    <span class="week-time">${isHtml ? text : weekNl2br(text)}</span>
  </div>`;
}

/** The publish step, explained where the thing being published is on screen.
 *
 *  Publishing commits one file to the site, so it takes effect on its own: no file
 *  changes hands. Deliberately a button rather than something automatic, because
 *  publishing is the moment the congregation sees a change and that should be a
 *  decision, not a side effect of editing a cell. */
function publishPanelHtml(sheet) {
  const label = sheet.season === 'kayitz' ? 'שבת קיץ' : 'שבת חורף';
  const hasToken = Boolean(getPublishToken());
  return `<details class="panel no-print">
    <summary>Publish for the congregation</summary>
    <div class="panel-body">
      <p class="hint">The congregation's page is <strong>lczmanim.cjaffa.com</strong>. It shows one week at a time and moves on by itself once Shabbos is over, for the whole season.</p>
      ${
        hasToken
          ? `<div class="actions">
               <button type="button" id="publish-btn" class="btn-primary">Publish <bdi>${weekEsc(label)}</bdi> ${sheet.hebrewYear}</button>
             </div>
             <p class="hint">Publishing this season leaves any other published season in place, so קיץ and חורף can both be live. Publishing the same season again replaces it, which is how a correction reaches the congregation.</p>
             <div id="publish-status" class="hint"></div>
             <div id="published-list"></div>`
          : '<p class="error">No publishing token set. Add one in Settings, under Publishing, and this becomes a single button.</p>'
      }
    </div>
  </details>`;
}

function cardHtml(title, linesHtml, settings) {
  // The same header the wall charts carry, markup and all, rather than a second one that
  // looks similar: one header, one place to change it. It is sized in inches off
  // --sheet-header-scale, so on this narrower page it shrinks in proportion instead of
  // being redrawn.
  return `<section class="week-card">
    <div class="page-header">
      <div class="header-row">
        <img class="header-icon" src="${settings.headerIconImage || '/assets/logo-building-icon.png'}" alt="">
        <div class="header-center">
          <img class="header-logo" src="/assets/logo-text.png" alt="${weekEsc(settings.shulName)}">
          ${settings.headerSubtitle ? `<div class="header-subtitle">${weekEsc(settings.headerSubtitle)}</div>` : ''}
        </div>
        <div class="header-rabbi">${weekNl2br(settings.headerRabbiLine)}</div>
      </div>
    </div>
    <h3 class="week-title">${weekEsc(title)}</h3>
    <div class="week-lines"><div class="week-lines-inner">${linesHtml}</div></div>
    <div class="week-foot">${weekEsc(settings.footerAddress)}</div>
  </section>`;
}

/** Scales a week's list of times down when it would otherwise run past the page.
 *
 *  A שבת קיץ week is eleven rows, some of them two lines deep, and at full size that
 *  spills onto a second sheet: the print preview showed "2 sheets of paper" with the page
 *  cut mid-list. Nothing can be shrunk by CSS alone, so the ratio is measured and applied.
 *
 *  The measurement is now taken from the page on screen, because the page on screen *is*
 *  the printed page: same size, same type, same rules. The earlier version had to inject
 *  the print stylesheet and measure against that, which was fragile and got the answer
 *  wrong twice. */
function fitLinesToPage(container) {
  container.querySelectorAll('.week-card').forEach((card) => {
    const box = card.querySelector('.week-lines');
    const inner = box?.firstElementChild;
    if (!inner) return;
    card.style.removeProperty('--fit-scale');
    const room = box.clientHeight;
    const needed = inner.scrollHeight;
    if (!room || !needed || needed <= room) return;
    // A hair under, so rounding never pushes the last row over the edge.
    card.style.setProperty('--fit-scale', Math.max(0.5, (room / needed) * 0.98).toFixed(3));
  });
}

/** Scales the pages down until one fits across the window.
 *
 *  A letter page is 816px wide, which is wider than a phone and wider than this app's
 *  column on most screens. Scaled rather than scrolled sideways, so a whole page is
 *  visible at once, and with `zoom` rather than `transform` so the layout really shrinks
 *  instead of only being painted smaller. Print resets it: paper has no such problem.
 *
 *  Recomputed on resize, since rotating a phone changes what fits. */
let fitPagesHandler = null;

function fitPagesToWindow(container) {
  const wrap = container.querySelector('.week-cards');
  const card = wrap?.querySelector('.week-card');
  if (!card) return;
  const apply = () => {
    if (!document.body.contains(wrap)) return;
    wrap.classList.remove('is-scaled');
    wrap.style.removeProperty('--page-zoom');
    const available = wrap.clientWidth;
    const pageWidth = card.getBoundingClientRect().width;
    if (!available || !pageWidth || pageWidth <= available) return;
    wrap.style.setProperty('--page-zoom', (available / pageWidth).toFixed(4));
    wrap.classList.add('is-scaled');
  };
  apply();
  if (fitPagesHandler) window.removeEventListener('resize', fitPagesHandler);
  fitPagesHandler = apply;
  window.addEventListener('resize', fitPagesHandler);
}

export function renderWeek(container, state, onSerialChange, serial = null, opts = {}) {
  // opts.luach: the congregation-facing view, which has no app chrome around it.
  const luach = Boolean(opts.luach);
  const settings = resolveSettings(state.settings);
  const index = weekIndex(state);
  const serials = [...index.keys()].sort((a, b) => a - b);

  if (!serials.length) {
    container.innerHTML = luach
      ? '<p class="hint">Nothing has been published yet.</p>'
      : `<h2>This week</h2>
      <p class="hint">One week at a time, laid out to read rather than to print. Generate a שבת sheet first and the weeks in it show up here.</p>`;
    return;
  }

  const showing = serials.includes(serial) ? serial : currentSerial(serials);
  const at = serials.indexOf(showing);
  const { week, sheet } = index.get(showing);
  const { row, columns, overriddenKeys } = rowFor(week, sheet, state, settings);

  // Printed order, right to left, so the card lists the minyanim in the same sequence
  // the wall chart does.
  const shabbosLines = [...columns].reverse().map((c) => line(c.header, row[c.key], overriddenKeys.has(c.key))).join('');

  const weekday = weekdayCompanionOf(sheet, state);
  const weekdayWeek = weekday?.weeks.find((w) => w.serial === showing);
  let weekdayLines = '';
  if (weekdayWeek) {
    // Built from the formulas and then overridden, exactly like the Shabbos row above.
    // A blank baseline here would print an empty מנחה and מעריב on every week nobody had
    // happened to type over, even though the schedule is computed now.
    const { row: wdRow, overriddenKeys: wdOverridden } = mergeRow(buildWeekdayRow(weekdayWeek, settings), weekday, showing);
    const parts = [...WEEKDAY_COLUMNS]
      .reverse()
      // keepEmpty: מנחה and מעריב should hold their row even on a week that computes to
      // nothing, or the card reads as though the minyan does not exist rather than as
      // though the time is not set yet.
      // isHtml only for an override (already real HTML) and for שחרית (rich text out of
      // Settings). A computed value still carries the underline sentinels, which
      // weekNl2br has to turn into real <u> elements.
      .map((c) =>
        c.key === 'E'
          ? line(c.header, htmlLines(state.settings.weekdayShacharis), true, false, '', true)
          : line(c.header, wdRow[c.key], wdOverridden.has(c.key), true)
      );

    // The second שחרית schedule, only on weeks that actually have one of those days,
    // labelled with which day it is rather than the chart's catch-all heading. It goes
    // directly after the everyday schedule, not before it: most of the week still runs
    // on the regular times, so those are what should be read first.
    const special = specialDaysInWeek(showing, settings);
    if (special.length && state.settings.weekdayShacharisSpecial) {
      // The day names go on their own line, in their own direction. Run together with
      // the Hebrew they came out as "(Monday,)" on one line and "(Thursday" on the next:
      // a bracketed Latin list inside a right-to-left label gets reordered when it wraps.
      const labelHtml = special
        .map((d) => `${weekEsc('שחרית ' + d.name)}<br><span class="week-days" dir="ltr">(${weekEsc(d.day)})</span>`)
        .join('<br>');
      parts.splice(1, 0, line('', htmlLines(state.settings.weekdayShacharisSpecial), true, false, labelHtml, true));
    }
    weekdayLines = parts.join('');
  }

  const parsha = week.parsha + (week.specialParsha ? ' · ' + week.specialParsha : '');

  container.innerHTML = `
    ${
      luach
        ? ''
        : `<h2>This week</h2>
    <p class="hint">One week at a time, laid out to read rather than to print. It follows whichever שבת is next and moves on once Shabbos is over.</p>`
    }
    <div class="week-nav no-print">
      <button type="button" id="week-prev" ${at <= 0 ? 'disabled' : ''}>&larr; Previous week</button>
      <button type="button" id="week-today">Today</button>
      <span class="week-when">${fmtDate(week.date)}</span>
      <button type="button" id="week-next" ${at >= serials.length - 1 ? 'disabled' : ''}>Next week &rarr;</button>
    </div>
    <div class="week-cards">
      ${cardHtml('פרשת ' + parsha, shabbosLines, state.settings)}
      ${weekdayLines ? cardHtml('זמני חול · פרשת ' + parsha, weekdayLines, state.settings) : ''}
    </div>
    ${luach ? '' : publishPanelHtml(sheet)}
  `;

  // null puts it back on whichever Shabbos is next, rather than a pinned week.
  // Two to a line on the weekday card, three on the שבת one: a typed list of minyan
  // times is usually longer than a computed pair, and two sit better in the space.
  container.querySelectorAll('.week-card').forEach((card, i) => {
    card.querySelectorAll('.week-time:not(.is-authored)').forEach((el) => capTimesPerLine(el, i === 0 ? 3 : 2));
  });

  // Each page prints on its own: usually you want this week's שבת page, or the חול
  // page, not both.
  attachPagePrintToAll(container, '.week-card', 'Print this page');

  fitLinesToPage(container);
  fitPagesToWindow(container);

  container.querySelector('#week-today')?.addEventListener('click', () => onSerialChange(null));
  container.querySelector('#week-prev')?.addEventListener('click', () => onSerialChange(serials[at - 1]));
  container.querySelector('#week-next')?.addEventListener('click', () => onSerialChange(serials[at + 1]));

  const status = container.querySelector('#publish-status');
  const say = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  /** What is live right now, with a way to take each one back down. */
  const showPublished = async () => {
    const listEl = container.querySelector('#published-list');
    if (!listEl) return;
    try {
      const { data } = await fetchPublished(getPublishToken());
      const live = (data?.sheets || []).filter((s) => s.season !== 'weekday');
      if (!live.length) {
        listEl.innerHTML = '<p class="hint">Nothing is published yet.</p>';
        return;
      }
      listEl.innerHTML =
        '<p class="hint">Live on the congregation&rsquo;s page now:</p>' +
        live
          .map(
            (s) => `<div class="published-row">
              <span><bdi>${weekEsc(s.season === 'kayitz' ? 'שבת קיץ' : 'שבת חורף')}</bdi> ${s.hebrewYear} <span class="hint">(${s.weeks.length} weeks)</span></span>
              <button type="button" class="btn-danger unpublish-btn" data-season="${s.season}" data-year="${s.hebrewYear}" data-id="${s.id}">Unpublish</button>
            </div>`
          )
          .join('');
      listEl.querySelectorAll('.unpublish-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm("Take this season off the congregation's page?")) return;
          btn.disabled = true;
          say('Unpublishing…');
          try {
            const left = await unpublishFromSite({ season: btn.dataset.season, hebrewYear: Number(btn.dataset.year), id: btn.dataset.id }, getPublishToken());
            say(left ? 'Unpublished. The page updates in about a minute.' : 'Unpublished. Nothing is published now.');
            showPublished();
          } catch (err) {
            say(err.message, true);
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = '';
      say(err.message, true);
    }
  };
  showPublished();

  container.querySelector('#publish-btn')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    say('Publishing…');
    try {
      const group = publishableGroups(state).find((g) => g.sheet.id === sheet.id);
      const toPublish = [group.sheet, group.weekday].filter(Boolean);
      await publishToSite(buildPublishedPayload(state, toPublish), getPublishToken());
      say("Published. The congregation's page updates in about a minute.");
      showPublished();
    } catch (err) {
      say(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

/** Rich text from Settings, kept as HTML but with its own outer whitespace trimmed. */
function htmlLines(html) {
  return String(html ?? '').trim();
}

/** Escapes the text, then turns the UL_START/UL_END sentinels the formula ports leave
 *  behind into real <u> elements, and newlines into breaks. Without this an underlined
 *  alternate time loses its underline here while keeping it on the printed chart, and
 *  the sentinel characters sit in the output as invisible strays. */
function weekNl2br(str) {
  const escaped = weekEsc(str).split(UL_START).join('<u>').split(UL_END).join('</u>');
  return escaped.replace(/\n/g, '<br>');
}

function weekEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
