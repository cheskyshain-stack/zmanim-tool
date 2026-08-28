// One week on its own page, for the congregation to read rather than for printing a
// season on a wall: the parsha at the top, then a row per minyan with its name on the
// right and its time on the left, running top to bottom.
//
// Nothing here is a new kind of saved sheet. A week card is the corresponding row of an
// already-generated chart, turned on its side: the chart's column headers become the row
// labels and the week's cells become the times. That means every manual edit, rule and
// override already in a sheet shows up here with no extra work, and the two can never
// drift apart.

import { resolveSettings, SEASON_LABELS } from '../settings.js';
import { buildKayitzRow, KAYITZ_COLUMNS } from '../sheets/kayitz.js';
import { buildChorefRow, CHOREF_COLUMNS } from '../sheets/choref.js';
import { buildWeekdayRow, WEEKDAY_COLUMNS } from '../sheets/weekday.js';
import { inSpringDstWindow } from '../sheets/common.js';
import { applyRules } from '../rules.js';
import { mergeRow } from '../overrides.js';
import { hebrewDateExtended, hasRoshChodesh, hasBehab, hasTaanis, jewishDateString, isYomTovWeekLabel, weekOfLabel } from '../hebrew-calendar.js';
import { UL_START, UL_END } from '../format.js';
import { buildPublishedPayload, publishableGroups, getPublishToken, publishToSite, unpublishFromSite, fetchPublished } from '../publish.js';
import { SLASH } from '../util.js';
import { printButtonHtml, wirePrintButton } from './print-page.js';
import { currentSerial, wireSwipe } from './nav-helpers.js';

/** Every week worth showing, newest sheet first, so a week that appears in more than one
 *  saved sheet resolves to the most recently generated one.
 *
 *  Shabbos sheets first, then any week a Weekday chart has that they do not. A Yom Tov
 *  Shabbos has no parsha, so it is left out of the Shabbos chart, but the days before it
 *  are ordinary days that are davened and its Weekday chart carries them. Indexing only
 *  the Shabbos sheets left those weeks off the site altogether: שבועות, ראש השנה and
 *  סוכות each had a full set of weekday times published and no way to reach them. Such a
 *  week comes through with no Shabbos sheet, and renders as the חול card on its own. */
export function weekIndex(state) {
  const sheets = [...state.sheets].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const bySerial = new Map();
  // A saved week's date is an ISO string, not a Date: it went through localStorage. The
  // zmanim code calls Date methods on it, so revive it the way sheet-view does.
  const add = (week, sheet) => {
    if (!bySerial.has(week.serial)) bySerial.set(week.serial, { week: { ...week, date: new Date(week.date) }, sheet });
  };
  for (const sheet of sheets) {
    if (sheet.season === 'weekday') continue;
    for (const week of sheet.weeks) add(week, sheet);
  }
  for (const sheet of sheets) {
    if (sheet.season !== 'weekday') continue;
    for (const week of sheet.weeks) add(week, null); // null: no Shabbos chart covers it
  }
  return bySerial;
}

/** The Weekday chart holding a given week, whether it came in beside a Shabbos sheet or
 *  is the only chart that has the week at all. */
export function weekdayChartFor(sheet, serial, state) {
  if (sheet) return weekdayCompanionOf(sheet, state);
  return state.sheets.find((s) => s.season === 'weekday' && s.weeks.some((w) => w.serial === serial)) || null;
}

/** The weekday chart generated alongside a given Shabbos sheet, if there is one. */
function weekdayCompanionOf(sheet, state) {
  return state.sheets.find((s) => s.season === 'weekday' && s.linkedSheetId === sheet.id) || null;
}


/** The chart row for one week, with rules and manual overrides applied, exactly as the
 *  printed chart would show it. */
export function rowFor(week, sheet, state, settings) {
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

/** Which of a week's two cards comes first: the שבת page or the חול page.
 *
 *  Its own localStorage key rather than a field in the app state, for two reasons. It is
 *  a view preference about how one person prints, not part of the shul's data, so it has
 *  no business travelling to the congregation inside published.json. And the
 *  congregation's page never loads the app state at all - it is built from the published
 *  file - so a setting kept there could not reach the very page this button is on. The
 *  publishing token is kept out on its own for a like reason. */
const CARD_ORDER_KEY = 'zmanim-week-card-order';

/** Reading and writing that one key, wrapped so that a browser refusing storage cannot
 *  take the page down with it.
 *
 *  localStorage is not always readable. Touching it from a page inside someone else's site
 *  throws outright where third party storage is blocked, which is now the default in most
 *  browsers, and it throws in a private window in some of them too. Unguarded, that landed
 *  in the middle of building the week and nothing rendered at all: measured, a week page
 *  in an iframe came up empty with "SecurityError: Failed to read the 'localStorage'
 *  property". Which page comes first is a preference; losing the whole schedule over it is
 *  not a trade worth making, so it falls back to the default and carries on. */
function cardOrder() {
  try {
    return localStorage.getItem(CARD_ORDER_KEY) === 'weekday' ? 'weekday' : 'shabbos';
  } catch {
    return 'shabbos';
  }
}

function rememberCardOrder(value) {
  try {
    localStorage.setItem(CARD_ORDER_KEY, value);
  } catch {
    // Nothing to do: the choice still applies to this page, it just will not be
    // remembered next time.
  }
}

/** A setting with two answers, as a switch: both sides on the screen, the chosen one
 *  filled in and the fill sliding across when the other is pressed.
 *
 *  Written once and used for both settings in the panel. A dropdown hides one of two
 *  answers behind a tap, and on a phone opening it throws the system picker up over the
 *  page; a button that toggles hides the other answer behind its own label, so you have to
 *  work out what it will become from what it currently says. A switch shows both and the
 *  state at the same time.
 *
 *  Real radio buttons under the labels, not two <button>s keeping track between them. That
 *  is what a browser already understands as "one of these": the arrow keys move between the
 *  two, a screen reader says "1 of 2", and the checked one is the browser's own state
 *  rather than a class this code has to remember to take off the other one.
 *
 *  Each side is one word where it can be. The label carries the question and the sides
 *  answer it, so the two read as one sentence: writing the whole thing out on both sides
 *  ("שבת, then weekday") is what the dropdown did, and side by side that is the same words
 *  twice. Hebrew goes in a <bdi>: it sits in an otherwise-LTR line and would otherwise be
 *  reordered against what is around it.
 *
 *  `name` is the radio group's name and the stem of every id, so the two switches on the
 *  page cannot capture each other's presses. */
function switchHtml(name, question, sides) {
  const side = ({ value, label, on }) => `
    <input type="radio" name="${name}" id="${name}-${value}" value="${value}"
      class="week-switch-radio"${on ? ' checked' : ''}>
    <label class="week-switch-side" for="${name}-${value}">${label}</label>`;
  // The question and the switch are siblings rather than the switch being wrapped in a row
  // of its own, so that the switches stacked in the panel can share one grid and line their
  // tracks up with each other. aria-labelledby does not care how they are nested.
  return `<span class="week-switch-label" id="${name}-label">${question}</span>
    <div class="week-switch" role="radiogroup" aria-labelledby="${name}-label">
      ${sides.map(side).join('')}
      <span class="week-switch-thumb" aria-hidden="true"></span>
    </div>`;
}

/** Whether the week is being shown as one landscape sheet rather than two pages.
 *
 *  A view, not a print action. It used to build the sheet, hand it to the print dialog and
 *  take it down again inside a second and a half, so the only look anyone got at it was in
 *  the dialog's own preview. Now it stays on the screen and Print prints what is there,
 *  which is what the rest of this page has always done.
 *
 *  Kept here rather than in localStorage: it is how you are looking at this week now, not
 *  a setting, and coming back to the site should open on the ordinary two pages. It has to
 *  outlive a single render, though, since paging to another week re-renders from scratch
 *  and the sheet should still be a sheet afterwards. */
let pairView = false;

/** Whether More options is open, kept for the same reason and in the same way.
 *
 *  Every control in that panel re-renders the week, and the panel was rebuilt closed each
 *  time, so it shut the moment you used anything inside it. With the dropdown that was an
 *  irritation. With the switch it is worse: the thing you just moved goes off the screen
 *  before you can see where it landed, and the keyboard is dropped with it, because focus
 *  cannot stay on a control inside a closed <details> and falls back to the page. Measured:
 *  pressing the right arrow on the switch left document.activeElement as BODY, so a second
 *  arrow press did nothing at all.
 *
 *  Not in localStorage, again like pairView: opening the page fresh should show the panel
 *  closed, the same as it always has. */
let optionsOpen = false;

/** Which season a week belongs to, as something two weeks can be compared by.
 *
 *  The שבת sheet's id where there is one. A week whose Shabbos is Yom Tov has no שבת sheet
 *  at all, since no parsha is read and it has no row on that chart, and it comes through
 *  on its Weekday chart alone: those are the last weeks of the season they close, so they
 *  answer with the sheet that chart was generated beside. Without that, ראש השנה, יום כפור
 *  and סוכות would each read as a season of their own and a run would stop before them. */
function seasonKeyOf(serial, index, state) {
  const sheet = index.get(serial)?.sheet;
  if (sheet) return sheet.id;
  const weekday = weekdayChartFor(null, serial, state);
  return weekday?.linkedSheetId || weekday?.id || null;
}

/** The season that would follow the last week in the list, named. The two alternate, so
 *  it is whichever one the last week is not: a קיץ season ends at Sukkos and חורף picks
 *  up from there. Read off the newest week that belongs to a שבת sheet, since the last
 *  week or two can come from the Weekday chart alone (a Yom Tov week has no parsha and so
 *  no שבת page). */
function nextSeasonLabel(index, serials) {
  for (let i = serials.length - 1; i >= 0; i--) {
    const season = index.get(serials[i])?.sheet?.season;
    if (season) return season === 'kayitz' ? SEASON_LABELS.choref : SEASON_LABELS.kayitz;
  }
  return null;
}

/** "Shabbos, August 22, 2026". Every week here is anchored on its Shabbos, so the day
 *  name is always Saturday and there is no reason to call it that on a shul's own page.
 *  The word is written in rather than formatted, since no locale has it. */
const fmtShabbosDate = (date) =>
  'Shabbos, ' + new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(date);

/** The box a node sits in, when that box is one that starts a line of its own, up to but
 *  not including the cell. Everything below has to agree on where a line begins, and a
 *  <br> is only half the answer: a value typed into a cell is rich text, and the browser's
 *  own editor wraps a new line in a <div> rather than writing a <br>. The מנחה cell of one
 *  hand-typed week is "1:40 / 4:45<div>דרשה 5:15<br>6:14 / 6:29</div>", where the <div> is
 *  a line break on the screen but was invisible to the counting - so 1:40, 4:45 and
 *  דרשה 5:15 counted as one line of three, over the cap of two, and 1:40 was pushed onto a
 *  line of its own away from the 4:45 it was typed beside. */
const LINE_BOX_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'SECTION', 'PRE', 'TABLE', 'TR']);
function lineBoxOf(root, node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== root) {
    if (LINE_BOX_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Tells you, node by node, whether this one has crossed into or out of such a box since
 *  the last one, which is a line break either way: text after a </div> starts a new line
 *  just as text after the matching <div> does. */
function lineBoxTracker(root) {
  let box;
  let seen = false;
  return (node) => {
    const next = lineBoxOf(root, node);
    const crossed = seen && next !== box;
    box = next;
    seen = true;
    return crossed;
  };
}

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
  const collectNodes = () => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    return found;
  };
  let nodes = collectNodes();

  /** Walks the value once, calling onTime for each time and onBreak at each line the
   *  value itself supplies - a <br> put there by weekNl2br, or a \n still inside a text
   *  node (the שחרית schedule is one node holding several lines). Both passes below have
   *  to agree on where a line starts, so they share this rather than repeating it.
   *
   *  A hard break is honoured from where it actually sits, not from the start of the node
   *  it is in: "7:15 7:35**\n8:00" is a single text node, and treating the whole node as
   *  one line left 7:35 sitting beside 7:15 while every other time got a line to itself. */
  const walkTimes = (onTime, onBreak) => {
    const crossedBox = lineBoxTracker(root);
    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') onBreak();
        continue;
      }
      if (crossedBox(node)) onBreak();
      const text = node.nodeValue;
      let prevEnd = 0;
      let match;
      TIME.lastIndex = 0;
      while ((match = TIME.exec(text))) {
        if (text.slice(prevEnd, match.index).includes('\n')) onBreak();
        prevEnd = match.index + match[0].length;
        onTime(node, match);
      }
      if (text.slice(prevEnd).includes('\n')) onBreak();
    }
  };

  // First pass: how many times each of the value's own lines holds.
  const countLines = () => {
    const counts = [0];
    walkTimes(
      () => counts[counts.length - 1]++,
      () => counts.push(0)
    );
    return counts;
  };
  let counts = countLines();

  // A cell of nothing but times, where the value's own line break falls somewhere that
  // leaves a line over the cap, is re-flowed as one run: the workbook writes מנחה ערב שבת
  // as three times and then four, and honouring that break gave 3, 2, 2 where laying the
  // seven out fresh gives 2, 2, 3. Only when a break is needed anyway, so a cell that
  // already fits keeps the grouping the value asked for - מנחה stays 1:20 above
  // 4:03 / 4:18 rather than being run together. Only when the cell is times and
  // separators, so the שחרית schedule keeps its heading and its blocks, and
  // "שקיעה 4:48" is never joined onto the line above it.
  if (!/\p{L}/u.test(root.textContent) && counts.some((n) => n > max)) {
    root.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode(SLASH)));
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.includes('\n')) {
        node.nodeValue = node.nodeValue.replace(/\s*\n\s*/g, SLASH);
      }
    }
    nodes = collectNodes();
    counts = countLines();
  }

  /** How to split n times over as few lines as the cap allows, as evenly as those lines
   *  can be. Filling each line to the cap instead leaves whatever is left over sitting
   *  alone: a run of four with a cap of three came out three and then a single 3:00,
   *  which is what a חורף מנחה ערב שבת does every week once the clocks go back. Seven
   *  becomes 2, 2, 3 rather than 3, 3, 1: the fuller line goes last, so the block builds
   *  downwards rather than tailing off. */
  const sizesFor = (n) => {
    const lines = Math.max(1, Math.ceil(n / max));
    const base = Math.floor(n / lines);
    const extra = n % lines;
    return Array.from({ length: lines }, (_, i) => base + (i >= lines - extra ? 1 : 0));
  };
  const plan = counts.map(sizesFor);

  // Second pass: the same walk, breaking where the plan says to. Cuts are collected and
  // applied per node afterwards, since replacing a node mid-walk would invalidate it.
  const cutsByNode = new Map();
  let line = 0;
  let chunk = 0;
  let taken = 0;
  walkTimes(
    (node, match) => {
      taken++;
      const limit = plan[line]?.[chunk] ?? max;
      if (taken <= limit) return;
      if (!cutsByNode.has(node)) cutsByNode.set(node, []);
      cutsByNode.get(node).push(match.index);
      taken = 1;
      chunk++;
    },
    () => {
      line++;
      chunk = 0;
      taken = 0;
    }
  );

  for (const [node, cuts] of cutsByNode) {
    // A cut at the very start of a node breaks before whatever inline element that node
    // opens, rather than inside it: see insertAtLineStart.
    const leading = cuts[0] === 0;
    const rest = leading ? cuts.slice(1) : cuts;
    if (leading) insertAtLineStart(root, node, document.createElement('br'));
    if (!rest.length) continue;
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let from = 0;
    for (const at of rest) {
      // Everything up to this time, with the separator that would have preceded it
      // trimmed away so the next line starts at the time itself.
      frag.append(text.slice(from, at).replace(/[\s,/]+$/, ''));
      frag.append(document.createElement('br'));
      from = at;
    }
    frag.append(text.slice(from));
    node.replaceWith(frag);
  }
  trimSeparatorsBeforeBreaks(root);
}

/** Strips the space a line starts with, so every line starts on the same axis.
 *
 *  underlineTime writes its value as "<u> 6:42</u>": the leading space gives the rule a
 *  lead-in on the wall chart, where the times are centred and it does not show. Set flush
 *  left here it shows as an indent of about half a character, and only on some lines. The
 *  ones capTimesPerLine broke itself already lost it, being trimmed as the separator in
 *  front of the time, so a line beginning at a break the *source* supplied was indented
 *  while its neighbours were not, which is what made the column look crooked. */
function trimSpaceAtLineStart(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const crossedBox = lineBoxTracker(root);
  let atLineStart = true;
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === 'BR') atLineStart = true;
      continue;
    }
    if (crossedBox(node)) atLineStart = true;
    // [^\S\n] is "whitespace but not a newline", which covers the non-breaking spaces the
    // separators are built from as well as ordinary ones.
    let text = atLineStart ? node.nodeValue.replace(/^[^\S\n]+/, '') : node.nodeValue;
    text = text.replace(/\n[^\S\n]+/g, '\n');
    if (text !== node.nodeValue) node.nodeValue = text;
    // An emptied node leaves the flag alone: the next node is still starting the line.
    if (text.length) atLineStart = text.endsWith('\n');
  }
}

/** Whether this card should stand flush instead of going onto a colon axis.
 *
 *  The axis exists so a column of times does not wobble, and with several long hours in a
 *  block it earns its keep. With exactly one it does the opposite: three lines get pulled in
 *  by a digit and the lone 12:30 reads as though it is sticking out to the left, which is
 *  what it looks like on a חורף שבת card between November and early January.
 *
 *  So: one long hour on the whole card, alone on its line, with the other lines of its own
 *  block carrying two times each. That last part is what separates the שבת card, where the
 *  12:30 sits above three pairs, from a חול card, whose lines carry one time each and whose
 *  מעריב runs 10:00, 10:30, 11:00 together, where the axis is still the right answer. */
const TIME_ON_LINE = /\d{1,2}:\d{2}/g;

function cardShouldStandFlush(cells) {
  const lines = [];
  cells.forEach((cell, block) => {
    // innerText rather than a DOM walk: it is the lines as they actually broke, which is
    // what the question is about, and the pads are not in the document yet.
    cell.innerText.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (line) lines.push({ block, line, times: (line.match(TIME_ON_LINE) || []).length });
    });
  });
  const long = lines.filter((l) => /^\d{2}:\d{2}/.test(l.line));
  if (long.length !== 1) return false;
  const only = long[0];
  if (only.times !== 1) return false;
  const rest = lines.filter((l) => l.block === only.block && l !== only);
  return rest.length > 0 && rest.every((l) => l.times === 2);
}

/** Whether any line in this cell opens with a two-digit hour, which is what decides
 *  whether padding is worth doing. Asked of a whole card rather than one cell: the colons
 *  should line up down the page, so a שחרית block of single-digit hours is padded to sit
 *  on the same axis as a מעריב block that runs past ten, instead of each block finding
 *  its own. Where no row on the card has a long hour, nothing is padded at all: it would
 *  move every line equally and change nothing, except on a row that opens with a word
 *  rather than a time ("6:06" over "פלג 6:21"), where it would shift one and not the
 *  other and pull the two out of line. */
function hasTwoDigitHourAtLineStart(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const crossedBox = lineBoxTracker(root);
  let atLineStart = true;
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === 'BR') atLineStart = true;
      continue;
    }
    if (crossedBox(node)) atLineStart = true;
    const segments = node.nodeValue.split('\n');
    for (let i = 0; i < segments.length; i++) {
      if (i === 0 && !atLineStart) continue;
      if (/^\s*\d{2}:\d{2}/.test(segments[i])) return true;
    }
    atLineStart = node.nodeValue.endsWith('\n');
  }
  return false;
}

/** Lines the colons up down a column of times.
 *
 *  Set flush left, "8:45" and "10:00" start at the same place, which puts their colons a
 *  digit apart and makes the column look as though it wobbles. A single-digit hour is
 *  given a figure space (U+2007, defined to be exactly as wide as a digit) so the hour
 *  occupies two digits' width either way and every colon falls on one axis. Only the time
 *  that starts a line is padded: that is the one the column is read down.
 *
 *  Paired with font-variant-numeric: tabular-nums in the stylesheet, without which a font
 *  with proportional figures would put "1" and "8" at different widths and undo it. */
/** A digit's worth of blank at the start of a line, so a 1:35 lines its colon up with a
 *  12:30. An empty element sized in CSS rather than a U+2007 figure space: as a character
 *  it is only as wide as the font says, and a font without it falls back to something
 *  else or to nothing, so the indent was one thing here and another on a phone. An
 *  inline-block also keeps an ancestor's underline from being drawn through it. */
const timePad = () => {
  const pad = document.createElement('span');
  pad.className = 'time-pad';
  return pad;
};

function alignColons(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  // Where a pad belongs, gathered first and inserted afterwards: putting one in mid-walk
  // splits the very node the walk is reading.
  const inserts = [];
  const crossedBox = lineBoxTracker(root);
  let atLineStart = true;
  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName === 'BR') atLineStart = true;
      continue;
    }
    if (crossedBox(node)) atLineStart = true;
    const text = node.nodeValue;
    if (!text.length) continue;
    // Split on the newlines the value carries, because a line can start in the middle of
    // a text node as well as after a <br>: the שחרית block is "…7:35\n8:00 8:20*…" in one
    // node, and looking only at the node's own start left that 8:00 unpadded while every
    // other time in the column was padded.
    const segments = text.split('\n');
    let at = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const startsAt = at;
      at += segment.length + 1; // + the newline it was split on
      if (i === 0 && !atLineStart) continue;
      // The first time on the line, wherever it sits in the string. Matching only a line
      // that *begins* with one skipped "שקיעה 4:48": in the string the Hebrew word comes
      // first, so the line looked like it had no time to align, and its colon sat a digit
      // to the left of every other colon on the card. Padding the line start moves the
      // whole line, colon included, onto the axis. Only a one-digit hour needs it - a
      // 12:30 is what the axis is set by.
      const firstTime = segment.match(/(\d{1,2}):\d{2}/);
      if (!firstTime || firstTime[1].length !== 1) continue;
      inserts.push({ node, offset: startsAt + segment.match(/^\s*/)[0].length });
    }
    atLineStart = text.endsWith('\n');
  }

  // Back to front, so an earlier offset is still an offset into the same text.
  for (const { node, offset } of inserts.reverse()) {
    if (offset === 0) insertAtLineStart(root, node, timePad());
    else {
      const tail = node.splitText(offset);
      tail.parentNode.insertBefore(timePad(), tail);
    }
  }
}

/** Puts an element in front of a node that opens a line, outside whatever inline element
 *  the node happens to open. A pad left inside a <u> is fine to look at but a <br> is not:
 *  an underlined line break paints a rule out to the edge of the line in some engines, and
 *  the markup reads as though the underline spans two lines when it does not.
 *
 *  It stops at a box that starts a line of its own: climbing out of a <div> would put the
 *  pad or the break in front of the whole block rather than at the head of its first line,
 *  which is a line the value never asked for. */
function insertAtLineStart(root, node, el) {
  let target = node;
  while (
    target.parentNode &&
    target.parentNode !== root &&
    !LINE_BOX_TAGS.has(target.parentNode.tagName) &&
    target.parentNode.firstChild === target
  ) {
    target = target.parentNode;
  }
  target.parentNode.insertBefore(el, target);
}

/** Hangs the location stars off the end of a time instead of letting them widen it.
 *
 *  A star says which room a מנין is in, not what time it is, so it should not move the
 *  time. Centred with the star counted, 7:20* sat a couple of characters left of 7:00
 *  above it and the column read as though it had been nudged. Each run of stars goes into
 *  a box of no width, so it still prints exactly where it was but the line measures as
 *  the digits alone and every time centres on the same axis. */
function hangTimeMarkers(root) {
  const MARKED = /(\d{1,2}:\d{2})(\*{1,3})/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    if (!MARKED.test(text)) continue;
    MARKED.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let cut = 0;
    let match;
    while ((match = MARKED.exec(text))) {
      frag.append(text.slice(cut, match.index) + match[1]);
      const mark = document.createElement('span');
      mark.className = 'time-mark';
      mark.textContent = match[2];
      frag.append(mark);
      cut = match.index + match[0].length;
    }
    frag.append(text.slice(cut));
    node.replaceWith(frag);
  }
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

/** The key to the symbols, carrying only the lines the card actually uses.
 *
 *  A card is a page on its own, so it has to say what its own marks mean, but saying all
 *  three every time would explain marks that are not on it: a week whose מנינים are all
 *  in the main בית מדרש has no underline to explain, and באולם השמחות only appears on a
 *  week that has a second שחרית. Each line is added only if its mark is on the card.
 *
 *  The star lines are set right to left so the star sits at the right-hand end, against
 *  the Hebrew it belongs to, the same way round as the footer of the printed chart. The
 *  first line is mostly English and is set the other way. Measured, not assumed: stored
 *  order is not display order for either of them. */
function fillLegend(card) {
  const legend = card.querySelector('.week-legend');
  if (!legend) return;
  const marks = [...card.querySelectorAll('.week-lines .time-mark')].map((m) => m.textContent.trim());
  const lines = [];
  if (card.querySelector('.week-lines u')) lines.push({ dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' });
  // The two star notes share a line, in the order the printed chart's footer has them,
  // and either can appear on its own if only its mark is on the card.
  const stars = [];
  if (marks.includes('*')) stars.push('*בעזרת נשים');
  if (marks.includes('**')) stars.push('**באולם השמחות');
  if (stars.length) lines.push({ dir: 'rtl', text: stars.join(' ') });
  legend.innerHTML = lines.map((l) => `<div class="week-legend-line" dir="${l.dir}">${weekEsc(l.text)}</div>`).join('');
}

/** A row's name, taken from the chart's column header.
 *
 *  A header is written to wrap inside a narrow chart column, so its own breaks mean
 *  nothing on a card and are flattened away. Two are exceptions, and for the same reason:
 *  the name is two things and run onto one line it reads as neither.
 *
 *  A פלג row keeps a break in front of פלג, which is what separates "מנחה (למטה)" from
 *  "פלג מ״א". And ס״ז קר״ש keeps one after it, separating the zman from the two opinions
 *  it is given by, "גר״א / מ״א". Both breaks are already in the chart's own headers; this
 *  puts back the two that are worth keeping.
 *
 *  No other header wants one: "הדלקת נרות" and "מנחה ערב שבת" are single names that only
 *  wrapped because the chart column was narrow. */
function formatLabel(label) {
  return weekEsc(label.replace(/\s+/g, ' ').trim())
    .replace(/ (פלג )/, '<br>$1')
    // Matched after escaping, so the gershayim may be a real ״ or the &quot; that a plain
    // double quote in the header turns into.
    .replace(/(קר(?:&quot;|״|")ש) /, '$1<br>');
}

/** A label/time line. */
function line(label, value, isHtml = false, keepEmpty = false, labelHtml = '') {
  const text = String(value ?? '').trim();
  if (!text && !keepEmpty) return '';
  return `<div class="week-line">
    <span class="week-label">${labelHtml || formatLabel(label)}</span>
    <span class="week-time">${isHtml ? text : weekNl2br(text)}</span>
  </div>`;
}

/** The publish step, explained where the thing being published is on screen.
 *
 *  Publishing commits one file to the site, so it takes effect on its own: no file
 *  changes hands. Deliberately a button rather than something automatic, because
 *  publishing is the moment the congregation sees a change and that should be a
 *  decision, not a side effect of editing a cell. */
function publishPanelHtml(sheet, state, open = false) {
  const hasToken = Boolean(getPublishToken());
  const groups = publishableGroups(state);
  const label = (s) => SEASON_LABELS[s.season] || s.season;
  // A row here is a season that exists to be published. With only one generated there is
  // only one row, which reads as "there is no way to publish a second chart" - so say
  // where the second one comes from instead of leaving an empty space to interpret.
  const missing = ['kayitz', 'choref'].filter((season) => !groups.some((g) => g.sheet.season === season));
  const rows = groups
    .map(
      (g) =>
        `<div class="published-row">
          <span><bdi>${weekEsc(label(g.sheet))}</bdi> ${g.sheet.hebrewYear} <span class="hint">(${g.sheet.weeks.length} weeks${g.sheet.id === sheet?.id ? ', the week you are on' : ''})</span></span>
          <button type="button" class="btn-primary publish-btn" data-id="${g.sheet.id}">Publish</button>
        </div>`
    )
    .join('');
  return `<details class="panel no-print" id="publish-panel" ${open ? 'open' : ''}>
    <summary>Publish for the congregation</summary>
    <div class="panel-body">
      <p class="hint">The congregation's page is <strong>lczmanim.cjaffa.com</strong>. It shows one week at a time and moves on by itself once Shabbos is over, for the whole season.</p>
      ${
        hasToken
          ? `${rows || '<p class="hint">No season has been generated yet.</p>'}
             ${
               groups.length && missing.length
                 ? `<p class="hint">Only ${missing.length === 1 ? `<bdi>${weekEsc(SEASON_LABELS[missing[0] === 'kayitz' ? 'choref' : 'kayitz'])}</bdi> is here` : 'these are here'}. A second chart gets its own row: generate <bdi>${weekEsc(SEASON_LABELS[missing[0]])}</bdi> on the Generate tab and it turns up above, with its own Publish button.</p>`
                 : ''
             }
             <p class="hint">Publishing a season leaves any other published season in place, so קיץ and חורף can both be live. Publishing the same season again replaces it, which is how a correction reaches the congregation.</p>
             <div id="publish-status" class="hint"></div>
             <div id="published-list"></div>`
          : '<p class="error">No publishing token set. Add one in Settings, under Publishing, and this becomes a single button.</p>'
      }
    </div>
  </details>`;
}

function cardHtml(title, linesHtml, settings, kind = '') {
  // The same header the wall charts carry, markup and all, rather than a second one that
  // looks similar: one header, one place to change it. It is sized in inches off
  // --sheet-header-scale, so on this narrower page it shrinks in proportion instead of
  // being redrawn.
  return `<section class="week-card${kind ? ' ' + kind : ''}">
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
    <div class="week-legend"></div>
    <div class="week-foot">${weekEsc(settings.footerAddress)}</div>
  </section>`;
}

/** Sizes a week's list of times to the page: down when it would run past the bottom, up
 *  when it would otherwise leave the sheet half empty.
 *
 *  A שבת קיץ week is eleven rows, some of them two lines deep, and at full size that
 *  spills onto a second sheet: the print preview showed "2 sheets of paper" with the page
 *  cut mid-list. Nothing can be shrunk by CSS alone, so the ratio is measured and applied.
 *
 *  The weekday card is the opposite problem. It carries three minyanim, and even with a
 *  time to a line it stopped two thirds down the sheet, which on a wall reads as a page
 *  that failed to finish rather than as a short list. So it grows to meet the footer.
 *
 *  The measurement is taken from the page on screen, because the page on screen *is* the
 *  printed page: same size, same type, same rules. The earlier version had to inject the
 *  print stylesheet and measure against that, which was fragile and got the answer wrong
 *  twice. */
const MAX_GROW = 1.6; // past this the times are billboard-sized rather than well set

function fitLinesToPage(container) {
  container.querySelectorAll('.week-card').forEach((card) => {
    const box = card.querySelector('.week-lines');
    const inner = box?.firstElementChild;
    if (!inner) return;
    card.style.removeProperty('--fit-scale');
    card.style.removeProperty('--fit-width');
    const room = box.clientHeight;
    const needed = inner.scrollHeight;
    if (!room || !needed) return;
    // A hair under, so rounding never pushes the last row over the edge.
    const byHeight = (room / needed) * 0.98;
    if (needed > room) {
      card.style.setProperty('--fit-scale', Math.max(0.5, byHeight).toFixed(3));
      return;
    }
    // Growing must not widen the block. zoom scales the measure along with the type, and
    // the weekday card grew far enough that its rows spanned the whole page while the
    // שבת card's stayed narrow, so a pair of cards meant to match did not. Dividing the
    // measure by the same factor cancels that: the type grows, the block stays put.
    //
    // A constant width and bigger type can push a line into wrapping, which makes the
    // block taller than the growth assumed, so the result is measured and eased back
    // until it really fits rather than trusted first time.
    let grow = Math.min(byHeight, MAX_GROW);
    for (let i = 0; i < 8 && grow > 1.02; i++) {
      card.style.setProperty('--fit-scale', grow.toFixed(3));
      card.style.setProperty('--fit-width', grow.toFixed(3));
      if (inner.scrollHeight * grow <= room) return;
      grow -= 0.05;
    }
    card.style.removeProperty('--fit-scale');
    card.style.removeProperty('--fit-width');
  });
}

/** Sizes the times in each column of the pair sheet.
 *
 *  Its own routine rather than fitLinesToPage, because on this sheet the measure is tied
 *  to the scale: the block is set to 77% of the column divided by the scale, so that what
 *  lands on the paper is 77% whichever way it went. That means the height does not simply
 *  scale with the type the way it does on a card, since a narrower measure wraps more
 *  lines. So the scale is searched for and each try is measured, rather than worked out
 *  from one ratio and trusted.
 *
 *  A halving search: bigger type in a narrower measure is always taller on the paper, so
 *  there is one crossing point to find and nine tries land within a thousandth of it. */
function fitPairColumns(sheet) {
  sheet.querySelectorAll('.week-card').forEach((card) => {
    const box = card.querySelector('.week-lines');
    const inner = box?.firstElementChild;
    if (!inner) return;
    card.style.removeProperty('--fit-width');
    const room = box.clientHeight;
    if (!room) return;
    let fits = 0.5;
    let tooBig = MAX_GROW;
    for (let i = 0; i < 9; i++) {
      const mid = (fits + tooBig) / 2;
      card.style.setProperty('--fit-scale', mid.toFixed(3));
      // scrollHeight is in the block's own space, which zoom then scales onto the paper.
      if (inner.scrollHeight * mid <= room) fits = mid;
      else tooBig = mid;
    }
    card.style.setProperty('--fit-scale', fits.toFixed(3));
  });
}

/** Rebuilds the two cards on screen as one landscape sheet: a single header across the
 *  top, the two lists of times side by side under it, and one address along the bottom.
 *
 *  The cards are moved rather than rebuilt. Everything that was worked out on them, the
 *  legend, the line caps, which times are underlined, the colon axis, comes across
 *  untouched, and there is no second copy of any of that logic to keep in step.
 *
 *  Returns false when there is only one card, which is a week whose Shabbos is Yom Tov:
 *  there is nothing to put beside it and the button is not offered. */
function buildPairSheet(wrap) {
  const cards = [...wrap.querySelectorAll('.week-card')];
  if (cards.length < 2) return false;
  const header = cards[0].querySelector('.page-header');
  const foot = cards[0].querySelector('.week-foot');

  // The parsha, once, in the middle. Read off the שבת card, whose title is the parsha
  // line on its own; the חול card's has "זמני חול · " in front of it and would have to be
  // unpicked. The button is only offered when both cards exist, so there is always one.
  const shabbosCard = cards.find((card) => !card.classList.contains('is-weekday-card'));
  const parsha = shabbosCard?.querySelector('.week-title')?.textContent.trim() || '';

  const sheet = document.createElement('section');
  sheet.className = 'week-pair';
  if (header) sheet.appendChild(header.cloneNode(true));
  if (parsha) {
    const title = document.createElement('h2');
    title.className = 'week-pair-title';
    title.textContent = parsha;
    sheet.appendChild(title);
  }

  const cols = document.createElement('div');
  cols.className = 'week-pair-cols';
  cards.forEach((card) => {
    // With the parsha said once above, each column only has to say which half it is.
    const title = card.querySelector('.week-title');
    if (title) title.textContent = card.classList.contains('is-weekday-card') ? 'זמני חול' : 'זמני שבת';
    // appendChild moves them, so wrap is left empty and the sheet takes their place.
    cols.appendChild(card);
  });
  sheet.appendChild(cols);

  // One note under the pair, carrying every line either column needed and each of them
  // once. Both columns explain the same underline, and set out twice on one sheet that
  // reads as two different notes rather than one said twice. The star lines are only on
  // the column that uses them, so a straight merge keeps whatever is relevant and drops
  // nothing: taken in column order, first seen wins.
  const seen = new Set();
  const merged = [];
  cards.forEach((card) => {
    card.querySelectorAll('.week-legend .week-legend-line').forEach((el) => {
      const key = `${el.getAttribute('dir')}|${el.textContent.trim()}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(el.cloneNode(true));
    });
  });
  if (merged.length) {
    const legend = document.createElement('div');
    legend.className = 'week-legend week-pair-legend';
    merged.forEach((el) => legend.appendChild(el));
    sheet.appendChild(legend);
  }

  if (foot) sheet.appendChild(foot.cloneNode(true));
  wrap.appendChild(sheet);
  wrap.classList.add('is-pairing');
  return true;
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

/** Scales the one landscape sheet down until it fits across the window.
 *
 *  The same idea as fitPagesToWindow, but the zoom goes on the sheet rather than on the
 *  cards inside it. On the cards it would land between the sheet and the columns, and a
 *  zoom on a flex item changes the height it resolves to, which is what the times were
 *  sized against. On the sheet itself nothing inside it can tell the difference.
 *
 *  A sheet is 11in wide against a phone's 4in or so, so on a phone this comes out at about
 *  a third size: enough to see the shape of the page and to check it before printing it,
 *  not enough to read the times off. That is the honest cost of looking at a landscape
 *  sheet on a portrait phone, and Back to two pages is right there. */
function fitSheetToWindow(container) {
  const wrap = container.querySelector('.week-cards');
  const sheet = wrap?.querySelector('.week-pair');
  if (!sheet) return;
  const apply = () => {
    if (!document.body.contains(sheet)) return;
    sheet.style.removeProperty('zoom');
    const available = wrap.clientWidth;
    const sheetWidth = sheet.getBoundingClientRect().width;
    if (!available || !sheetWidth || sheetWidth <= available) return;
    sheet.style.zoom = (available / sheetWidth).toFixed(4);
  };
  apply();
  if (fitPagesHandler) window.removeEventListener('resize', fitPagesHandler);
  fitPagesHandler = apply;
  window.addEventListener('resize', fitPagesHandler);
}

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

/** Everything that has to be done to a card once its markup is in the document: break
 *  the long lines, square the times up, hang the marks, and write the key.
 *
 *  A function rather than inline, because printing the rest of the season replaces the
 *  cards with a whole season's worth and every one of them needs the same treatment. */
function decorateCards(root) {
  root.querySelectorAll('.week-card').forEach((card) => {
    // Two to a line on the שבת card, one on the weekday card. The weekday card carries
    // only three minyanim against a full sheet, so a time to a line is what fills it;
    // the שבת card has eleven rows and would run off the page the same way. Keyed on
    // which card it is rather than where it sits: a Yom Tov week has no שבת card, and
    // going by position gave its חול card the שבת card's own count.
    //
    // It was three. Two makes the pairs plain and, with sizesFor putting the short line
    // first, leaves any odd time at the top of the block rather than trailing off the
    // bottom: seven comes out 1, 2, 2, 2.
    const perLine = card.classList.contains('is-weekday-card') ? 1 : 2;
    card.querySelectorAll('.week-time:not(.is-authored)').forEach((el) => capTimesPerLine(el, perLine));
    const cells = [...card.querySelectorAll('.week-time')];
    cells.forEach((el) => trimSpaceAtLineStart(el));
    // One colon axis for the whole card rather than one per row, except where a single long
    // hour would be the only thing on it: see cardShouldStandFlush.
    if (cells.some((el) => hasTwoDigitHourAtLineStart(el)) && !cardShouldStandFlush(cells)) {
      cells.forEach((el) => alignColons(el));
    }
    cells.forEach((el) => hangTimeMarkers(el));
    // After the marks exist, so the key can be built from what is really on the card.
    fillLegend(card);
  });
}

/** Both cards for one week, as markup, ready to be dropped into a .week-cards container.
 *
 *  Split out of renderWeek so a week other than the one on screen can be built too: that
 *  is what printing the rest of the season does, which lays every remaining week out at
 *  once rather than asking someone to page through and print them one at a time. */
function weekCardsHtml(showing, index, state, settings) {
  const { week, sheet } = index.get(showing);

  // No Shabbos sheet means this week's Shabbos is Yom Tov, which has no parsha and so no
  // row on the chart. The weekday times are still real, so the week shows its חול card
  // alone rather than being dropped.
  const shabbos = sheet ? rowFor(week, sheet, state, settings) : null;
  // Printed order, right to left, so the card lists the minyanim in the same sequence
  // the wall chart does.
  const shabbosLines = shabbos
    ? [...shabbos.columns].reverse().map((c) => line(c.header, shabbos.row[c.key], shabbos.overriddenKeys.has(c.key))).join('')
    : '';

  const weekday = weekdayChartFor(sheet, showing, state);
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
  // A week whose Shabbos is Yom Tov is named for its Yom Tov rather than a parsha, no
  // parsha being read that Shabbos. "פרשת סוכות" would be wrong and "סוכות" on its own
  // reads as though these were the times for Yom Tov, which they are not: they are the
  // ordinary weekdays around it. Named off the label rather than off the missing Shabbos
  // sheet, so the card and the chart say the same thing by the same rule.
  const cardTitle = isYomTovWeekLabel(week.parsha) ? weekOfLabel(week.parsha, false) : 'פרשת ' + parsha;

  const shabbosCard = shabbosLines ? cardHtml(cardTitle, shabbosLines, state.settings) : '';
  const weekdayCard = weekdayLines ? cardHtml('זמני חול · ' + cardTitle, weekdayLines, state.settings, 'is-weekday-card') : '';
  // The two are ordered the same way on screen as on paper, here rather than only in the
  // print run: this page's whole bargain is that what you see is what comes out, so an
  // order that applied to the printer alone would be a surprise waiting to happen.
  return cardOrder() === 'weekday' ? weekdayCard + shabbosCard : shabbosCard + weekdayCard;
}


export function renderWeek(container, state, onSerialChange, serial = null, opts = {}) {
  // opts.luach: the congregation-facing view, which has no app chrome around it.
  const luach = Boolean(opts.luach);
  // opts.heading: false where whatever put this on the screen has already written the
  // heading itself. On This week the pages and the wall chart are two sides of one screen,
  // so the title and the buttons that swap them belong to the screen, not to this half.
  const heading = !luach && opts.heading !== false;
  const settings = resolveSettings(state.settings);
  const index = weekIndex(state);
  const serials = [...index.keys()].sort((a, b) => a - b);

  if (!serials.length) {
    container.innerHTML = luach
      ? '<p class="hint">Nothing has been published yet.</p>'
      : `${heading ? '<h2>This week</h2>' : ''}
      <p class="hint">One week at a time, laid out to read rather than to print. Generate a שבת sheet first and the weeks in it show up here.</p>`;
    return;
  }

  const showing = serials.includes(serial) ? serial : currentSerial(serials);
  const at = serials.indexOf(showing);
  const { sheet } = index.get(showing);
  const week = index.get(showing).week;
  const cardsHtml = weekCardsHtml(showing, index, state, settings);
  const cardCount = (cardsHtml.match(/class="week-card/g) || []).length;

  container.innerHTML = `
    ${
      heading
        ? // no-print, like the nav and the publish panel below. Left printable, this
          // heading and its explanation are the only things on the page not claiming the
          // "weekcard" named page, so they took a sheet of their own: a landscape one, at
          // the wall chart's @page size, empty apart from two lines of screen furniture.
          `<h2 class="no-print">This week</h2>
    <p class="hint no-print">One week at a time, laid out to read rather than to print. It follows whichever שבת is next and moves on once Shabbos is over.</p>`
        : ''
    }
    <div class="week-nav no-print">
      <div class="week-nav-when">
        ${fmtShabbosDate(week.date)}
        <bdi class="week-nav-hebrew">${weekEsc(jewishDateString(week.serial, false, settings.useGregorianBefore1582))}</bdi>
      </div>
      <div class="week-nav-row">
        <button type="button" id="week-prev" ${at <= 0 ? 'disabled' : ''}>
          <span aria-hidden="true">&larr;</span><span class="week-nav-word">Previous</span>
        </button>
        <button type="button" id="week-today">Today</button>
        <button type="button" id="week-next" ${at >= serials.length - 1 ? 'disabled' : ''}>
          <span class="week-nav-word">Next</span><span aria-hidden="true">&rarr;</span>
        </button>
      </div>
      <details class="panel week-print-panel no-print" ${optionsOpen ? 'open' : ''}>
        <summary>More options</summary>
        <div class="panel-body">
          <!-- Print is in here rather than out on the nav row above it. Everything to do
               with paper is then in one place, and the row above stays what it is for:
               moving from week to week. The panel is called More options rather than
               Printing options because Print itself now lives in it. -->
          <div class="week-nav-row week-nav-print-one">${printButtonHtml()}</div>
          ${
            // Both switches, or neither. Each of them is a question about two pages, and a
            // week that has only one (a Shabbos that is Yom Tov comes through on its
            // Weekday chart alone) has nothing to lay out beside anything and nothing to
            // put first. "Which page first" used to show anyway and answered a question
            // that week did not raise.
            cardCount > 1
              ? `<div class="week-switches">
                  ${switchHtml('week-pages', 'Pages per sheet', [
                    { value: 'one', label: 'One', on: !pairView },
                    { value: 'two', label: 'Two', on: pairView },
                  ])}
                  ${switchHtml('week-order', 'Which page first', [
                    { value: 'shabbos', label: '<bdi>שבת</bdi>', on: cardOrder() === 'shabbos' },
                    { value: 'weekday', label: 'Weekday', on: cardOrder() === 'weekday' },
                  ])}
                </div>`
              : ''
          }
          <div class="week-nav-row week-nav-print">
            <button type="button" id="week-print-rest">Print every week to the end of the season</button>
          </div>
          <!-- There was a note here telling a phone to turn the paper round: the sheet
               used to be landscape and the print dialog opens portrait. It is portrait
               itself now, on the same paper a card uses, so there is nothing to say. -->
        </div>
      </details>
      ${
        // At the end of the list, say why rather than just greying Next out. The weeks
        // here are the published ones, and a season stops where the next season begins:
        // Next runs out at Sukkos because the winter chart is not up, which looks like a
        // broken button unless it says so.
        at >= serials.length - 1 && nextSeasonLabel(index, serials)
          ? `<p class="hint no-print week-end-note">This is the last week published. <bdi>${weekEsc(nextSeasonLabel(index, serials))}</bdi> is not up yet${luach ? '' : ', so generate it and publish it below'}.</p>`
          : ''
      }
    </div>
    <div class="week-cards">${cardsHtml}</div>
    ${luach ? '' : publishPanelHtml(sheet, state, Boolean(opts.openPublish))}
  `;

  // null puts it back on whichever Shabbos is next, rather than a pinned week.
  // Three to a line on the שבת card, one on the weekday card. The weekday card carries
  // only three minyanim against a full sheet, so a time to a line is what fills it;
  // the שבת card has eleven rows and would run off the page the same way. Keyed on which
  // card it is rather than where it sits: a Yom Tov week has no שבת card, and going by
  // position gave its חול card the שבת card's three-to-a-line.
  decorateCards(container);
  fitLinesToPage(container);

  // Either the two pages as they are, or the pair of them rebuilt as one landscape sheet.
  // The sheet is a real thing on the screen from here on, not something assembled for the
  // length of a print run, so what goes to the printer is whatever is being looked at.
  const wrap = container.querySelector('.week-cards');
  const onSheet = pairView && cardCount > 1 && buildPairSheet(wrap);
  if (onSheet) {
    // The columns are a different shape from the cards they came out of, so the times are
    // sized again for them. Before the sheet is scaled to the window, not after: a scale
    // on the sheet changes what the columns measure, and with it left on the same sheet
    // fitted at 1.60 in a 412px window and 0.70 in a 1280px one.
    fitPairColumns(wrap.querySelector('.week-pair'));
    fitSheetToWindow(container);
  } else {
    fitPagesToWindow(container);
  }

  // The one Print button: the whole screen goes to the dialog and the choosing happens
  // there, which is where a person can pick a single page anyway.
  wirePrintButton(container);

  // The two switches, wired the same way. Both answers change what the week looks like, so
  // both draw it again rather than rearranging it in place: the cards are decorated after
  // they are built (line caps, colon axis, legend, the fit-to-page pass) and those passes
  // are not safe to run over their own output. It is the same reason the print-rest run
  // below restores from raw markup.
  //
  // The one-sheet view claims a page of its own, portrait like the paper a card uses, so
  // printing it needs nothing asked for in the print dialog.
  const onSwitch = (name, apply) => {
    container.querySelector(`.week-switch[aria-labelledby="${name}-label"]`)
      ?.addEventListener('change', (e) => {
        if (!e.target.matches('.week-switch-radio')) return;
        apply(e.target.value);
        onSerialChange(showing);
        // Put the keyboard back on the side now chosen, or the next arrow press goes
        // nowhere: measured, without this document.activeElement came back as BODY and a
        // second press of the arrow keys did nothing at all. This works because optionsOpen
        // keeps the panel open through the redraw, since nothing inside a closed <details>
        // can hold focus.
        //
        // Off the document, not off `container`. On the congregation site the callback
        // rebuilds the whole page, so the #week-host this closure is holding is a detached
        // node by the time it returns and the radio found inside it is a copy nobody can
        // see. Focusing that is what left the page on BODY even with the panel open.
        //
        // preventScroll because the radio itself is a 1px box tucked under the label:
        // without it the browser is entitled to scroll that speck to the middle of the
        // screen.
        document.querySelector(`.week-switch-radio[name="${name}"]:checked`)
          ?.focus({ preventScroll: true });
      });
  };
  onSwitch('week-pages', (value) => { pairView = value === 'two'; });
  onSwitch('week-order', (value) => rememberCardOrder(value === 'weekday' ? 'weekday' : 'shabbos'));

  // Every week from this one to the end of the season, in one run. Each week is built and
  // treated exactly as it is when it is on the screen on its own, so a printed run cannot
  // drift from what a week looks like: same markup, same passes, and the one-sheet view if
  // that is what is being looked at.
  //
  // To the end of the season and no further. It used to take every week left in the index,
  // which is every week of every published sheet: pressed in August it ran from there to
  // the end of the following חורף, 33 weeks and 67 pages, rather than the six weeks left
  // of קיץ. A season is a שבת sheet plus the Yom Tov weeks after it that only its Weekday
  // chart covers, so the run stops where that changes.
  container.querySelector('#week-print-rest')?.addEventListener('click', () => {
    const wrap = container.querySelector('.week-cards');
    const key = seasonKeyOf(showing, index, state);
    const rest = [];
    for (let i = at; i < serials.length; i++) {
      if (seasonKeyOf(serials[i], index, state) !== key) break;
      rest.push(serials[i]);
    }

    wrap.innerHTML = '';
    for (const serial of rest) {
      // One host per week, so a week's two cards stay together and the one-sheet build has
      // exactly the pair it expects rather than every card in the run.
      const host = document.createElement('div');
      host.className = 'week-cards';
      wrap.appendChild(host);
      host.innerHTML = weekCardsHtml(serial, index, state, settings);
      decorateCards(host);
      fitLinesToPage(host);
      if (pairView && host.querySelectorAll('.week-card').length > 1) {
        buildPairSheet(host);
        fitPairColumns(host.querySelector('.week-pair'));
      }
    }
    // Put back by re-rendering rather than by rebuilding the cards here. The screen may
    // have been on the one-sheet view when this was pressed, and putting the two cards
    // back by hand would have dropped it.
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', restore);
      onSerialChange(showing);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 1500);
  });
  // Remembering it is the whole point (see optionsOpen). toggle fires on open and close
  // alike, and .open is the state it has just reached.
  container.querySelector('.week-print-panel')?.addEventListener('toggle', (e) => {
    optionsOpen = e.target.open;
  });

  container.querySelector('#week-today')?.addEventListener('click', () => onSerialChange(null));
  container.querySelector('#week-prev')?.addEventListener('click', () => onSerialChange(serials[at - 1]));
  container.querySelector('#week-next')?.addEventListener('click', () => onSerialChange(serials[at + 1]));

  // Arriving from "Publishing" on Saved sheets: the panel is already open, but it sits
  // below a full week card, so without this you land on the card with no sign that
  // anything happened.
  if (opts.openPublish) container.querySelector('#publish-panel')?.scrollIntoView({ block: 'start' });

  wireSwipe(
    container,
    () => at > 0 && onSerialChange(serials[at - 1]),
    () => at < serials.length - 1 && onSerialChange(serials[at + 1])
  );

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

  container.querySelectorAll('.publish-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
    btn.disabled = true;
    say('Publishing…');
    try {
      const group = publishableGroups(state).find((g) => g.sheet.id === btn.dataset.id);
      const toPublish = [group.sheet, group.weekday].filter(Boolean);
      await publishToSite(buildPublishedPayload(state, toPublish), getPublishToken());
      say("Published. The congregation's page updates in about a minute.");
      showPublished();
    } catch (err) {
      say(err.message, true);
    } finally {
      btn.disabled = false;
    }
    })
  );
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
  // underlineTime writes its value as "<u> 6:42</u>", a space inside the underline. On
  // the wall chart that lead-in is wanted: the times are centred there and it does not
  // show. Here the times are set flush left in a column, and a rule that starts a space
  // early reads as an underline wider than its own number - measured at 5.5 to 5.75px of
  // painted rule past the first digit, against 0.25 to 2.25px for the ones without it,
  // which is only the side bearing the font itself leaves. Moving the space in front of
  // the sentinel keeps the gap between times and takes it out from under the rule.
  // Dropped, not moved out: the times are already joined by a "&nbsp;/&nbsp;" separator,
  // so an extra space in front of an underlined one only makes the gap before it wider
  // than the gap before a plain one - measured at 19.73px against 14.92px, which is
  // visible in a column of times. Any whitespace, matched rather than written out: the
  // character underlineTime puts there is a non-breaking space, not the plain one it
  // looks like in the source, and splitting on a literal " " matches nothing at all.
  const trimmed = weekEsc(str).replace(new RegExp(UL_START + '\\s+', 'g'), UL_START);
  const escaped = trimmed.split(UL_START).join('<u>').split(UL_END).join('</u>');
  return escaped.replace(/\n/g, '<br>');
}

function weekEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
