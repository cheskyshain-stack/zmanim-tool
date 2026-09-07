// A זמן given on the two reckonings the boards use, and which order the two go in.
//
// ס"ז ק"ש and ט' שעות are each one זמן answered twice, on the גר"א's day and on the מגן
// אברהם's. The sheets used to print the pair as two times with the two names beside the
// label, "ס"ז ק"ש מ"א / גר"א   9:08 / 9:44", and that reads backwards. Measured on screen:
// the names are Hebrew and set right to left, so the leftmost word is גר"א; the times are
// digits and set left to right, so the leftmost time is the מ"א's. Anybody pairing them
// across the line reads each time under the wrong name.
//
// The wall chart never had this, and the reason is worth writing down because it is the
// whole of the bug. Its heading is stored "גר״א / מ״א", which displays with מ״א on the left,
// against times stored מ״א first: measured, מ״א paints at x=455 over 8:50 at x=459 and גר״א
// at 495 over 9:26 at 494. The posters wrote the same pair in the opposite order and so came
// out crossed.
//
// So the pair is not a label and a list any more. Each time carries the name of its own
// reckoning and is set under it, which cannot be read the wrong way round whichever
// direction anything else on the sheet runs in.
//
// And they are ordered by the clock rather than by which reckoning it is, so the earlier of
// the two is always on the left. Written the other way the two rows disagreed with each
// other: on ס"ז ק"ש the מ"א is the earlier and on ט' שעות it is the later, so a reader
// meeting both on one sheet had to work out for each row which side was which.

import * as Z from '../zmanim/zmanim.js';

/** The two reckonings, spelled the way the boards spell them. */
export const RECKONING_MGA = 'מ"א';
export const RECKONING_GRA = 'גר"א';

/** One זמן given both ways, earliest first, each answer knowing which reckoning it is.
 *
 *  Sorted on the day fractions rather than on the printed text, so it is the real order of
 *  the two and not a comparison of two strings that carry no meridiem. */
export function twoReckonings(mga, gra) {
  return [
    { at: mga, name: RECKONING_MGA },
    { at: gra, name: RECKONING_GRA },
  ].sort((a, b) => a.at - b.at);
}

/** Nine seasonal hours into the day, on each of the two reckonings: the גר"א day runs sunrise
 *  to sunset, the מ"א day עלות 72 to צאת 72.
 *
 *  Here rather than in either sheet that prints it. It is on ראש השנה, where a first day that
 *  is Shabbos prints it in place of the שופר times, and on סוכות, where every Shabbos of the
 *  festival carries it. Two copies of a זמן is two things to keep the same, and this file is
 *  already where a זמן answered on both reckonings lives. */
export function nineHours(date, settings) {
  const gra = Z.sunriseElev(date, settings);
  const graEnd = Z.sunsetElev(date, settings);
  const mga = Z.alos72(date, settings);
  const mgaEnd = Z.tzais72(date, settings);
  return {
    gra: gra + 9 * (graEnd - gra) / 12,
    mga: mga + 9 * (mgaEnd - mga) / 12,
  };
}
