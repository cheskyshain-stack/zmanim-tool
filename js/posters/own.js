// A sheet the shul writes itself.
//
// Every other sheet in this folder is an occasion someone here has written code for: its
// blocks, its rows and its times are all worked out from the workbook's rules. That covers
// the yomim noraim and פסח and nothing else, so a chart for חנוכה or פורים meant somebody
// writing another one of these files.
//
// This is the same sheet with the writing left to the shul. A sheet is a list of blocks, a
// block is a day and a list of rows, and a row is a name and its times. That is exactly the
// shape the one-page chart already draws (see ONEPAGE_SECTIONS in ui/posters-view.js), so a
// sheet typed here comes out on the same paper, in the same two columns, at the same fitted
// size, with the same key at its foot.
//
// Two things are chosen rather than typed, and both are why this is worth having:
//
//  - A block is dated by its Hebrew date, not by a date in a year. So the sheet is not for
//    תשפ"ז, it is for חנוכה: step the year on the Posters tab and every block moves to that
//    year's day by itself.
//  - A row's time can hang off a זמן instead of being typed. "20 minutes before שקיעה" is
//    worked out for that block's day, off the same calls the boards are made of, so it is
//    right in a year nobody has looked at yet.
//
// Nothing here is a second reckoning of anything: the זמנים are zmanim/zmanim.js, which is
// the workbook, and the times are written in the notation the charts already use.
import { dateFromHebrew, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, roundToMinute, floorToMinute, ceilToMinute } from '../format.js';
import { parseTimes } from './slichos.js';

/** The months, as the Hebrew date counts them: Nisan is 1, the way rules count them too.
 *  Both Adars are offered; a plain year has neither and takes אדר. */
export const OWN_MONTHS = JEWISH_MONTHS_HE.map((name, i) => ({ value: i + 1, name }));

/** The זמנים a row can be hung off.
 *
 *  Every one of them is a call in zmanim/zmanim.js, which is the workbook's own formula
 *  under the workbook's own name, and every one reads the same Settings the boards read: the
 *  shul's latitude and longitude, its horizon, its elevation toggle. So a row here and the
 *  same זמן on the chart cannot come out a minute apart.
 *
 *  A short list on purpose. These are the זמנים the shul's own sheets are built out of; the
 *  ones that are not here are the ones no sheet has ever asked for. */
export const OWN_ZMANIM = [
  { key: 'alos72', label: 'עלות (72 דקות)', at: (d, s) => Z.alos72(d, s) },
  { key: 'alos161', label: 'עלות (16.1°)', at: (d, s) => Z.alos16_1(d, s) },
  { key: 'misheyakir', label: 'משיכיר (10.2°)', at: (d, s) => Z.misheyakir10_2(d, s) },
  { key: 'netz', label: 'נץ', at: (d, s) => Z.sunriseElev(d, s) },
  { key: 'shmaMga', label: 'סוף זמן ק"ש מ"א', at: (d, s) => Z.sofZmanShmaMGA72(d, s) },
  { key: 'shmaGra', label: 'סוף זמן ק"ש גר"א', at: (d, s) => Z.sofZmanShmaGRA(d, s) },
  { key: 'tfilaGra', label: 'סוף זמן תפילה גר"א', at: (d, s) => Z.sofZmanTfilaGRA(d, s) },
  { key: 'chatzos', label: 'חצות', at: (d, s) => Z.solarNoon(d, s) },
  { key: 'minchaGedola', label: 'מנחה גדולה', at: (d, s) => Z.minchaGedolaLechumra(d, s) },
  { key: 'minchaKetana', label: 'מנחה קטנה', at: (d, s) => Z.minchaKetana(d, s) },
  { key: 'plag', label: 'פלג המנחה', at: (d, s) => Z.plagHamincha(d, s) },
  { key: 'shkia', label: 'שקיעה', at: (d, s) => Z.sunsetElev(d, s) },
  // The shul's own candle lighting, which is the Settings number and not a fixed 18.
  { key: 'candles', label: 'הדלקת נרות', at: (d, s) => Z.sunsetElev(d, s) - (s.candleLightingMinutes ?? 18) / 1440 },
  { key: 'tzais50', label: 'צאת הכוכבים (50 דקות)', at: (d, s) => Z.tzais50(d, s) },
  { key: 'tzais72', label: 'צאת הכוכבים (72 דקות)', at: (d, s) => Z.tzais72(d, s) },
];

/** What to do with the seconds. A מנין is announced on a whole minute, and which way it is
 *  taken is a question about what the line is: a זמן that runs out is taken down, a זמן that
 *  starts is taken up, and a מנין set beside one is taken to the nearest. Down to the last
 *  five and up to the next five are here because that is how the boards write a מנחה. */
export const OWN_ROUNDING = [
  { key: 'near', label: 'To the nearest minute', apply: (t) => roundToMinute(t) },
  { key: 'down', label: 'Down to the minute', apply: (t) => floorToMinute(t) },
  { key: 'up', label: 'Up to the minute', apply: (t) => ceilToMinute(t) },
  { key: 'down5', label: 'Down to the last 5 minutes', apply: (t) => Math.floor(t * 288) / 288 },
  { key: 'up5', label: 'Up to the next 5 minutes', apply: (t) => Math.ceil(t * 288) / 288 },
];

/** The names a row is likely to want, so a sheet is picked rather than spelled. Anything not
 *  here is typed instead: the list is a shortcut, not a fence. Off the shul's own sheets. */
export const OWN_LABELS = [
  'שחרית', 'מנחה', 'מעריב', 'סליחות', 'מוסף', 'נעילה', 'כל נדרי',
  'עלות', 'נץ', 'זמן טלית', 'המלך', 'ס"ז ק"ש', 'ט\' שעות', 'חצות',
  'הדלקת נרות', 'שקיעה', 'צאת הכוכבים', 'קידוש לבנה',
  'דרשה', 'יזכור', 'תקיעת שופר', 'קריאת המגילה', 'הדלקת נר חנוכה', 'אבות ובנים',
];

/** And the same for a block's heading. */
export const OWN_HEADINGS = [
  'ערב יום טוב', 'יום א\'', 'יום ב\'', 'ערב שבת', 'שבת', 'חול המועד',
  'ערב ראש חודש', 'ראש חודש', 'מוצאי יום טוב', 'זמני היום', 'כל השנה',
];

/** A blank sheet, and a blank block and row for it, so the editor and an import agree on
 *  what one of these looks like. */
export const ownBlankRow = () => ({ label: OWN_LABELS[0], mode: 'typed', text: '', zman: 'shkia', offset: -15, round: 'near' });
export const ownBlankBlock = () => ({ heading: OWN_HEADINGS[0], month: 9, day: 25, rows: [ownBlankRow()] });

/** The day a block falls on in one year.
 *
 *  A Hebrew date is a month and a day and holds for every year, which is the point of dating
 *  a block this way: the sheet is for חנוכה rather than for חנוכה תשפ"ז. */
export function ownBlockSerial(block, year) {
  const month = Number(block?.month) || 1;
  const day = Math.min(30, Math.max(1, Number(block?.day) || 1));
  return dateFromHebrew(day, month, year);
}

/** One row's times.
 *
 *  Typed, it is read with the charts' own notation: <u> for למטה, a trailing * for בעזרת
 *  נשים, ** for באולם השמחות, commas between מנינים. Off a זמן, it is that זמן for this
 *  block's day, moved by the minutes given and taken to a whole minute the way the row says.
 *
 *  A row that names a זמן this file does not have is empty rather than broken: an import from
 *  a later version of the program can carry one, and a line with nothing in it is a great
 *  deal better than a sheet that will not draw. */
export function ownRowTimes(row, serial, settings) {
  if (!row) return [];
  if (row.mode !== 'zman') return parseTimes(row.text);
  const zman = OWN_ZMANIM.find((z) => z.key === row.zman);
  if (!zman) return [];
  const round = OWN_ROUNDING.find((r) => r.key === row.round) || OWN_ROUNDING[0];
  const at = zman.at(dateFromSerial(serial), settings) + (Number(row.offset) || 0) / 1440;
  return [{ text: formatTime(round.apply(at)), underlined: Boolean(row.underlined), mark: row.mark || '' }];
}

/** What a row off a זמן says it is, in words, for the editor and for the Calculations page:
 *  "20 minutes before שקיעה, down to the last 5 minutes". */
export function ownRuleText(row) {
  const zman = OWN_ZMANIM.find((z) => z.key === row.zman);
  if (!zman) return '';
  const mins = Number(row.offset) || 0;
  const when = mins === 0 ? 'at' : `${Math.abs(mins)} minutes ${mins < 0 ? 'before' : 'after'}`;
  const round = OWN_ROUNDING.find((r) => r.key === row.round) || OWN_ROUNDING[0];
  return `${when} ${zman.label}, ${round.label.toLowerCase()}`;
}

/** The sheet, built for one year.
 *
 *  Everything the one-page chart needs and nothing else: the blocks in the order they were
 *  typed, each with the day it falls on this year, and the key at the foot worked out from
 *  the marks that are actually on it, the same way every other sheet here does it.
 *
 *  In the order they were typed rather than in date order. The shul knows what belongs where
 *  on its own sheet, and a block with no times in it yet has a day like any other and would
 *  jump around the page as it was filled in. */
export function buildOwnPoster(sheet, year, settings) {
  if (!sheet || !year) return null;
  const blocks = (sheet.blocks || []).map((b) => {
    const serial = ownBlockSerial(b, year);
    return {
      serial,
      title: b.heading || '',
      rows: (b.rows || []).map((r) => ({ label: r.label || '', times: ownRowTimes(r, serial, settings) })),
    };
  });
  if (!blocks.length) return null;
  const all = blocks.flatMap((b) => b.rows.flatMap((r) => r.times));
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');
  const days = blocks.map((b) => b.serial);
  return {
    hebrewYear: year,
    own: true,
    title: sheet.name || '',
    // The days it speaks for: the first of its blocks through the last, whichever way round
    // they were typed.
    span: { from: Math.min(...days), to: Math.max(...days) },
    sections: blocks.map((b) => ({ title: b.title, rows: b.rows })),
    // Same two lines, in the same order, on the same reasoning as every other sheet: see
    // buildSlichosPoster. The underline line is an English sentence with Hebrew in it and is
    // set left to right; the star line is Hebrew and is set right to left.
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
