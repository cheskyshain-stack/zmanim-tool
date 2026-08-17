// Weekday chart מנחה/מעריב schedule.
//
// The שבת charts are 1:1 ports of workbook columns. These two are not: the workbook
// leaves weekday מנחה/מעריב blank and they were typed in by hand every week. So the
// shul's standing weekday schedule is written out here as the rules it actually follows,
// and every zman those rules lean on still comes from the workbook's own ported formulas
// (zmanim.js / hebrew-calendar.js), never from a zmanim library:
//
//   שקיעה         Z.sunset          (workbook SUNSET)
//   מנחה גדולה    Z.minchaGedolaLechumra (workbook MINCHA_GEDOLA_LECHUMRA - the same one
//                                    the workbook's own ערב שבת מנחה menu tests against
//                                    to decide its 1:35 slot, see common.js)
//   DST           Z.dstLocal        (workbook calcDST_LOCAL)
//   ר"ח / dates   hebrew-calendar.js (workbook ROSH_HASHANA + JEWISH_DATE_AS_ARRAY)
//
// Everything is decided once per *week*, from Sunday through Thursday only: Friday runs
// on the ערב שבת schedule over on the שבת chart, and Shabbos has its own.
//
// שחרית is deliberately not built here. It's one fixed schedule identical every week,
// printed once as a merged cell straight from Settings (see ui/sheet-view.js).
//
// How a printed time says where that מנין davens (the same symbols the chart's own footer
// explains):
//
//   plain time        main בית מדרש
//   underlined time   למטה
//   one * after it    בעזר״נ
//   two ** after it   באולם השמחות
//
// Typing over a cell still works and still wins: a hand-typed value is stored as a
// per-cell override and rendered instead of anything computed here (see overrides.js).
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { excelWeekday, hebrewDateExtended, dateFromHebrew } from '../hebrew-calendar.js';
import { formatTime, underlineTime } from '../format.js';
import { splitLinesInHalf } from '../util.js';

/** Times are handled in whole minutes after midnight rather than Excel day-fractions,
 *  because every zman on this chart sits on a 5-minute grid and the moves below are
 *  defined in minutes. It also lets מעריב 12:00 be 1440 (end of day) instead of 0, which
 *  would otherwise sort before everything else. Day-fractions only come back at the end,
 *  to hand to formatTime. */
const HM = (h, m) => h * 60 + m;
const fmtMinutes = (mins) => formatTime(mins / 1440);
/** Zmanim come back as day-fractions; this chart works in minutes. */
const toMinutes = (dayFraction) => dayFraction * 1440;

const STEP = 5; // a zman is nudged 5 minutes at a time
const TOO_CLOSE = 14; // 14 minutes or less from its neighbour and a moved zman is dropped
const STEP_GUARD = 288; // 288 * 5 = a full day, so a bad latitude can never spin forever

const MAIN = 'main'; // main בית מדרש, printed plain
const LMATA = 'lmata'; // למטה, printed underlined
const EZRAS = 'ezras'; // בעזר״נ, printed with one *

function renderTime(mins, place) {
  const text = fmtMinutes(mins);
  if (place === LMATA) return underlineTime(text);
  if (place === EZRAS) return `${text}*`;
  return text;
}

/** The five days this row schedules. Weekday rows are anchored on their Shabbos serial
 *  like every other row, so Sunday is six days back. Two rows on a Weekday chart are
 *  anchored on a stand-in date instead of a real Saturday (the season's trailing gap
 *  before Yom Tov, and a Chol Hamoed row - see weeks.js), which is why this walks back
 *  from whatever weekday the serial actually is rather than just subtracting six. */
function sundayThroughThursday(serial) {
  const sunday = serial - (excelWeekday(serial) - 1);
  return [0, 1, 2, 3, 4].map((i) => sunday + i);
}

function shkiaMinutes(serial, settings) {
  return toMinutes(Z.sunset(dateFromSerial(serial), settings));
}

/** The three BMG זמנים, as Hebrew (day, month) pairs. Month numbering is the workbook's
 *  own: Nissan=1 .. Elul=6, Tishrei=7 .. Adar=12. `endYearOffset` is 1 for the אלול range
 *  only, because its end (יום כיפור) falls after ראש השנה and so lands in the next AM
 *  year, while the other two open and close inside one AM year. */
const BMG_RANGES = [
  { start: [1, 6], end: [10, 7], endYearOffset: 1 }, // ר"ח אלול -> יום כיפור
  { start: [1, 8], end: [7, 1], endYearOffset: 0 }, // ר"ח חשון -> ז' ניסן
  { start: [1, 2], end: [9, 5], endYearOffset: 0 }, // ר"ח אייר -> ט' באב
];

/** Whether one calendar day falls inside a BMG זמן. Each range is resolved into actual
 *  serial dates so the comparison is a plain date range, which sidesteps the fact that
 *  the AM year rolls over at ראש השנה (month 7) while the month numbering starts at
 *  ניסן (month 1). The neighbouring years are checked too: a day in תשרי belongs to a
 *  range that opened in אלול of the year before. */
function isBmgDay(serial, settings) {
  const { year } = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  for (const y of [year - 1, year, year + 1]) {
    for (const r of BMG_RANGES) {
      const from = dateFromHebrew(r.start[0], r.start[1], y);
      const to = dateFromHebrew(r.end[0], r.end[1], y + r.endYearOffset);
      if (serial >= from && serial <= to) return true;
    }
  }
  return false;
}

/** One answer for the whole row, since the chart prints one line per week. A week that
 *  straddles the start or end of a BMG זמן goes with the majority of its Sunday-Thursday
 *  days, so the row can never come out self-contradictory (a 4:15 מנחה, which is BMG
 *  only, printed alongside an 11:30 מעריב, which is not). */
function isBmgWeek(serial, settings) {
  const days = sundayThroughThursday(serial);
  const bmgDays = days.filter((d) => isBmgDay(d, settings)).length;
  return bmgDays * 2 > days.length;
}

/** מנחה.
 *
 *  Regular times: 12:45, 1:15, 1:35, 1:50, 4:15, 6:35, 7:30, 8:00.
 *  All of them are למטה except 1:50, which is the main בית מדרש, and a zman that moves
 *  keeps the location it started with. */
function minchaTimes(week, settings) {
  const days = sundayThroughThursday(week.serial);
  const dates = days.map(dateFromSerial);

  // 12:45 and 1:15 only run on standard time. DST always flips on a Sunday, so all five
  // days agree; .every() is just being explicit about which way a split week would go.
  const standardTime = dates.every((d) => !Z.dstLocal(d, settings));
  const bmg = isBmgWeek(week.serial, settings);

  // 1:35 unless מנחה גדולה is too late for it anywhere in the week, in which case 1:40.
  // Never anything else. The workbook makes the same call the same way for its ערב שבת
  // מנחה menu (common.js), against the same MINCHA_GEDOLA_LECHUMRA.
  const latestMinchaGedola = Math.max(...dates.map((d) => toMinutes(Z.minchaGedolaLechumra(d, settings))));
  const earlyAfternoon = latestMinchaGedola > HM(13, 35) ? HM(13, 40) : HM(13, 35);

  // The evening מנחה must clear שקיעה by 15 minutes on every one of the five days, so it
  // is the *earliest* שקיעה that binds. Rounded down, so a stray fraction of a minute
  // can never leave a zman a few seconds short of the 15.
  const earliestShkia = Math.floor(Math.min(...days.map((d) => shkiaMinutes(d, settings))));
  const latestAllowed = earliestShkia - 15;

  const slots = [
    standardTime ? { mins: HM(12, 45), place: LMATA } : null,
    standardTime ? { mins: HM(13, 15), place: LMATA } : null,
    { mins: earlyAfternoon, place: LMATA },
    { mins: HM(13, 50), place: MAIN },
    bmg ? { mins: HM(16, 15), place: LMATA } : null, // 4:15 is a BMG zman
    { mins: HM(18, 35), place: LMATA, shkiaDriven: true },
    { mins: HM(19, 30), place: LMATA, shkiaDriven: true },
    { mins: HM(20, 0), place: LMATA, shkiaDriven: true },
  ].filter(Boolean);

  // Walk each evening zman earlier, 5 minutes at a time, until it clears שקיעה.
  for (const slot of slots) {
    if (!slot.shkiaDriven) continue;
    const base = slot.mins;
    for (let guard = 0; slot.mins > latestAllowed && guard < STEP_GUARD; guard++) slot.mins -= STEP;
    slot.moved = slot.mins !== base;
  }

  // A move can walk a zman back into the one before it. Once it is within 14 minutes of
  // the previous מנחה still being printed, it stops being printed at all.
  const kept = [];
  for (const slot of slots) {
    const prev = kept[kept.length - 1];
    if (slot.moved && prev && slot.mins - prev.mins <= TOO_CLOSE) continue;
    kept.push(slot);
  }
  return kept.map((slot) => renderTime(slot.mins, slot.place));
}

/** Where the 8:45 מעריב davens, which follows wherever the clock pushed it to. It is
 *  still the 8:45 מנין at every one of these times. */
function place845(mins) {
  if (mins <= HM(20, 45)) return MAIN; // never moved: main בית מדרש
  if (mins <= HM(21, 15)) return LMATA; // 8:50 through 9:15: למטה
  return EZRAS; // 9:20 or later: בעזר״נ
}

/** מעריב.
 *
 *  Regular times: 6:35, 7:00, 7:30, 8:00, 8:45, 9:30, 10:00, 10:30, 11:00, 11:30, 12:00.
 *  למטה throughout except 10:30 (main בית מדרש) and the 8:45 מנין, which moves around
 *  (see place845). 11:30 and 12:00 run only when BMG is out of session. */
function maarivTimes(week, settings) {
  const days = sundayThroughThursday(week.serial);

  const bmg = isBmgWeek(week.serial, settings);

  // A מעריב must be 50 minutes after שקיעה on every one of the five days, so here it is
  // the *latest* שקיעה that binds. Rounded up, for the same reason מנחה rounds down.
  const latestShkia = Math.ceil(Math.max(...days.map((d) => shkiaMinutes(d, settings))));
  const earliestAllowed = latestShkia + 50;

  const slots = [
    { mins: HM(18, 35) },
    { mins: HM(19, 0) },
    { mins: HM(19, 30) },
    { mins: HM(20, 0) },
    { mins: HM(20, 45), is845: true },
    { mins: HM(21, 30) },
    { mins: HM(22, 0) },
    { mins: HM(22, 30), place: MAIN }, // 10:30 is the main בית מדרש
    { mins: HM(23, 0) },
    !bmg ? { mins: HM(23, 30) } : null, // 11:30 and 12:00 run only when BMG is out
    !bmg ? { mins: HM(24, 0) } : null,
  ].filter(Boolean);

  // Walk each zman later, 5 minutes at a time, until it clears שקיעה by 50.
  for (const slot of slots) {
    const base = slot.mins;
    for (let guard = 0; slot.mins < earliestAllowed && guard < STEP_GUARD; guard++) slot.mins += STEP;
    slot.moved = slot.mins !== base;
  }

  // Mirror of the מנחה rule, in the other direction: a zman pushed up to within 14
  // minutes of the next מעריב still being printed stops being printed. Walked from the
  // end backwards so "the next one" means the next one actually surviving, not one that
  // is itself about to be dropped.
  //
  // The 8:45 is exempt. It is a מנין in its own right rather than a duplicate of the one
  // behind it, and once it passes 9:20 it davens in a different room (בעזר״נ) from the
  // 9:30 (למטה), so the two belong on the board together. Without the exemption it would
  // be deleted every year from mid-June to mid-July, which is the only stretch where it
  // ever reaches בעזר״נ at all - the location rule above would never print once.
  const kept = [];
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    const next = kept[kept.length - 1];
    if (slot.moved && !slot.is845 && next && next.mins - slot.mins <= TOO_CLOSE) continue;
    kept.push(slot);
  }
  kept.reverse();
  return kept.map((slot) => renderTime(slot.mins, slot.is845 ? place845(slot.mins) : slot.place ?? LMATA));
}

export function buildWeekdayRow(week, settings) {
  return {
    B: splitLinesInHalf(maarivTimes(week, settings)),
    C: splitLinesInHalf(minchaTimes(week, settings)),
  };
}

export const WEEKDAY_COLUMNS = [
  { key: 'B', header: 'מעריב' },
  { key: 'C', header: 'מנחה' },
  { key: 'E', header: 'שחרית' },
];
