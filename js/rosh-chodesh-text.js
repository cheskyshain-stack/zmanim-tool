// The ROSH CHODESH message, as a block of text somebody can paste into a chat.
//
// The shul sends one before every ראש חודש, seventeen of them in the history this was built
// from, and it is one line:
//
//   ROSH CHODESH Nissan Shacharis 6:40m, 6:50ns, 7:00en, 7:15d, (T"T 7:25), 7:35sh, 8:00m, 8:20en, 8:40d
//
// **Nothing in it is a זמן.** Every time is an announced מנין, the same list month after month,
// and the only thing that changes is which month it is. So this is the one message on the page
// that is not read off a sheet, because there is no sheet with these times on it and nothing for
// it to disagree with. What it does read off the calendar is the part that can be got wrong: the
// month, and the day ראש חודש starts on, which is the thirtieth of the month before wherever that
// month has one.
//
// The list itself is a constant here rather than a setting, the same way RH_TEXT.slichos and
// PS_TEXT.erevMincha4 are constants in their posters. When the shul changes a מנין, this line
// changes with it, and the box on the messages page can be typed into in the meanwhile.
//
// Two things the seventeen show that this deliberately does not try to do:
//
//   The list is not quite fixed. 6:50ns is missing from four of them, 8:10ns is on three, one
//   carries a 9:00 T"T and one an instruction about which door to use. Those are the shul adding
//   and dropping a מנין, not a rule, so the commonest form is what is written and the rest is a
//   sentence somebody types into the box.
//
//   Three of the seventeen, in חשון, טבת and שבט, open differently: "6:50m&ns, [Netz 7:15]"
//   rather than "6:40m, 6:50ns". Both numbers there are real: the נץ in brackets is sunrise, and
//   the מנין in front of it is sunrise less twenty five minutes, which is why it reads 6:50 in one
//   year and 6:51 in another. It looks like a winter arrangement and it is not one, because כסלו,
//   in the middle of that stretch, uses the ordinary form. Three examples cannot say which months
//   take it, so none of them do until the shul says.

import { JEWISH_MONTHS_EN, hebrewDateExtended } from './hebrew-calendar.js';

/** The wording, as the shul writes it. */
export const RC_TEXT = {
  title: 'ROSH CHODESH',
  label: 'Shacharis',
  /** The מנינים, in the form sixteen of the seventeen sent messages share. */
  shacharis: '6:40m, 6:50ns, 7:00en, 7:15d, (T"T 7:25), 7:35sh, 8:00m, 8:20en, 8:40d',
  /** Where the shul spells a month differently from the program's own table.
   *  אב is "Menachem Av" in every one of the sent messages, and חשון is "Mar Cheshvon". Held here
   *  rather than changed in JEWISH_MONTHS_EN, which the charts and the date lines read: those say
   *  Av and Cheshvan and should keep saying it. */
  spelling: { Av: 'Menachem Av', Cheshvan: 'Mar Cheshvon' },
};

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
 *  @param rc - straight from nextRoshChodesh. */
export function roshChodeshText(rc) {
  if (!rc) return '';
  const name = roshChodeshMonthName(rc.month);
  if (!name) return '';
  return `${RC_TEXT.title} ${name} ${RC_TEXT.label} ${RC_TEXT.shacharis}`;
}
