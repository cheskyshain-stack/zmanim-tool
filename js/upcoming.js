// What is on next: the מנין the congregation page leads with, and the next זמן beside it.
//
// Everything here is read back out of the charts rather than worked out again. The times
// on the boards come from the workbook's ported formulas, they are then reshaped by the
// season's rules and by anything typed over a cell by hand, and a home page quoting its
// own numbers would sooner or later disagree with the page it links to. So this builds
// the very same row the week's card is built from, through the same rules and the same
// overrides, and reads the times off it.
//
// Reading them off means parsing "h:mm" back out of a printed cell, which is only safe
// because it is this app's own output in a format it controls. Every time recovered is
// formatted again and checked against the text it came from, and anything that does not
// come back identical is dropped rather than guessed at. See parseCell.
//
// הדלקת נרות is read the same way and for the same reason: its column is שקיעה floored to
// the minute less the figure set in Settings, and it can be reshaped by a rule or typed
// over, so computing it again here would quietly disagree with the board on the weeks
// where any of that made a difference.
import { dateFromSerial, timezoneOffset, shulNow } from './zmanim/solar.js';
import { tzais72 } from './zmanim/zmanim.js';
import { formatTime, UL_START, UL_END } from './format.js';
import { DAY_NAMES } from './util.js';
import { KAYITZ_COLUMNS } from './sheets/kayitz.js';
import { WEEKDAY_COLUMNS, buildWeekdayRow } from './sheets/weekday.js';
import { excelWeekday, hasRoshChodesh, hasBehab, hasTaanis } from './hebrew-calendar.js';
import { mergeRow } from './overrides.js';
import { rowFor, weekIndex, weekdayChartFor } from './sheets/rows.js';

/* Which cells on a שבת chart hold מנינים, which day each belongs to, and how to read it.
 *
 *  Not every column is a מנין. ס"ז קר"ש and הדלקת נרות are זמנים and are left out here;
 *  they come back below through the זמנים list, computed rather than parsed.
 *
 *  `firstLine` is for the three פלג מנחה columns, which print the מנין on the first line
 *  and the פלג it is set against on the second. The מנין is the one to offer; the פלג is
 *  a זמן and would otherwise be read as a second מנין a quarter of an hour later.
 *
 *  The day matters because a שבת chart row covers two days: its Friday columns and its
 *  Shabbos ones, anchored on the same Saturday. */
const FRIDAY = 6;
const SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Saturday
const SHABBOS_CELLS = {
  B: { day: SHABBOS },
  C: { day: SHABBOS },
  E: { day: SHABBOS, morning: true },
  F: { day: FRIDAY },
  G: { day: FRIDAY },
  I: { day: FRIDAY, firstLine: true },
  J: { day: FRIDAY, firstLine: true },
  K: { day: FRIDAY, firstLine: true },
  L: { day: FRIDAY },
};
/* חורף has no פלג columns, and its column I is the ערב שבת מנחה that קיץ calls L. Keyed by
   season so a column letter can mean different things on the two charts, which I does. */
const SEASON_CELLS = {
  kayitz: SHABBOS_CELLS,
  choref: { B: SHABBOS_CELLS.B, C: SHABBOS_CELLS.C, E: SHABBOS_CELLS.E, F: SHABBOS_CELLS.F, G: SHABBOS_CELLS.G, I: SHABBOS_CELLS.L },
};

/** A heading line that is only a room in brackets: "(למטה)", "(בעזר"נ)". Two of the קיץ
 *  columns carry one, and it is the room rather than the name of the מנין. */
const ROOM_LINE = /^\(.+\)$/;

/** What to call a מנין, taken from the column's own printed heading so the home page and
 *  the board cannot drift apart. The heading's later lines are kept where they say which
 *  מנין it is ("מנחה ערב שבת"), and dropped where they say something else: a פלג line names
 *  the זמן the מנין is set against, and a bracketed line names the room, which the card
 *  shows in its own smaller type underneath (roomFromHeader). */
function nameFromHeader(header) {
  return String(header)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('פלג') && !ROOM_LINE.test(line))
    .join(' ');
}

/** The room out of the heading, unbracketed, or nothing. */
function roomFromHeader(header) {
  const line = String(header).split('\n').map((l) => l.trim()).find((l) => ROOM_LINE.test(l));
  return line ? line.slice(1, -1).trim() : '';
}

/* Where a מנין davens, as the printed board says it: a plain time is the main בית מדרש, an
   underlined one is למטה, one star is בעזר״נ and two is באולם השמחות. */
const PLACES = { u: 'למטה', '*': 'בעזר״נ', '**': 'באולם השמחות' };

/** Every time in one printed cell, in minutes after midnight, with where it davens.
 *
 *  Two things make this safe to do by hand rather than with a real parser. The cell is
 *  this app's own output, so a time is always "h:mm" on a 12-hour clock with no meridiem.
 *  And every time recovered is formatted again and compared with the text it was read
 *  from: if the two do not match exactly the entry is thrown away, so a cell shaped in
 *  some way not thought of here goes missing rather than showing a wrong time.
 *
 *  The meridiem is not in the text and has to be worked out. Only the שחרית columns are
 *  in the morning; everything else on these boards runs from מנחה גדולה to מעריב. Within
 *  a cell the times only ever go forwards, so any time that reads as earlier than the one
 *  before it has half a day added, which is what turns the 12:00 at the end of a מעריב
 *  list running 10:30, 11:00, 11:30 into midnight rather than noon. */
function parseCell(cell, { morning = false, firstLine = false } = {}) {
  if (cell == null) return [];
  let text = String(cell);
  if (firstLine) text = text.split('\n')[0];
  const out = [];
  let previous = -1;
  // The underline sentinels are plain characters at this stage (see format.js), so the
  // mark travels with its own time and cannot be attached to the wrong one. Built from
  // the exported constants rather than written out, so the two cannot fall out of step.
  const token = new RegExp(`(${UL_START}?)\\s*(\\d{1,2}):(\\d{2})(\\*{0,2})(${UL_END}?)`, 'g');
  for (const m of text.matchAll(token)) {
    const [, ulStart, hh, mm, stars, ulEnd] = m;
    const hour12 = Number(hh);
    const minute = Number(mm);
    if (hour12 < 1 || hour12 > 12 || minute > 59) continue;
    let mins = (morning ? hour12 % 12 : (hour12 % 12) + 12) * 60 + minute;
    while (mins <= previous) mins += 12 * 60;
    // The round trip. Anything that does not format back to what it was read from is not
    // a time this code understands, and is left out.
    if (formatTime((mins % 1440) / 1440) !== `${hour12}:${mm}`) continue;
    previous = mins;
    const underlined = ulStart === UL_START || ulEnd === UL_END;
    out.push({ mins, place: PLACES[stars || (underlined ? 'u' : '')] || '' });
  }
  return out;
}

/** The שחרית schedule for one weekday, out of Settings.
 *
 *  It is rich text rather than a computed column, and on a ר"ח, בה"ב or תענית the shul
 *  runs a second, earlier schedule, which the card prints as its own line. Whichever one
 *  applies to this particular day is the one to read. */
function weekdayShacharis(serial, state, settings) {
  const special = [hasRoshChodesh(serial, settings), hasBehab(serial, settings), hasTaanis(serial, settings)]
    .some(Boolean);
  const text = (special && state.settings.weekdayShacharisSpecial) || state.settings.weekdayShacharis || '';
  // Written in Settings as HTML, where an underline is a real <u> rather than the
  // sentinel a computed cell carries, so it is turned back into the sentinel form
  // parseCell reads before the times are picked out of it.
  const marked = String(text)
    .replace(/<u\b[^>]*>/gi, UL_START)
    .replace(/<\/u>/gi, UL_END)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return parseCell(marked, { morning: true });
}

/** The published week a calendar day belongs to, and the serial that week is filed under.
 *
 *  Found by the Sunday the two have in common, not by the Shabbos. A row is normally
 *  anchored on its Shabbos, but two rows on a Weekday chart are anchored on a stand-in
 *  date instead: the season's trailing gap before Yom Tov, and a Chol Hamoed row (see
 *  weeks.js). Looking for "the Saturday of this day's week" walked straight past those:
 *  measured on the published charts, the row filed under serial 46499 is a Thursday, and
 *  every day of that week came back with no מנינים at all even though its Weekday chart
 *  has them.
 *
 *  A Shabbos-anchored row wins where both exist, since only it carries Friday and Shabbos
 *  columns. */
function entryForDay(serial, state) {
  const sundayOf = (s) => s - (excelWeekday(s) - 1);
  const sunday = sundayOf(serial);
  let standIn = null;
  for (const [anchor, entry] of weekIndex(state)) {
    if (sundayOf(anchor) !== sunday) continue;
    if (excelWeekday(anchor) === SHABBOS) return { anchor, entry };
    standIn = standIn || { anchor, entry };
  }
  return standIn;
}

/** Every מנין on one calendar day, earliest first.
 *
 *  A day is served by whichever chart covers it: Sunday through Thursday by the Weekday
 *  chart, Friday and Shabbos by the שבת chart for that week. */
export function minyanimForDay(serial, state, settings) {
  const dow = excelWeekday(serial);
  const found = entryForDay(serial, state);
  if (!found) return [];
  const { anchor, entry } = found;
  const out = [];

  if (dow === FRIDAY || dow === SHABBOS) {
    // Friday and Shabbos, off the שבת chart. A stand-in row is not anchored on a Shabbos
    // and has no Friday or Shabbos columns to read, and a week whose Shabbos is Yom Tov
    // has no row on the שבת chart at all.
    if (!entry.sheet || excelWeekday(anchor) !== SHABBOS) return [];
    const { row, columns } = rowFor(entry.week, entry.sheet, state, settings);
    // Which letters mean what is decided by the columns rowFor handed back, not by the
    // sheet's own season: a חורף sheet is built as קיץ inside the spring DST window, and
    // there its column I is a פלג מנחה rather than the ערב שבת one.
    const cells = columns === KAYITZ_COLUMNS ? SEASON_CELLS.kayitz : SEASON_CELLS.choref;
    for (const column of columns) {
      const cell = cells[column.key];
      if (!cell || cell.day !== dow) continue;
      const name = nameFromHeader(column.header);
      // The room comes off the heading where the heading gives one, and off the time's own
      // underline otherwise. The פלג columns do both, naming the room in their heading and
      // underlining the time as well, which is the same thing said twice: taking the
      // heading's first and falling back to the time's says it once.
      const room = roomFromHeader(column.header);
      for (const t of parseCell(row[column.key], cell)) {
        out.push({ ...t, name, place: room || t.place });
      }
    }
    // Friday morning is the weekday שחרית, and it has to be added here because neither
    // chart carries it. The Weekday chart runs Sunday through Thursday, since that is
    // where its מנחה and מעריב differ from an Erev Shabbos, and the שבת chart's שחרית
    // column is Shabbos morning. Between the two, Friday morning fell down the gap: after
    // Thursday's last מעריב the card jumped straight to "מנחה ערב שבת 1:35, tomorrow",
    // with the whole of Friday שחרית missing.
    //
    // Adding it is not an assumption about the schedule. שחרית is one fixed list out of
    // Settings, the same every weekday, which is exactly why the chart prints it once as
    // a merged cell rather than working it out day by day.
    if (dow === FRIDAY) {
      const name = nameFromHeader(WEEKDAY_COLUMNS.find((c) => c.key === 'E').header);
      for (const t of weekdayShacharis(serial, state, settings)) out.push({ ...t, name });
    }
  } else {
    // Sunday through Thursday, off the Weekday chart. Its מנחה and מעריב are computed and
    // may be typed over; שחרית is a Settings schedule and is not part of that row.
    const chart = weekdayChartFor(entry.sheet, anchor, state);
    const week = chart?.weeks.find((w) => w.serial === anchor);
    if (!chart || !week) return [];
    const { row } = mergeRow(buildWeekdayRow(week, settings), chart, anchor);
    for (const column of WEEKDAY_COLUMNS) {
      if (column.key === 'E') continue; // שחרית, handled below
      const name = nameFromHeader(column.header);
      for (const t of parseCell(row[column.key])) out.push({ ...t, name });
    }
    const shacharisName = nameFromHeader(WEEKDAY_COLUMNS.find((c) => c.key === 'E').header);
    for (const t of weekdayShacharis(serial, state, settings)) out.push({ ...t, name: shacharisName });
  }
  out.sort((a, b) => a.mins - b.mins);
  return out;
}

/** הדלקת נרות on one calendar day, or nothing if that day is not an Erev Shabbos with a
 *  chart row behind it.
 *
 *  Read off the chart's own הדלקת נרות column rather than worked out here. The column is
 *  שקיעה floored to the minute, less the number of minutes set in Settings, and it can be
 *  reshaped by a rule or typed over like any other cell. Computing it again would have got
 *  the same answer most weeks and quietly disagreed with the printed board on the ones
 *  where the flooring or an override made a minute of difference. */
export function candleLightingForDay(serial, state, settings) {
  if (excelWeekday(serial) !== FRIDAY) return null;
  const found = entryForDay(serial, state);
  if (!found || !found.entry.sheet || excelWeekday(found.anchor) !== SHABBOS) return null;
  const { row, columns } = rowFor(found.entry.week, found.entry.sheet, state, settings);
  // H on both charts. The cell carries שקיעה on a second line, so only the first is read.
  const column = columns.find((c) => c.key === 'H');
  if (!column) return null;
  const [first] = parseCell(row.H, { firstLine: true });
  return first ? { name: 'הדלקת נרות', mins: first.mins, place: '' } : null;
}


/** How long a מנין stays on the card after its own time has come. Someone glancing at the
 *  page a minute after שחרית started is being told about the one that is running, not sent
 *  on to מנחה: the time has arrived, it has not finished, and the answer to "what is on
 *  now" is still this one. Rolling straight on at the stroke of the minute also made the
 *  card hardest to read exactly when it was most wanted, on the way in the door.
 *
 *  Five minutes, and it is the start that is being counted from, not the end, because a
 *  מנין's length is not something the boards know. */
const MINYAN_GRACE = 5;

/** The first entry from `forDay` at or after now (less the grace above), rolling on to
 *  tomorrow once today's are done, and stopping at the first day there is no schedule for.
 *
 *  Rolling on is the ordinary case: at eleven at night the answer to "what is next" is the
 *  morning, and saying so is right. Stopping is the case this cannot get wrong. Three weeks
 *  a year have no row on the שבת chart, the Erev Shabbos and Shabbos of a Yom Tov, and the
 *  published charts run out at the end of a season. Searching past those turned up a real
 *  time from a real day and put it on the card as though it were next, so on an Erev Yom
 *  Tov the page offered a מנין several days off with nothing to say it was not tomorrow.
 *  A day nothing is known about ends the search, and the card is left off the page
 *  altogether rather than answering a question it cannot answer.
 *
 *  Eight days is the far limit, which nothing should ever reach now that an empty day stops
 *  it, and is here so a bad state cannot spin. */
function nextFrom(forDay, now, settings, days = 8) {
  const { serial, mins } = shulNow(now, settings);
  for (let offset = 0; offset < days; offset++) {
    const day = serial + offset;
    const list = forDay(day);
    if (!list.length) return null; // no schedule for this day: say nothing at all
    for (const item of list) {
      if (offset === 0 && item.mins < mins - MINYAN_GRACE) continue;
      return { ...item, serial: day, daysOff: offset, in: item.mins - mins + offset * 1440 };
    }
  }
  return null;
}

/** When a week stops being worth looking at: five minutes past the last מנין on it.
 *
 *  A week's card is anchored on its Shabbos and runs from the Sunday before, so the last
 *  time on it is the last מעריב of מוצאי שבת. Once that has been and gone there is nothing
 *  left on the card still to happen, and what somebody opening the page wants is the week
 *  that has not started yet.
 *
 *  Five minutes for the same reason the "what is on next" card holds a מנין for five
 *  minutes after it starts: the time being read off is when a מנין begins, not when it
 *  ends, and the boards do not know how long one runs.
 *
 *  A Shabbos that is Yom Tov has no row on the chart and so no times to read. There is
 *  nothing to count from, so the answer falls back to 72 minutes after שקיעה, which is when
 *  that Shabbos is out whether or not anything was printed for it.
 *
 *  Returned as minutes after midnight on the Shabbos's own day, the frame shulNow answers
 *  in, so the two can be compared without either becoming a real instant. */
export function weekEndsMins(serial, state, settings) {
  const list = minyanimForDay(serial, state, settings);
  if (!list.length) return tzais72(dateFromSerial(serial), settings) * 1440;
  return Math.max(...list.map((item) => item.mins)) + MINYAN_GRACE;
}

/** The next מנין, and the next זמן. Both may be null: before anything is published, or
 *  past the end of what is. */
export function nextMinyan(now, state, settings) {
  return nextFrom((day) => minyanimForDay(day, state, settings), now, settings);
}
/** הדלקת נרות for today, and only when today is an Erev Shabbos.
 *
 *  Not "the next one": it is the day's own number and stays on the card all Friday, after
 *  the time itself has gone by as much as before it. Rolling on to next week's the moment
 *  candles are lit would replace the one figure anybody is still checking that evening
 *  with one that is a week away. */
export function todaysCandleLighting(now, state, settings) {
  const { serial, mins } = shulNow(now, settings);
  const one = candleLightingForDay(serial, state, settings);
  return one ? { ...one, serial, daysOff: 0, in: one.mins - mins } : null;
}

/** "1:50" for a time held as minutes after midnight, on the same 12-hour clock the boards
 *  use. Minutes past a day roll round, which is how a מעריב at midnight prints as 12:00. */
export function clock(mins) {
  return formatTime((((mins % 1440) + 1440) % 1440) / 1440);
}

/** "AM" or "PM". The printed boards never say which, and never need to: they are a whole
 *  day laid out in order, so a 7:30 among the מנחה times cannot be read as the morning.
 *  One time on its own has no such column to sit in, and 8:45 with nothing beside it is a
 *  genuine question. */
export function meridiem(mins) {
  return (((mins % 1440) + 1440) % 1440) < 720 ? 'AM' : 'PM';
}

/** How far off, in the coarsest words that are still true: "in 25 minutes", "in 2 hours",
 *  "tomorrow", "Monday". A countdown to the second would be stale the moment it was drawn,
 *  and is not what anyone is asking the page.
 *
 *  `item.in` is not a whole number of minutes. shulNow reads the clock to the millisecond,
 *  which is what the search wants so that a מנין starting this very minute is not skipped,
 *  and every one of these branches has to round it before saying it out loud. It did not,
 *  and the card read "in 1.1569500006735325 minutes".
 *
 *  Minutes round up. Anything still to come is at least a minute away until it has
 *  actually arrived, and rounding down would count the last thirty seconds as "in 0
 *  minutes". Hours round to the nearest, where being half an hour out either way is the
 *  whole point of saying "in 3 hours" rather than a number of minutes. */
export function howFar(item) {
  if (!item) return '';
  // Started, but only just: a מנין held on the card for its grace, or הדלקת נרות in the
  // few minutes after. "now" is true of both, and is what the line should say while the
  // time it names is the one happening.
  if (item.in < 0 && item.in >= -MINYAN_GRACE) return 'now';
  // Well and truly gone by. Only הדלקת נרות reaches here, since it is the day's own time
  // rather than the next one, and "in -40 minutes" or "now" would both be untrue of it.
  if (item.in < 0) return '';
  const minutes = Math.ceil(item.in);
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (item.daysOff === 0) {
    const hours = Math.round(item.in / 60);
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (item.daysOff === 1) return 'tomorrow';
  return DAY_NAMES[excelWeekday(item.serial) - 1];
}
