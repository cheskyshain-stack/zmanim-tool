// The מנין a יום טוב afternoon opens with, and the one rule that decides whether it is 1:15.
//
// Every one of these sheets opens its afternoon at 1:15, and 1:15 is not always late enough.
// These days are all on daylight saving time, when חצות is an hour later than it is for most
// of the year, and מנחה גדולה sits between about 1:11 and 1:23 depending where in September or
// October the day falls. Measured across תשפ"ד to תשצ"ה, the 1:15 lands before it in eight
// years out of twelve, by as much as eight minutes.
//
// So where it does, the מנין moves to 1:20 rather than to מנחה גדולה itself. That is what the
// shul asked for and it is the right answer for a printed sheet: 1:16, 1:17 and 1:18 are
// three different times for the same thing in three different years, and nobody is being
// called to daven at 1:17. One round time that clears מנחה גדולה is what people can hold in
// their heads, and it is still a full quarter of an hour in front of the 1:35 behind it.
//
// A year where even 1:20 is too early has no opening מנין at all: the list starts at 1:35.
// Two מנינים a few minutes apart is not a choice anybody uses, which is the same ground the
// weekday chart drops a zman on when a move walks it up against its neighbour.
//
// Shared by the סוכות sheet and the schedule that runs from after יו"כ to סוכות, because the
// shul asked for the same rule on both and one rule in one place is the only way that holds.

const EM_MIN = 1 / 1440;
/** A day fraction snapped to the minute it prints as.
 *
 *  Both the move and the quarter of an hour are measured on the printed minute rather than on
 *  the raw זמן, and that is not a nicety. מנחה גדולה is a fraction of a second as well as a
 *  minute: in תשפ"ז it falls at 1:20 and 24 seconds, which prints as 1:20 and is a clean
 *  fifteen minutes in front of the 1:35, while the unrounded number is 14 minutes 36 and was
 *  dropping the מנין the shul asked to keep. Rounded to the same minute formatTime would show,
 *  the arithmetic on the paper and the arithmetic here are one thing. */
const emPrinted = (t) => Math.round(t * 1440) / 1440;

/** The two times an afternoon is allowed to open at, earliest first. */
const EM_FIRST = (13 * 60 + 15) * EM_MIN;
const EM_SECOND = (13 * 60 + 20) * EM_MIN;

/** How much room the opening מנין has to leave the one behind it. */
const EM_GAP = 15 * EM_MIN;

/** The מנין an afternoon opens with, or null where there is no room for one.
 *
 *  `minchaGedola` is the latest מנחה גדולה of every day the printed list has to hold for, since
 *  one list is hung for all of them. `next` is the מנין behind it, which on every sheet so far
 *  is either the 1:35 or the 2:00. */
export function openingMincha(minchaGedola, next) {
  const gedola = emPrinted(minchaGedola);
  if (EM_FIRST >= gedola - 1e-9) return EM_FIRST;
  if (EM_SECOND >= gedola - 1e-9 && next - EM_SECOND >= EM_GAP - 1e-9) return EM_SECOND;
  return null;
}
