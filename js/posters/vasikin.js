// The מנין ותיקין sheets: one for ראש השנה, holding both days, and one for יום כיפור.
//
// A ותיקין מנין is timed so that שמונה עשרה is said at sunrise, which is why this is the one
// sheet in the whole program that prints a time to the second: נץ is the anchor and everything
// else on the sheet is a number of minutes in front of it.
//
// Ported off the two the shul hangs, ראש השנה תשפ"ו and יום כיפור תשפ"ה. Both are Word files
// typed by hand, and the ר"ה one still carried the year before's title at the top of it, which
// is the sort of thing this replaces.
//
// The rules are the shul's own and were given for both sheets at once, so the two now run on
// one set rather than a pair read off the old paper. See VS_RULES.
import { roshHashana } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, roundToMinute } from '../format.js';
import { minyanList } from './minyanim.js';

const VS_MIN = 1 / 1440;

/** The wording. Everything else on the sheet is worked out. */
export const VS_TEXT = {
  // The line over the title on both sheets, which is what a ותיקין מנין is for.
  motto: '"ייראוך עם שמש"',
  who: 'מנין ותיקין דליקוואוד קאמענס',
  roshHashana: 'ראש השנה',
  yomKippur: 'יום כיפור',
  day1: "יום א'",
  day2: "יום ב'",
  alos: 'עלות',
  shacharis: 'שחרית',
  tallis: 'זמן טלית',
  hamelech: 'המלך',
  netz: 'נץ',
};

/** The sheet in minutes, as the shul gave it. One set for both sheets: they were read off the
 *  old paper as two before this, where ר"ה opened 46 minutes before נץ and יו"כ 50, and the
 *  shul settled it with one rule for the pair.
 *
 *  Three of the four hang off נץ and one hangs off another line:
 *
 *    עלות       72 minutes before נץ
 *    זמן טלית   50 minutes before נץ
 *    המלך       21 minutes before נץ
 *    שחרית      30 minutes before המלך, so 51 before נץ once המלך has been rounded
 *
 *  שחרית is counted off המלך rather than off נץ because that is what it is: the מנין opens far
 *  enough ahead to reach המלך when it should. Off a המלך already taken to the whole minute, so
 *  it lands on a whole minute itself and the half hour on the sheet is exactly half an hour. */
export const VS_RULES = { alos: 72, tallis: 50, hamelech: 21, shacharisBeforeHamelech: 30 };

/** נץ with the seconds kept, which is the only place in the program that wants them.
 *
 *  sunriseElev, which is the very call the boards make and the one the סוכות sheet's own נץ on
 *  הושענא רבה is worked from, so this sheet cannot come to a different sunrise from the paper
 *  beside it. It reads the same Settings as everything else: the shul's latitude, longitude,
 *  horizon and elevation toggle. The toggle is off today, so this is sunrise at the horizon in
 *  Settings; turn it on and the boards and this sheet move together.
 *
 *  That also makes עלות here the workbook's own עלות 72, which is sunriseElev less 72 minutes
 *  (see alos72 in zmanim/zmanim.js), rather than a second reckoning of it.
 *
 *  Measured against the two sheets the shul hangs: within a second of the ר"ה one's printed נץ
 *  and six seconds of the יו"כ one's. */
export function vasikinNetz(serial, settings) {
  /* Snapped to the second it prints as, and everything else on the sheet taken off that.
     Otherwise the sheet can contradict itself in front of the reader: on ר"ה תשפ״ז the sun
     rises at 6:34:59.6, which prints as נץ 6:35:00, and עלות taken off the raw value came out
     at 5:22 where 6:35:00 less 72 minutes is plainly 5:23. The same rule pesach.js keeps for
     its own comparisons: work from the number that is on the paper. */
  return Math.round(Z.sunriseElev(dateFromSerial(serial), settings) * 86400) / 86400;
}

/** נץ printed to the second, the way both sheets print it. */
export function netzText(t) {
  const s = Math.round((((t % 1) + 1) % 1) * 86400);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** One day of a sheet: the four times in front of נץ, then נץ itself.
 *
 *  To the closer minute, which is what the shul asked for on המלך and is kept for the other
 *  two off נץ so one sheet is not rounded three ways. The old paper took ר"ה down and יו"כ up
 *  and so came out a minute apart from itself; this is one rule for the pair.
 *
 *  שחרית is not rounded at all. It is half an hour before a המלך that is already a whole
 *  minute, so it is one by arithmetic, and rounding it again could only move it off the half
 *  hour it is meant to be. */
function vasikinDay(serial, settings, heading) {
  const netz = vasikinNetz(serial, settings);
  const before = (mins) => roundToMinute(netz - mins * VS_MIN);
  const hamelech = before(VS_RULES.hamelech);
  const shacharis = hamelech - VS_RULES.shacharisBeforeHamelech * VS_MIN;
  return {
    serial,
    heading,
    lines: [
      { label: VS_TEXT.alos, text: formatTime(before(VS_RULES.alos)), calc: 'alos' },
      { label: VS_TEXT.shacharis, text: formatTime(shacharis), calc: 'shacharis' },
      { label: VS_TEXT.tallis, text: formatTime(before(VS_RULES.tallis)), calc: 'tallis' },
      { label: VS_TEXT.hamelech, text: formatTime(hamelech), calc: 'hamelech' },
      // The anchor, and the only time in the program printed to the second.
      { label: VS_TEXT.netz, text: netzText(netz), calc: 'netz' },
    ],
    shacharisAt: shacharis,
  };
}

/** The whole sheet for one year.
 *
 *  `which` is 'rh' for the two days of ראש השנה on one sheet, or 'yk' for יום כיפור on its own,
 *  which is how the shul hangs them, or 'both' for the two of them on one page.
 *
 *  A sheet is a list of sections and a section is a list of days, which is one shape for all
 *  three: ר"ה is one section of two days, יו"כ is one section of one, and 'both' is the two of
 *  them in order. `days` is the same days again, flat, for the span and the מנינים. */
export function buildVasikinPoster(year, settings, which = 'rh') {
  if (!year) return null;
  const rh = roshHashana(year - 3761);
  if (!rh) return null;
  const M = minyanList();

  // ר"ה is the first two days of the year; יו"כ is the tenth, which is nine days after it.
  const roshSection = () => ({
    heading: VS_TEXT.roshHashana,
    days: [vasikinDay(rh, settings, VS_TEXT.day1), vasikinDay(rh + 1, settings, VS_TEXT.day2)],
  });
  const kippurSection = () => ({ heading: VS_TEXT.yomKippur, days: [vasikinDay(rh + 9, settings, '')] });
  const sections = which === 'yk' ? [kippurSection()]
    : which === 'both' ? [roshSection(), kippurSection()]
      : [roshSection()];
  const days = sections.flatMap((s) => s.days);

  // The one מנין on the sheet. The other three lines are זמנים and an anchor, not מנינים, so
  // they are deliberately not offered as "what is on next": see posters/minyanim.js.
  for (const d of days) M.at(d.serial, VS_TEXT.shacharis, d.shacharisAt);

  return {
    hebrewYear: year,
    which,
    // On the two-in-one sheet the occasion is a heading over each half, so the line at the top
    // names the מנין instead of naming one of the two days it is about.
    title: which === 'both' ? VS_TEXT.who
      : which === 'yk' ? VS_TEXT.yomKippur : VS_TEXT.roshHashana,
    span: { from: days[0].serial, to: days[days.length - 1].serial },
    sections,
    days,
    minyanim: M.out,
    // Nothing on this sheet is marked, so there is no key at the foot. The Word sheets carry
    // one, but it is the star and the underline copied off another sheet with nothing on these
    // two wearing either.
    legend: [],
  };
}
