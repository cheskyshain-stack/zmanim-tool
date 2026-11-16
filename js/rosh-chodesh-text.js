// Rosh Chodesh messages quote the shared handout rows, including the first two
// minyanim's netz-minus-25 floor. Room letters come from the same location marks.

import { JEWISH_MONTHS_EN, hebrewDateExtended } from './hebrew-calendar.js';
import { erevTimes, erevWhereMark } from './erev-text.js';

/** The wording, as the shul writes it. The times are not here: see roshChodeshShacharis. */
export const RC_TEXT = {
  title: 'ROSH CHODESH',
  label: 'Shacharis',
  /** Where the shul spells a month differently from the program's own table.
   *  אב is "Menachem Av" in every one of the sent messages, and חשון is "Mar Cheshvon". Held here
   *  rather than changed in JEWISH_MONTHS_EN, which the charts and the date lines read: those say
   *  Av and Cheshvan and should keep saying it. */
  spelling: { Av: 'Menachem Av', Cheshvan: 'Mar Cheshvon' },
};

/** Read times and rooms from the supplied chart/handout cells. Underlined is d,
 * one star is en, two is sh, and unmarked is m. An empty schedule has no message. */
export function roshChodeshShacharis(shacharisCell) {
  const times = Array.isArray(shacharisCell) ? shacharisCell : erevTimes(shacharisCell);
  if (!times.length) return '';
  return times.map((t) => t.text + erevWhereMark(t)).join(', ');
}

/** The English name of a Hebrew month, spelled the way the messages spell it. */
export function roshChodeshMonthName(month) {
  const plain = JEWISH_MONTHS_EN[month - 1] || '';
  return RC_TEXT.spelling[plain] || plain;
}

/** The next ראש חודש on or after a day, as the days it runs and the month it opens.
 *
 *  **תשרי is not one of them.** Its ראש חודש is ראש השנה, which has a message of its own and a
 *  sheet behind it, and a "ROSH CHODESH Tishrei" beside that would be the same day said twice.
 *
 *  Two days wherever the month before has thirty, which is what makes the thirtieth of it the
 *  first day of ראש חודש. Asked of the calendar rather than of a table of month lengths, since
 *  the calendar already knows and a table would be a second answer to the same question.
 *
 *  Walked forward a day at a time rather than reckoned. A ראש חודש is never more than a month
 *  off, the walk is at most a few dozen steps, and it cannot be subtly wrong the way arithmetic
 *  on which month it is can be.
 *
 *  @param from - the serial to look forward from.
 *  @param useGregorianBefore1582 - the setting hebrewDateExtended takes. */
export function nextRoshChodesh(from, useGregorianBefore1582 = false) {
  for (let s = from; s < from + 70; s += 1) {
    const at = hebrewDateExtended(s, useGregorianBefore1582);
    if (at.dayOfMonth !== 1) continue;
    if (at.month === 7) continue;
    const before = hebrewDateExtended(s - 1, useGregorianBefore1582);
    /* The walk starts at `from`, so where today is the first of the month and the month before
       had thirty days, the ראש חודש found is the one that began yesterday and is still running.
       That is the right answer: it is today's message, not next month's. */
    const first = before.dayOfMonth === 30 ? s - 1 : s;
    return { first, last: s, month: at.month, year: at.year };
  }
  return null;
}

/** The message.
 *
 *  @param rc - straight from nextRoshChodesh.
 *  @param shacharisCell - the shared Rosh Chodesh handout rows. */
export function roshChodeshText(rc, shacharisCell) {
  if (!rc) return '';
  const name = roshChodeshMonthName(rc.month);
  if (!name) return '';
  const times = roshChodeshShacharis(shacharisCell);
  if (!times) return '';
  return `${RC_TEXT.title} ${name} ${RC_TEXT.label} ${times}`;
}
