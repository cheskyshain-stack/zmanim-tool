// A time that knows how it was made.
//
// Every time on a chart is some named zman, moved by so many minutes, rounded one way or the
// other, and sometimes chosen against another candidate or printed only on certain weeks.
// The arithmetic for all of that already lives in the column builders. What did not exist is
// any record of what the arithmetic *meant*, so the calculations page had to say it a second
// time, in prose, by hand.
//
// **That is the shape this project keeps getting hurt by.** A fact written down twice is a
// fact that can disagree with itself: the published file went on printing a schedule the
// admin had already fixed, and two retired rules went on firing on the congregation's board
// for months. The standing lesson is to read a thing off the one place that owns it.
//
// So a traced time computes and records in the same call. `.minus(15)` both subtracts the
// fifteen minutes and writes down that it did. The record cannot drift from the number
// because there is only one of them:
//
//     zman('שקיעה', Z.sunsetElev(d, s)).plus(50).floor().underline()
//
// reads as the formula, prints exactly what the old expression printed, and hands the
// calculations page the steps to draw.
//
// Values are Excel-style day fractions throughout, the same as everywhere else here, and the
// rounding and formatting are format.js's own rather than a second implementation of them.
//
// Every object is frozen and each link returns a new one, so a candidate can be measured
// against another (earlierOf, laterOf) without either being changed by the asking.

import { ceilToMinute, floorToMinute, roundToMinute, formatTime, underlineTime } from '../format.js';

/* Named for this file alone: zmanim.js already has a top-level MIN, and build-offline.py
   flattens every module into one scope where two of a name is a hard error. It caught this. */
const TRACE_MIN = 1 / 1440;

/** One traced time. Not constructed directly: see zman, fixedTime and clockTime. */
function make(value, steps, flags) {
  return Object.freeze({
    value,
    steps: Object.freeze(steps),
    flags: Object.freeze(flags),

    /** The printed string, underline sentinels and marks included, which is exactly what
     *  the builders used to produce by hand. */
    text() {
      const base = formatTime(value) + (flags.mark || '');
      return flags.underlined ? underlineTime(base) : base;
    },

    /** The same without the underline sentinels or the mark, for comparing against a cell. */
    plain() {
      return formatTime(value);
    },

    plus(minutes, because) {
      return make(value + minutes * TRACE_MIN, [...steps, { kind: 'offset', minutes, because }], flags);
    },
    minus(minutes, because) {
      return make(value - minutes * TRACE_MIN, [...steps, { kind: 'offset', minutes: -minutes, because }], flags);
    },

    /* Three roundings rather than one, because the workbook uses all three and which one it
       uses is part of the answer. The שבת afternoon מנחה rounds up where everything around it
       rounds down, and that is exactly the sort of thing a reader comes to this page to find. */
    ceil(because) {
      return make(ceilToMinute(value), [...steps, { kind: 'round', way: 'up', because }], flags);
    },
    floor(because) {
      return make(floorToMinute(value), [...steps, { kind: 'round', way: 'down', because }], flags);
    },
    round(because) {
      return make(roundToMinute(value), [...steps, { kind: 'round', way: 'nearest', because }], flags);
    },

    /** Underlined on the board means the מנין is downstairs, in the בית מדרש למטה. */
    underline() {
      return make(value, [...steps, { kind: 'underline' }], { ...flags, underlined: true });
    },

    /** A run of stars after a time: one is בעזרת נשים, two is the שטיבל. */
    mark(chars) {
      return make(value, [...steps, { kind: 'mark', chars }], { ...flags, mark: chars });
    },

    /* The two that pick between candidates. Both record what they were weighed against and
       which one won, since "the earlier of שקיעה less 45 and 7:00" is a rule a reader cannot
       reconstruct from the winning number alone. */
    earlierOf(other, because) {
      const won = other.value < value ? other : this;
      return make(won.value, [...steps, {
        kind: 'pick', how: 'earlier', because,
        against: other.describe(), took: won === other ? 'other' : 'this',
      }], flags);
    },
    laterOf(other, because) {
      const won = other.value > value ? other : this;
      return make(won.value, [...steps, {
        kind: 'pick', how: 'later', because,
        against: other.describe(), took: won === other ? 'other' : 'this',
      }], flags);
    },

    /** A time that is only printed on some weeks.
     *
     *  Recorded rather than branched around outside, so the page can say "this is on the
     *  board when the clocks are back, and they are not this week" instead of the cell
     *  simply not mentioning a מנין that exists for half the year. `held` is the answer for
     *  this week; `when` names the condition in the shul's own terms.
     *
     *  A link in the chain rather than a wrapper around one: a wrapper would carry the other
     *  methods too, and those close over the steps they were built with, so anything added
     *  after it would quietly drop the condition again. */
    onlyWhen(held, when) {
      const next = make(value, [...steps, { kind: 'condition', when, held }], flags);
      return Object.freeze({ ...next, held, text: () => (held ? next.text() : '') });
    },

    /** A short line naming this time, for use inside another time's steps. */
    describe() {
      return { text: formatTime(value), steps };
    },
  });
}

/** A time that starts from a named zman.
 *
 *  The name is the Hebrew the board and the shul use, since that is what a reader is holding
 *  in their head. `note` is for the part of a zman's identity that its name does not carry:
 *  which opinion, which horizon, whether the elevation is in it. */
export function zman(name, value, note) {
  return make(value, [{ kind: 'base', name, note, at: formatTime(value) }], {});
}

/** A clock time nobody works out: the shul davens at 1:50 and that is the whole rule.
 *
 *  Still a traced time rather than a bare string, so a fixed time can be compared against a
 *  computed one (the מנחה list is full of "the later of מנחה גדולה and 12:30") and so the page
 *  can say, in as many words, that this one is not calculated. */
export function clockTime(hours, minutes, label) {
  const value = (hours + minutes / 60) / 24;
  return make(value, [{ kind: 'fixed', at: formatTime(value), label }], {});
}

/** The same from a printed string: fixedTime('1:50'), afternoon unless told otherwise.
 *
 *  A board is a 12-hour clock with no am or pm on it, and every fixed time on these charts
 *  except the morning שחרית ones is an afternoon or evening time, so 12 and the small hours
 *  are read as pm. `am` forces the other way. */
export function fixedTime(text, { am = false, label } = {}) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) throw new Error(`fixedTime: not a time: ${text}`);
  let h = Number(m[1]) % 12;
  if (!am) h += 12;
  return clockTime(h, Number(m[2]), label);
}
