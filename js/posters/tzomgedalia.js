// The צום גדליה poster: a fast day, so one page holding שחרית, מנחה, שקיעה and מעריב.
//
// Laid out like the sheet that runs the days after יו"כ: a heading per תפילה with its
// times under it, rather than the label-and-time rows the ראש השנה and יום כיפור sheets
// use. That is how the shul hangs this one.
//
// Everything on the afternoon of the sheet hangs off שקיעה. The last מנין is 45 minutes in
// front of it, the one before that 45 minutes in front of the last, and the one before that
// 45 minutes again. Only the two roundings differ, and they are set out in tzomGedaliaMincha.
//
// The morning is not calculated at all, and it is not the ר"ח בה"ב ותענ"צ schedule out of
// Settings either: a fast day starts earlier than that, and the sheet the shul hangs prints
// its own list. It sits in TZG_TEXT with the other slots that are set by hand.
import { roshHashana, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime } from '../format.js';
import { parseTimes } from './slichos.js';

const TZG_MIN = 1 / 1440;
/** To the nearest 5 minutes, and up to the next quarter hour. */
const tzgNear5 = (t) => Math.round(t * 288) / 288;
const tzgUp15 = (t) => Math.ceil(t * 96 - 1e-9) / 96;

/** How far apart the three afternoon מנינים are, and how far the last one is in front of
 *  שקיעה. One number, because it is the same 45 minutes throughout. */
const TZG_GAP = 45;

/** The wording, and the two מנחה slots the shul sets by hand rather than by the sun. */
export const TZG_TEXT = {
  title: 'צום גדליה',
  shacharis: 'שחרית',
  mincha: 'מנחה',
  shkia: 'שקיעה',
  maariv: 'מעריב',
  // The morning, which does not move with the year. The fast day run starts earlier than
  // the everyday one and is its own list rather than the ר"ח בה"ב ותענ"צ schedule out of
  // Settings: this is what the sheet the shul hangs prints. Written in the marks this
  // project uses throughout, which is where the old sheet's three levels of asterisk land:
  // its ** (בית מדרש למטה) is the underline here, and its *** (באולם השמחות) is **.
  morning: '6:20, 6:40*, <u>7:00</u>, 7:35**, 8:00',
  // The two early ones, which do not move with the year either. Same pair as the everyday
  // board: the 1:35 is למטה and the 1:50 is the main בית מדרש.
  earlyMincha: '<u>1:35</u>, 1:50',
};

/** The day the fast falls on, as an Excel serial.
 *
 *  3 תשרי, unless that is Shabbos, when the fast is put off to the Sunday. ר"ה can only
 *  open on a Monday, Tuesday, Thursday or Shabbos, so the one case that defers is a Thursday
 *  ר"ה, which puts 3 תשרי on Shabbos. */
export function tzomGedaliaSerial(rh) {
  const third = rh + 2;
  return excelWeekday(third) === 7 ? third + 1 : third;
}

/** The three afternoon מנינים, worked back from שקיעה.
 *
 *  The last is 45 minutes before שקיעה, to the nearest 5. The one in front of it is 45
 *  minutes earlier again, put up to the next quarter hour, which is what keeps the middle of
 *  the afternoon on a round time. The first is a plain 45 minutes before that and needs no
 *  rounding of its own, since it is already on a quarter hour.
 *
 *  The two roundings go opposite ways, which is not a slip. They are the pair that
 *  reproduces the תשפ"ו sheet: a 6:49 שקיעה gives 6:04, then 6:05, 5:30 and 4:45, which is
 *  what that sheet prints. Rounding both down instead gives 6:00, 5:15 and 4:30, a quarter
 *  hour early. Confirmed with the user against that sheet before this was written. */
export function tzomGedaliaMincha(shkia) {
  const last = tzgNear5(shkia - TZG_GAP * TZG_MIN);
  const middle = tzgUp15(last - TZG_GAP * TZG_MIN);
  return [middle - TZG_GAP * TZG_MIN, middle, last];
}

/** The finished poster for one Hebrew year. */
export function buildTzomGedaliaPoster(year, settings) {
  if (!year) return null;
  const serial = tzomGedaliaSerial(roshHashana(year - 3761));
  const shkia = Z.sunsetElev(dateFromSerial(serial), settings);
  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });

  const shacharis = parseTimes(TZG_TEXT.morning);
  const mincha = [
    ...parseTimes(TZG_TEXT.earlyMincha),
    // The two that open the run are למטה and the one against שקיעה is the main בית מדרש,
    // the same way round as the afternoon on the everyday board.
    ...tzomGedaliaMincha(shkia).map((t, i) => tm(t, i < 2)),
  ];
  // 35 and 50 minutes after שקיעה. The later one is the underlined one, which is how the
  // boards print a two time מעריב.
  const maariv = [tm(shkia + 35 * TZG_MIN), tm(shkia + 50 * TZG_MIN, true)];

  const all = [...shacharis, ...mincha, ...maariv];
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    span: { from: serial, to: serial },
    sets: [
      { head: TZG_TEXT.shacharis, lines: [shacharis] },
      { head: TZG_TEXT.mincha, lines: [mincha] },
      // שקיעה stands on its own between the two, the way the sheet sets it. It is not a
      // מנין, so it is not part of the מנחה block: it carries no heading and its line is the
      // name and the time together.
      { note: { label: TZG_TEXT.shkia, text: formatTime(shkia) } },
      { head: TZG_TEXT.maariv, lines: [maariv] },
    ],
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
