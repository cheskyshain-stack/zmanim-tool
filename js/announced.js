// Times the shul has announced differently from the board, for a day or two.
//
// It happens: the chart says one thing, the gabbai says another from the amud, and for those
// few days the site should say what was announced rather than what was computed. This is that
// list, and it is deliberately a small ugly one.
//
// What it is not:
//
//  - Not a calculation. Nothing here reaches the formulas, the rules, or a saved chart, so
//    next week and next year are exactly what they were: the entry swaps one printed time for
//    another on the way to the screen and that is all it does.
//  - Not the printed board. The wall chart is drawn from the chart's own row and is not read
//    through this, so a board that has already been hung is not contradicted by the page
//    quoting it.
//  - Not permanent. Every entry carries the days it is for, and a day outside them is not
//    touched. Once the last day is past the entry does nothing at all, so a forgotten one is
//    dead weight rather than a wrong time: delete it when you notice it.
//
// A real change to the schedule belongs in Settings or in a rule, not here. This is for the
// two days between "they announced something else" and "the board is right again".
import { excelSerial, dateFromSerial } from './zmanim/solar.js';

/** One entry a change.
 *
 *  `from` and `to` are the days it covers, inclusive, as plain dates. `column` is the
 *  Weekday chart's own column letter, B for מעריב and C for מנחה, so a swap cannot reach a
 *  time in another row that happens to read the same. `was` and `now` are the times as they
 *  are printed. `why` is for whoever finds this later.
 *
 *  Nothing is here most of the time, and that is the normal state of this file. */
export const ANNOUNCED = [
  {
    from: '2026-09-09',
    to: '2026-09-10',
    column: 'B',
    was: '8:15',
    now: '8:10',
    why: 'The first מעריב was announced at 8:10 for these two days. The board and the '
      + 'formula both stay at 8:15, which is where it goes back to on the 11th.',
  },
];

/** A plain date to the serial the rest of the program counts in. */
function serialOf(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return y && m && d ? excelSerial(new Date(y, m - 1, d)) : null;
}

/** Today, as the reader's own device has it. The whole point of these entries is that they
 *  are about the next day or two, so they are read against the clock in the reader's hand. */
const today = () => excelSerial(new Date());

/** The entries that are live at all: an entry is only ever live during its own days, so one
 *  left in this file after its day has passed changes nothing. */
function live() {
  const now = today();
  return ANNOUNCED.filter((a) => {
    const from = serialOf(a.from);
    const to = serialOf(a.to);
    return from != null && to != null && now >= from && now <= to;
  });
}

/** One cell as it should be read on one day.
 *
 *  Given the Weekday chart's cell text and the day it is being read for, hands back the same
 *  text with any announced time swapped in. The time is matched whole, so 8:15 does not touch
 *  an 18:15 or an 8:155, and only the first one on the line is swapped: these lines are a run
 *  of מנינים in order and the announcement is about one of them.
 *
 *  The text goes back through this before it is parsed rather than after, so the minutes
 *  behind it move with it: "what is on next" counts down to the time it is showing rather
 *  than to the one on the board. */
export function announcedCell(text, columnKey, serial) {
  let out = String(text ?? '');
  for (const a of live()) {
    if (a.column !== columnKey) continue;
    const from = serialOf(a.from);
    const to = serialOf(a.to);
    if (serial < from || serial > to) continue;
    // The time as a pattern, with anything a regex would read as punctuation taken
    // literally: these are times, but the escape is what makes that a fact rather than a
    // hope about what somebody types into this file later.
    const wanted = String(a.was).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<!\\d)${wanted}(?!\\d)`), a.now);
  }
  return out;
}

/** And the same cell on the week's own block, which is one line for the whole week rather
 *  than a line a day.
 *
 *  Swapped where the week has a day in the entry's range. The block cannot say "8:10 on two
 *  of these days and 8:15 on the others" without becoming a table, and for the day or two an
 *  entry lives the thing to show the reader is what is being announced. It is back to the
 *  board's own time the morning after the entry runs out.
 *
 *  `anchor` is the week's Shabbos, the way every week is keyed here; the days the Weekday
 *  chart speaks for are the Sunday through Thursday before it, which is offset 6 to offset 2
 *  back from the Shabbos. The same walk posters/day.js makes over a week. */
export function announcedWeekCell(text, columnKey, anchor) {
  const sunday = anchor - 6;
  for (let day = sunday; day <= sunday + 4; day += 1) {
    const swapped = announcedCell(text, columnKey, day);
    if (swapped !== String(text ?? '')) return swapped;
  }
  return String(text ?? '');
}

/** Whether anything is live, so a screen can say why it is not quoting the board. Nothing
 *  reads it yet; it is here because the first question anyone asks about a swapped time is
 *  "is that right?" and the answer should be somewhere. */
export function announcedNow() {
  return live().map((a) => ({ ...a, on: dateFromSerial(serialOf(a.from)) }));
}
