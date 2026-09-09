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
// The gaps are the shul's own and are not the same on the two sheets: ר"ה opens 46 minutes
// before נץ and יו"כ 50, the davening before שמונה עשרה being longer on יו"כ. See VS_GAPS.
import { roshHashana } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute } from '../format.js';
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

/** How many minutes before נץ each line is, per occasion.
 *
 *  Read off the two sheets. עלות is the ordinary עלות 72, and המלך is 21 minutes before נץ on
 *  both. The other two are the shul's own and differ: ר"ה opens 46 minutes before נץ with the
 *  טלית 44 before, and יו"כ opens 50 before with the טלית 51, which is the one line where the
 *  טלית comes before the מנין rather than after it.
 *
 *  Kept as data rather than as five numbers in the builder, because these are the whole of
 *  what the two sheets disagree about and they belong in one place where they can be seen
 *  side by side. */
export const VS_GAPS = {
  rh: { alos: 72, shacharis: 46, tallis: 44, hamelech: 21 },
  yk: { alos: 72, shacharis: 50, tallis: 51, hamelech: 21 },
};

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

/** One day of a sheet: the four מנינים and זמנים in front of נץ, then נץ itself.
 *
 *  Every one of the four is taken down to the whole minute, which is how the ר"ה sheet has
 *  them: at a נץ of 6:45:41 it prints עלות 5:33 where 5:33:41 is the true value. The יו"כ sheet
 *  rounds the other way and comes out a minute later on all four, which is the one thing about
 *  these two sheets that cannot both be right. Down is what is here, so the ר"ה sheet, which is
 *  the one hung first and the one this was asked for, comes out to the minute it always has. */
function vasikinDay(serial, settings, gaps, heading) {
  const netz = vasikinNetz(serial, settings);
  const at = (mins) => floorToMinute(netz - mins * VS_MIN);
  return {
    serial,
    heading,
    lines: [
      { label: VS_TEXT.alos, text: formatTime(at(gaps.alos)), calc: 'alos' },
      { label: VS_TEXT.shacharis, text: formatTime(at(gaps.shacharis)), calc: 'shacharis' },
      { label: VS_TEXT.tallis, text: formatTime(at(gaps.tallis)), calc: 'tallis' },
      { label: VS_TEXT.hamelech, text: formatTime(at(gaps.hamelech)), calc: 'hamelech' },
      // The anchor, and the only time in the program printed to the second.
      { label: VS_TEXT.netz, text: netzText(netz), calc: 'netz' },
    ],
    shacharisAt: at(gaps.shacharis),
  };
}

/** The whole sheet for one year.
 *
 *  `which` is 'rh' for the two days of ראש השנה on one sheet, or 'yk' for יום כיפור on its own,
 *  which is how the shul hangs them. */
export function buildVasikinPoster(year, settings, which = 'rh') {
  if (!year) return null;
  const rh = roshHashana(year - 3761);
  if (!rh) return null;
  const gaps = VS_GAPS[which] || VS_GAPS.rh;
  const M = minyanList();

  // ר"ה is the first two days of the year; יו"כ is the tenth, which is nine days after it.
  const days = which === 'yk'
    ? [vasikinDay(rh + 9, settings, gaps, '')]
    : [vasikinDay(rh, settings, gaps, VS_TEXT.day1),
      vasikinDay(rh + 1, settings, gaps, VS_TEXT.day2)];

  // The one מנין on the sheet. The other three lines are זמנים and an anchor, not מנינים, so
  // they are deliberately not offered as "what is on next": see posters/minyanim.js.
  for (const d of days) M.at(d.serial, VS_TEXT.shacharis, d.shacharisAt);

  return {
    hebrewYear: year,
    which,
    title: which === 'yk' ? VS_TEXT.yomKippur : VS_TEXT.roshHashana,
    span: { from: days[0].serial, to: days[days.length - 1].serial },
    days,
    minyanim: M.out,
    // Nothing on this sheet is marked, so there is no key at the foot. The Word sheets carry
    // one, but it is the star and the underline copied off another sheet with nothing on these
    // two wearing either.
    legend: [],
  };
}
