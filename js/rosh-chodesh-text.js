// The ROSH CHODESH message, as a block of text somebody can paste into a chat.
//
// The shul sends one before every ראש חודש, seventeen of them in the history this was built
// from, and it is one line:
//
//   ROSH CHODESH Nissan Shacharis 6:40m, 7:00en, 7:15d, 7:35sh, 8:00m, 8:20en, 8:40d
//
// **Every time in it comes off the wall chart**, settings.weekdayShacharisSpecial, which is the
// second schedule the chart prints on a ר"ח, a בה"ב and a תענית. Nothing here computes a time and
// nothing here keeps its own copy of one. That is the rule the whole messages page runs on, and
// this file broke it twice before the shul caught both:
//
//   It carried its own copy of the schedule, and the copy had a 6:50 בעזרת נשים the chart has not
//   got, so the message announced a מנין the board does not show. A second copy of a schedule
//   disagrees with the board the moment anybody edits either one, and the board is what people
//   daven from.
//
//   It carried the "(T"T 7:25)" that every one of the seventeen sent messages has. That one is on
//   no chart at all, so nothing here knows how it is arrived at or what would move it, and a line
//   that is right until the year it quietly is not is worse than a line that was never there.
//
// What this does work out is the calendar, not the clock: which month it is, and the day ראש חודש
// starts on, which is the thirtieth of the month before wherever that month has one. Those are
// the parts a person gets wrong, and they are not times.
//
// One thing the seventeen show that is deliberately not built. Three of them, in חשון, טבת and
// שבט, open "6:50m&ns, [Netz 7:15]" instead. Both of those numbers are real: the bracket is
// sunrise and the מנין is sunrise less twenty five minutes, which is why it reads 6:50 one year
// and 6:51 the next. It looks like a winter rule and it is not one, because כסלו, in the middle
// of that stretch, uses the ordinary form. Three examples cannot say which months take it, and in
// any case neither number is on a chart, so neither is built.

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

/** The מנינים, read off the wall chart's own ר"ח schedule.
 *
 *  **`settings.weekdayShacharisSpecial`, which is the cell the chart prints on a ר"ח, a בה"ב and a
 *  תענית.** This carried its own copy of that list for a while and it should not have. The shul
 *  caught it on one time: the copy had a 6:50 בעזרת נשים that the chart has not got, so the message
 *  was announcing a מנין the board does not show. A second copy of a schedule is a schedule that
 *  will disagree with the board the first time somebody edits one of them, and the board is the one
 *  people daven from.
 *
 *  So the letters come off the chart's own marks rather than being typed beside the times:
 *  underlined is d, one star is en, two is sh, unmarked is m (`erevWhereMark`). Edit the schedule
 *  in Settings and this message follows it, which is the whole point.
 *
 *  Nothing at all where the chart has no second schedule to print. A message with no times in it is
 *  not one to send, so the caller drops the card rather than sending the heading on its own. */
export function roshChodeshShacharis(shacharisCell) {
  const times = erevTimes(shacharisCell);
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
 *  @param shacharisCell - the chart's own ר"ח schedule, settings.weekdayShacharisSpecial. */
export function roshChodeshText(rc, shacharisCell) {
  if (!rc) return '';
  const name = roshChodeshMonthName(rc.month);
  if (!name) return '';
  const times = roshChodeshShacharis(shacharisCell);
  if (!times) return '';
  return `${RC_TEXT.title} ${name} ${RC_TEXT.label} ${times}`;
}
