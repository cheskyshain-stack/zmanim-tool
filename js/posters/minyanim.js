// Which times on a poster are מנינים, and when they actually are.
//
// A poster prints a 12-hour clock with no meridiem, the same as the boards and for the same
// reason: a sheet is a whole day laid out in order, so a 7:30 among the מנחה times cannot be
// read as the morning. "What is on next" on the congregation's home page has no such column
// to read from, and it needs a real instant, so a poster hands its מנינים over already
// resolved: which day, how many minutes after midnight, and where.
//
// The list is built inside each poster's own builder, out of the same numbers the printed
// lines are made of, and never worked out again here. That is the rule upcoming.js already
// follows with the charts, for the same reason: the time on somebody's phone and the time on
// the sheet on the wall have to be one thing, not two things that agree most years.
//
// Not every line is a מנין. שקיעה, הדלקת נרות, ס"ז ק"ש, יזכור, תקיעת שופר, חצות and the
// דרשות are זמנים and announcements, and a card offering "next minyan: שקיעה" would be
// wrong in a way nobody would think to report. Which lines count is decided in each builder,
// beside the line itself, rather than by matching on names here.

/** Which half of the day a typed time belongs to. Said out loud at every call, because it
 *  is the one thing the printed text does not carry. */
export const MORNING = false;
export const AFTERNOON = true;

/** A day fraction as minutes after midnight, which is the frame upcoming.js works in.
 *  Rounded exactly the way formatTime rounds, so the minute a phone counts down to and the
 *  minute the sheet prints can never be different ones. */
export const fracMins = (t) => Math.round((((t % 1) + 1) % 1) * 1440);

/** "7:30" as minutes after midnight. The meridiem is not in the text and cannot be worked
 *  out from it, so the caller says which half of the day the line is in. */
export function clockMins(text, afternoon) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return ((hour % 12) + (afternoon ? 12 : 0)) * 60 + minute;
}

/** Where a time davens, off the marks the sheets already use: underlined is למטה, one star
 *  is בעזרת נשים, two is the hall. The same three the charts are read with, spelled the same
 *  way, so the card reads alike whichever it came from.
 *
 *  POSTER_PLACES rather than PLACES: upcoming.js has a list of its own under that name, and
 *  the offline build flattens every module into one scope where two of a name is fatal. */
const POSTER_PLACES = { u: 'למטה', '*': 'בעזר״נ', '**': 'באולם השמחות' };
export const placeOf = (t) => POSTER_PLACES[t?.mark || (t?.underlined ? 'u' : '')] || '';

/** A poster's מנינים as it builds them: one call a time, and the list at the end.
 *
 *  A collector rather than an array the builders push shapes into, so the shape is written
 *  once and a builder cannot leave a field off. Anything without a readable time is dropped
 *  rather than added as a gap. */
export function minyanList() {
  const out = [];
  return {
    out,
    /** A computed time: the day it is on, what it is called, the day fraction it was worked
     *  out as, and the printed time object it went into, which is where the room comes from. */
    at(serial, name, fraction, time) {
      out.push({ serial, name, mins: fracMins(fraction), place: placeOf(time) });
    },
    /** A run of times typed into one of the poster's own text tables, which carry no
     *  meridiem: one line's מנינים, in the order the sheet prints them.
     *
     *  A run only ever goes forwards, so any time reading as earlier than the one before it
     *  has half a day added. That is what turns the 12:00 at the end of a מעריב list running
     *  10:30, 11:00, 11:30 into midnight rather than noon, which is twelve hours out and on
     *  the wrong side of the day. The charts are read back the same way, for the same reason
     *  (see parseCell in upcoming.js). */
    list(serial, name, times, afternoon) {
      let previous = -1;
      for (const time of times) {
        let mins = clockMins(time?.text, afternoon);
        if (mins == null) continue;
        while (mins <= previous) mins += 12 * 60;
        previous = mins;
        out.push({ serial, name, mins, place: placeOf(time) });
      }
    },
  };
}
