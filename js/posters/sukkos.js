// The סוכות sheet: יום א', יום ב', שבת חול המועד where there is one, שמיני עצרת, שמחת תורה,
// שבת בראשית where it falls the day after, and the חול המועד box.
//
// The longest of the sheets, and the most of it moves with the year. Ported off three the shul
// hung, תשפ"ד, תשפ"ה and תשפ"ו, which between them cover every shape this sheet takes: a יום א'
// on Shabbos, a שמיני עצרת on Shabbos, a שבת חול המועד, a שבת בראשית the day after שמחת תורה,
// and two years with an עירוב תבשילין. Where the rule the shul gave and the sheet it printed
// disagree, the rule is what is here and the difference is written down beside it.
//
// The marks are this project's, not the old sheet's. Those posters used * for בעזרת נשים,
// ** for בית מדרש למטה and *** for אולם השמחות; here plain is the main בית מדרש, an underline
// is למטה, * is בעזר״נ and ** is אולם השמחות. Same translation the סליחות and צום גדליה sheets
// already make, so somebody holding this and the board is reading one set of marks.
import { roshHashana, excelWeekday } from '../hebrew-calendar.js';
import { eiruvMade, EIRUV_LABEL } from './eiruv.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute, ceilToMinute, roundToMinute, UL_START } from '../format.js';
import { SLASH } from '../util.js';
import { buildChorefRow } from '../sheets/choref.js';
import { parseTimes } from './slichos.js';
import { twoReckonings, nineHours } from './reckonings.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { everydayShacharis, afterSchedule } from './yomkippur.js';
import { openingMincha, openingMinchaTrace } from './early-mincha.js';
import { chartTimes, chartLine } from './chart-cell.js';
import { zman, clockTime, fixedTime } from '../zmanim/trace.js';

const SK_MIN = 1 / 1440;
const SK_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos
const SK_FRIDAY = 6;

/** A clock time as a day fraction. */
const skAt = (h, m) => (h * 60 + m) * SK_MIN;
/** Down to the last 5 minutes. Announced times are round, and rounding down rather than to
 *  the nearest keeps a gap at or over the one asked for rather than either side of it. */
const skDown5 = (t) => Math.floor(t * 288 + 1e-9) / 288;
/** Up to the next 5 minutes, for the one time that is announced as the head of a run rather
 *  than as a זמן of its own. */
const skUp5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;

/** How long before מעריב the דרשה is announced, in minutes.
 *
 *  The announced time is a round five and מעריב is not, so the gap cannot be one number: it is
 *  whatever the rounding leaves. Asked for as 27 to 32 minutes, and the widest a round five can
 *  hold inside that is five minutes, so this is the near end of it and the gap comes out
 *  between 28 and 32. It was 30 before, which rounded down is 30 to 34, and the sheet in front
 *  of the shul had a 34 on it.
 *
 *  Read as "the latest round five that is still at least this long before מעריב", which is what
 *  skDown5 of מעריב less this number is.
 *
 *  Off the מעריב the sheet prints rather than the fraction behind it. מעריב is שקיעה plus fifty
 *  minutes and lands on a fraction of a minute; the printed time rounds and the דרשה was being
 *  taken off the unrounded one, so a year where מעריב rounded up read a minute wider than it
 *  was worked out to be. Seven of thirty one years came out at 33. */
const SK_DRASHA_BEFORE = 28;

/** How long before שקיעה שמחת תורה's last מנחה is, in minutes. The shul asked for twenty; the
 *  sheets this was ported from print twenty two. Not rounded to a five: it is the one מנין of
 *  the day that is set off the sun rather than announced, the same as every other last מנחה on
 *  the sheet that is worked from that day's own שקיעה. */
const SK_SIMCHAS_BEFORE = 20;

/* Which day of תשרי each part of the sheet is. 1 תשרי is ראש השנה, so day n is rh + n - 1. */
const SK_EREV = 14;      // ערב סוכות, the afternoon the sheet opens on
const SK_DAY1 = 15;
const SK_DAY2 = 16;
const SK_CHM = [17, 18, 19, 20, 21]; // חול המועד, the last of them הושענא רבה
const SK_HOSHANA = 21;
const SK_SHMINI = 22;
const SK_SIMCHAS = 23;

const skSerial = (rh, day) => rh + day - 1;
const skShkia = (serial, settings) => Z.sunsetElev(dateFromSerial(serial), settings);
const skNetz = (serial, settings) => Z.sunriseElev(dateFromSerial(serial), settings);
/** The later of מנחה גדולה and half an hour after חצות, which is what every early מנחה on
 *  these sheets is tested against: the same call the boards and the other posters make. */
const skMinchaGedola = (serial, settings) => Z.minchaGedolaLechumra(dateFromSerial(serial), settings);

/* --- The same numbers, saying how they were arrived at --------------------------------
   Every printed time on this sheet carries a traced value beside it, which is what the
   calculations page draws. They are built in the same call as the number rather than beside
   it, so the working and the time cannot come apart: see zmanim/trace.js. */

/** That day's own שקיעה, as a traced value. A function rather than a value because each time
 *  built off it needs a chain of its own. */
const skShkiaT = (serial, settings) => zman('שקיעה', skShkia(serial, settings), 'that day\'s own');
/** A time the shul announces rather than works out. */
const skSet = (h, m, what) => clockTime(h, m, what);

/** The wording, and the times the shul sets by hand rather than by the sun. */
export const SK_TEXT = {
  title: 'סוכות',
  day1: "יום א'",
  day2: "יום ב'",
  shabbosChm: 'שבת חול המועד',
  shmini: 'שמיני עצרת',
  simchas: 'שמחת תורה',
  shabbosBereishis: 'שבת בראשית',
  cholHamoed: 'חול המועד',
  // What a heading adds when the day is Shabbos, or when an עירוב תבשילין is made that
  // afternoon. Both are on the old sheets in brackets after the day.
  shabbos: 'שבת',
  // The words themselves live in posters/eiruv.js, with the rule that puts them on a sheet.
  eiruv: EIRUV_LABEL,
  // Joined to the day with a dot rather than wrapped in brackets, which is how the ראש השנה
  // sheet has always set its Shabbos and the same reason (see RH_TEXT.daySep): the heading is
  // underlined, and the underline running under a bracket reads as though it is cutting
  // through it. Two notes on one day are two dots, "יום א' · שבת · עירוב תבשילין".
  daySep: ' · ',
  erevMincha: 'מנחה עיו"ט',
  erevMinchaShabbos: 'מנחה ערב שבת',
  candles: 'הדלקת נרות',
  mincha: 'מנחה',
  shkia: 'שקיעה',
  drasha: 'דרשה מאת הרב שליט"א',
  maariv: 'מעריב',
  maarivSheini: "מעריב ב'",
  shiur: 'שיעור בעניני החג מאחד מבני חבורה',
  krias: 'ס"ז ק"ש',
  // Printed on every Shabbos this sheet carries, the same זמן and the same pair of reckonings
  // the ראש השנה sheet prints on a first day that is Shabbos.
  nineHours: "ט' שעות",
  yizkor: 'יזכור בערך',
  mechiras: 'מכירת עליות שמחת תורה קודם מעריב',
  afterMusaf: 'מיד אחר מוסף',
  shacharis: 'שחרית',
  shacharisChm: 'חול המועד',
  hoshana: 'הושענא רבה',
  netz: 'נץ',
  // The everyday schedule the shul goes back to, the last block on the sheet. Named to match
  // the one that starts after יום כיפור, which it is worked exactly like.
  afterTitle: 'זמני תפילה אחר סוכות',
  // The two morning runs, which do not move with the year. The everyday one is not used on
  // חול המועד: those mornings have their own three, which is what the sheet prints.
  chmShacharis: '<u>7:00</u>, 8:00, <u>8:40</u>',
  hoshanaRest: '7:30, 8:20**',
  // The יום טוב morning, the same pair on every day of the sheet.
  yomTovShacharis: '<u>7:30</u>, 8:15',
  simchasShacharis: '8:15',
  /* יזכור, which is announced rather than worked out. One per שחרית: the למטה מנין's and the
     main בית מדרש's. Both move later when שמיני עצרת is Shabbos, the davening running longer:
     the למטה one by half an hour and the main one by the same. */
  yizkorEarly: '9:10',
  yizkorLate: '10:25',
  yizkorShabbosEarly: '9:40',
  yizkorShabbos: '10:55',
};

/** The שמחת בית השואבה sheet, which is a sheet of its own rather than a block of the
 *  schedule: one evening, at the Rav's house, with the משנה תורה that goes with it.
 *
 *  Everything on it is announced rather than worked out from the sun, so it is written here
 *  and nothing about it moves with the year. The hour is the shul's own: the sheets it was
 *  ported from say 9:45 and the shul has since moved it to 10:00. */
export const SK_SHUAVA = {
  title: 'שמחת בית השואבה בבית הרב שליט"א',
  when: "ליל ב' סוכות",
  at: '10:00',
  where: '798 vine ave.',
  /* The name alone, because on the schedule the time beside it is starred and the key at the
     foot says what a star means. It read "משנה תורה בעזרת נשים 8:00*", which says where twice
     over in one row. The sheet of its own has no key and no star on it, so it prints the two
     together: see renderSukkosShuavaPoster. */
  mishna: 'משנה תורה',
  mishnaWhere: 'בעזרת נשים',
  mishnaAt: '8:00',
  mishnaMaariv: 'מעריב אחר משנה תורה',
};

/** The early מנחה every one of these afternoons opens with.
 *
 *  1:15, 1:35, 1:50, 2:15 and 3:00, with the 1:15 moved to 1:20 on a day where it would fall
 *  before מנחה גדולה, and left off altogether where even that would. That is openingMincha in
 *  early-mincha.js, the same rule and the same code the schedule after יום כיפור runs on.
 *
 *  The shul's own תשפ"ד sheet prints 1:16, 1:17 and 1:18 on its three afternoons rather than
 *  1:15, so the guard is what those sheets were already doing by hand; the round 1:20 is what
 *  the shul asked for in place of three different minutes in three different years.
 *
 *  Both of the first two are למטה, the rest the main בית מדרש.
 *
 *  Except on ערב שמיני עצרת, where the shul asked for the whole afternoon to be למטה: the main
 *  בית מדרש is being set up for the night, so there is nowhere upstairs to daven. That is
 *  `allDown`, and only the שמיני עצרת block passes it. */
export function sukkosErevMincha(serial, settings, { allDown = false } = {}) {
  const gedola = skMinchaGedola(serial, settings);
  const first = openingMincha(gedola, skAt(13, 35));
  const standing = 'a standing מנין of the ערב יום טוב run, which does not move with the year';
  const rest = [
    { t: skAt(13, 35), u: true, trace: skSet(13, 35, standing) },
    { t: skAt(13, 50), u: allDown, trace: skSet(13, 50, standing) },
    { t: skAt(14, 15), u: allDown, trace: skSet(14, 15, standing) },
    { t: skAt(15, 0), u: allDown, trace: skSet(15, 0, standing) },
  ];
  return first === null
    ? rest
    : [{ t: first, u: true, trace: openingMinchaTrace(gedola, skAt(13, 35)) }, ...rest];
}

/** A day fraction snapped to the minute it prints as, so a comparison here and the sheet
 *  cannot disagree by a rounding. */
const skRoundPrinted = (t) => Math.round(t * 1440) / 1440;

/** The afternoon מנחה of a יום טוב: 2:00, 5:30 למטה, and the last one half an hour before that
 *  day's own שקיעה.
 *
 *  2:00 whatever day of the week it is, and on a day that falls on Shabbos an earlier מנין in
 *  front of it as well: `early`. The shul asked for the 2:00 alone for a while and has asked
 *  for the early מנין back.
 *
 *  That one is מנחה גדולה itself, put up to the whole minute, and not a round five. Every
 *  other early מנחה on this sheet is announced at 1:15 or 1:20 (openingMincha), and the shul
 *  asked for this one to be the זמן: it is the מנין that is there so a Shabbos afternoon can
 *  start as early as it is allowed to, so a rounded 1:20 would give away the four or five
 *  minutes it exists for. Up rather than to the nearest, which is what לחומרא means here: at
 *  1:20 and 24 seconds the מנין is 1:21, never 1:20, so the printed minute is never one the
 *  זמן has not reached.
 *
 *  למטה, like the מנין the ערב יום טוב afternoons open with. It was in the main בית מדרש when
 *  this was first put back, which is how the sheet printed it years ago; the shul says it is
 *  downstairs.
 *
 *  Only the days that are Shabbos take it. A weekday יום טוב afternoon still opens at 2:00,
 *  and in practice that is יום ב', which can never be Shabbos: 16 תשרי falls on a Sunday,
 *  Tuesday, Wednesday or Friday. The two that can are יום א' and שמיני עצרת, and they are
 *  Shabbos in the same years as each other, 15 and 22 תשרי being a week apart. */
function sukkosDayMincha(serial, settings, { five = true, fiveIfRoom = false, early = false } = {}) {
  const last = skRoundPrinted(skShkia(serial, settings) - 30 * SK_MIN);
  const standing = 'a standing מנין of the יום טוב afternoon, which does not move with the year';
  const out = [];
  if (early) {
    out.push({
      t: ceilToMinute(skMinchaGedola(serial, settings)),
      u: true,
      trace: zman('מנחה גדולה לחומרא', skMinchaGedola(serial, settings), 'that day\'s own')
        .ceil('up rather than to the nearest, so the printed minute is never one the זמן has not reached'),
    });
  }
  out.push({ t: skAt(14, 0), trace: skSet(14, 0, standing) });
  if (five) out.push({ t: skAt(17, 30), u: true, trace: skSet(17, 30, standing) });
  else {
    out.push({ t: skAt(17, 0), u: true, trace: skSet(17, 0, standing) });
    // שמיני עצרת opens 2:00 then 5:00, and takes a 5:30 as well when that still leaves a
    // quarter of an hour to the last מנין. The shul asked for it; the sheets it was ported
    // from print 2:00/5:00/last and leave the 5:30 out even in a year with the room.
    if (fiveIfRoom && last - skAt(17, 30) >= 15 * SK_MIN - 1e-9) {
      out.push({
        t: skAt(17, 30),
        u: true,
        trace: skSet(17, 30, 'on the board in a year where it still leaves a quarter of an hour in front of the last מנין'),
      });
    }
  }
  out.push({
    t: last,
    trace: skShkiaT(serial, settings)
      .minus(30, 'the last מנין of a יום טוב afternoon is half an hour in front of שקיעה')
      .round('to the minute the sheet prints'),
  });
  return out;
}

/** The days of חול המועד that keep the ordinary weekday schedule: not Shabbos, and not the
 *  Friday, which runs on an ערב שבת one. They are what the box's own times are set by. */
export function sukkosChmDays(rh) {
  return SK_CHM.map((n) => skSerial(rh, n))
    .filter((s) => excelWeekday(s) !== SK_SHABBOS && excelWeekday(s) !== SK_FRIDAY);
}

/** The חול המועד מנחה run.
 *
 *  1:15, 1:35 and 1:50 to open, the 1:15 moved to 1:20 or dropped like every other on this
 *  sheet, worked off the latest מנחה גדולה of the days the one printed list has to hold for.
 *  Then from 5:00 every twenty minutes, and last a מנין a quarter of an hour before the
 *  earliest שקיעה of those days, so it clears on all of them, taken down to a round five. A
 *  twenty minute step that lands within a quarter of an hour of that last one is not printed:
 *  two מנינים a few minutes apart is not a choice anybody uses, which is the same ground the
 *  weekday chart drops a zman on. Where dropping it leaves more than twenty minutes with
 *  nothing in them, one goes back in fifteen to twenty minutes before the last.
 *
 *  Everything from 5:00 is למטה, and so are the 1:15 and the 1:35. */
export function sukkosChmMincha(days, settings) {
  const earliest = Math.min(...days.map((s) => skShkia(s, settings)));
  // Down to the last five. It is announced as a round time like the rest of the run, and down
  // rather than up because a quarter of an hour before the earliest שקיעה is the latest it may
  // be: rounding up would push it past that on every one of the days it has to hold for.
  const last = skDown5(earliest - 15 * SK_MIN);
  /* The working behind that last מנין, written once and used by the fill below as well as by
     the מנין itself, so the two cannot describe the same number differently. */
  const lastT = () => zman('שקיעה', earliest, 'the earliest of every day this one printed list has to hold for')
    .minus(15, 'the last מנין is a quarter of an hour in front of it, so it clears on all of them')
    .floorToStep(5, 'announced as a round time, and down rather than up because a quarter of an hour before שקיעה is the latest it may be');
  const out = [];
  const gedola = Math.max(...days.map((s) => skMinchaGedola(s, settings)));
  const first = openingMincha(gedola, skAt(13, 35));
  const standing = 'a standing מנין of the חול המועד run, which does not move with the year';
  if (first !== null) out.push({ t: first, u: true, trace: openingMinchaTrace(gedola, skAt(13, 35)) });
  out.push({ t: skAt(13, 35), u: true, trace: skSet(13, 35, standing) },
    { t: skAt(13, 50), trace: skSet(13, 50, standing) });
  const run = [];
  const runWhat = 'one of the run that goes every twenty minutes from 5:00, kept while it stays a quarter of an hour clear of the last מנין';
  for (let t = skAt(17, 0); t <= last + 1e-9; t += 20 * SK_MIN) {
    /* Decomposed from one rounded count of minutes rather than from the float twice over. The
       run is accumulated with += 20/1440, so 5:00 arrives as 1019.9999999999999 minutes and
       taking its hours and minutes separately gives 4:60. */
    const mins = Math.round(t * 1440);
    if (last - t >= 15 * SK_MIN - 1e-9) {
      run.push({ t, trace: skSet(Math.floor(mins / 60), mins % 60, runWhat) });
    }
  }
  /* One more between the run and the last, where the twenty minute step leaves a hole. The
     step is dropped when it falls within a quarter of an hour of the last מנין, and dropping it
     can leave better than half an hour with nothing in it: measured on תשפ״ח, 5:20 and then
     5:50. So where the gap runs past twenty minutes a מנין goes in twenty minutes before the
     last, or fifteen where twenty would crowd the one in front of it, and nothing at all where
     neither leaves room. It lands on a round five by itself, the last being on one.
     It changes nothing in the years the shul's own sheets already read well: תשפ״ד's
     5:40 / 6:00 / 6:15 and תשפ״ו's 5:40 / 6:05 come out exactly as they are printed. */
  const before = run.length ? run[run.length - 1].t : skAt(13, 50);
  if (last - before > 20 * SK_MIN + 1e-9) {
    const fill = [20, 15].map((m) => ({ t: last - m * SK_MIN, m }))
      .find(({ t }) => t - before >= 15 * SK_MIN - 1e-9);
    if (fill !== undefined) {
      run.push({
        t: fill.t,
        trace: lastT().minus(fill.m, `put in in front of the last מנין, where the twenty minute run stops far enough back to leave a hole`),
      });
    }
  }
  for (const r of run) out.push({ t: r.t, u: true, trace: r.trace });
  out.push({ t: last, u: true, trace: lastT() });
  return out;
}

/** The חול המועד מעריב run.
 *
 *  The first is fifty minutes after the latest שקיעה of those days, so it clears on all of
 *  them, taken up to the next five. Then the top and the bottom of every hour through to 12:00, with the 8:45 kept in its
 *  place: it is its own מנין on the boards and not one more step of the run. A time within a
 *  quarter of an hour of the first is not printed, which in a year where שקיעה is late takes
 *  the 7:30 off.
 *
 *  Everything is למטה except the 8:45 and the 10:30, which are the main בית מדרש, the same way
 *  round as the weekday chart. */
export function sukkosChmMaariv(days, settings) {
  const latest = Math.max(...days.map((s) => skShkia(s, settings)));
  // Up to the next five. It is the head of a run of round times and is announced as one, so
  // 7:03 is not a time anybody is called to daven at; and up rather than down, since fifty
  // minutes after the latest שקיעה is the earliest it may be. It reproduces two of the three
  // sheets exactly, תשפ"ד's 7:30 and תשפ"ה's 7:00, where the raw number gives 7:28 and 6:59;
  // תשפ"ו's sheet prints its 7:16 unrounded.
  const first = skUp5(latest + 50 * SK_MIN);
  // Evening hours, written as 19 through 24 rather than 7 through 12. On a 12 hour clock the
  // two are the same digits and the arithmetic is not: 7:30 in the morning is a smaller day
  // fraction than a שקיעה, so a grid built on the morning hours came out entirely before the
  // first מנין and every one of them was dropped. The last is 12:00 midnight, which is 24:00
  // here and prints as 12:00.
  const firstT = () => zman('שקיעה', latest, 'the latest of every day this one printed list has to hold for')
    .plus(50, 'the first מעריב is fifty minutes after it, so it clears on all of them')
    .ceilToStep(5, 'announced as the head of a run of round times, and up rather than down because fifty minutes after שקיעה is the earliest it may be');
  const standing = 'the top or the bottom of an hour, a standing מנין that does not move with the year';
  const grid = [];
  for (let h = 19; h <= 24; h++) {
    for (const m of [0, 30]) {
      const t = skAt(h, m);
      if (t > first + 1e-9 && t <= skAt(24, 0) + 1e-9) {
        grid.push({ t, u: !(h === 22 && m === 30), trace: skSet(h, m, standing) });
      }
    }
    // The 8:45, kept in its place between the 8:30 and the 9:00. It is its own מנין on the
    // boards rather than one more step of the run, which is why the rule that makes the rest
    // of them the top and the bottom of the hour does not reach it.
    if (h === 20) {
      grid.push({ t: skAt(20, 45), trace: skSet(20, 45, 'a מנין of its own on the boards rather than one more step of the run') });
    }
  }
  grid.sort((a, b) => a.t - b.t);
  return [{ t: first, u: true, trace: firstT() }, ...grid.filter((g) => g.t - first >= 15 * SK_MIN - 1e-9)];
}

/* --- The schedule that starts after סוכות ---------------------------------------------
   The last block on the sheet, and the only one that is not about a day of יום טוב: the
   everyday schedule the shul goes back to once שמחת תורה is over. It is on the תשפ"ד sheet
   under this name and the shul asked for it back, worked on the same rules as the schedule
   that starts after יום כיפור rather than on the numbers that sheet happens to print.

   So the three lists come out of afterSchedule in posters/yomkippur.js, exactly as the after
   יו"כ ones do, and all this decides is which days they have to hold for. */
const SK_AFTER_FIRST = 24;  // the morning after שמחת תורה
const SK_THURSDAY = 5;      // excelWeekday: 1 = Sunday .. 7 = Shabbos

/** The days the after סוכות schedule is set by: from the first weekday after שמחת תורה to the
 *  Thursday of that same week.
 *
 *  Sunday to Thursday for the same reason the after יו"כ run counts only those: Friday and
 *  Shabbos keep schedules of their own and are not what this block is for. So in a year where
 *  שמחת תורה is the Friday, 24 תשרי is Shabbos and the run opens on the Sunday after it.
 *
 *  One week, and it is the week the wall chart gives this schedule to: the row is found by
 *  this run's first day (afterSukkosRow in sheets/weekday.js), and stopping at that week's own
 *  Thursday is what keeps the block and the row speaking for exactly the same days. Counting
 *  on to the end of תשרי pulled in the Sunday of the week after, whose row on the chart says
 *  something else, and it left the sheet claiming a day the board did not give it.
 *
 *  A week rather than everything up to the next sheet for a second reason as well: these days
 *  are getting shorter fast. שקיעה falls about a minute and a half a day through late October,
 *  so a list set by a month of them would print a last מנחה half an hour early on the first of
 *  them.
 *
 *  And it stops where the clocks do. The end of daylight saving takes שקיעה back an hour, and
 *  a year late enough for that to land inside this week would otherwise set the whole evening
 *  by a day on the other clock: a last מנחה before the 5:00 in front of it. Asked of the
 *  timezone rather than of the date, so it is the one rule the charts already run on. */
export function sukkosAfterDays(rh, settings) {
  let first = skSerial(rh, SK_AFTER_FIRST);
  while (excelWeekday(first) > SK_THURSDAY) first += 1;
  const days = [];
  const clock = Z.dstLocal(dateFromSerial(first), settings);
  for (let serial = first; excelWeekday(serial) <= SK_THURSDAY; serial += 1) {
    if (Z.dstLocal(dateFromSerial(serial), settings) !== clock) break;
    days.push(serial);
  }
  return days;
}

/** The after סוכות schedule: the same three lists as after יו"כ, bound by that week's own days. */
export function buildSukkosAfter(rh, settings) {
  const days = sukkosAfterDays(rh, settings);
  return afterSchedule(
    Math.min(...days.map((s) => skShkia(s, settings))),
    Math.max(...days.map((s) => skMinchaGedola(s, settings))),
    settings,
    // The last מנין a quarter of an hour before שקיעה, which is how the חול המועד run above it
    // on this same sheet ends and what the shul asked for here. The schedule that starts after
    // יו"כ is left as it was: it was not part of the ask, and its own sheet prints what it
    // prints today.
    { lastFifteen: true }
  );
}

/** A Shabbos that falls inside this sheet, worked the way an ordinary Shabbos of the year is.
 *
 *  Two of them can: שבת חול המועד, when one of 17 to 21 תשרי is Shabbos, and שבת בראשית, the
 *  day after שמחת תורה in a year where שמחת תורה is a Friday. The shul asked for both to be
 *  calculated like a regular Shabbos during the year, so five of the eight rows are the חורף
 *  chart's own columns for that week, read straight off buildChorefRow: שחרית (E), the מנחה
 *  menu (C), the מעריב after Shabbos (B), the later Friday מעריב (F), and הדלקת נרות with
 *  שקיעה (H's formula).
 *
 *  Two rows are the poster's rather than the chart's. The מנחה three minutes after candles is
 *  the sheet's own convention, the same one every יום טוב night here uses; and the first
 *  מעריב is twenty minutes after the printed שקיעה, a minyan the chart has no column for.
 *
 *  שבת חול המועד opens with the ערב שבת מנחה menu, because that Friday is חול המועד and the
 *  חול המועד box leaves Fridays out. שבת בראשית does not: its Friday is שמחת תורה and that
 *  block has already given the afternoon.
 *
 *  ט' שעות is the poster's as well, under the ס"ז ק"ש the chart's row does give: every Shabbos
 *  on this sheet carries it, and in a year where the Shabbosos are these two rather than
 *  יום א' and שמיני עצרת, these are the two. */
function sukkosShabbosLines(shabbosSerial, settings, bothWays, nineWays, { erevMincha = null } = {}) {
  const friday = shabbosSerial - 1;
  const row = buildChorefRow({ serial: shabbosSerial, specialParsha: '' }, settings);
  const shkia = floorToMinute(Z.sunsetElev(dateFromSerial(friday), settings));
  const candles = shkia - settings.candleLightingMinutes * SK_MIN;
  const tm = (t, underlined = false) => ({ text: formatTime(t), underlined, mark: '' });
  /* The Friday's שקיעה, printed to the whole minute, which is what the two times under it are
     measured from: the sheet's own convention, and the same number in all three places. */
  const shkiaT = () => zman('שקיעה', Z.sunsetElev(dateFromSerial(friday), settings), 'the Friday\'s own')
    .floor('the sheet prints שקיעה to the whole minute, and the times under it are measured off the printed one');
  const tmT = (trace, underlined = false) => ({ ...tm(trace.value, underlined), trace });
  const out = [];
  const candlesT = () => shkiaT().minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings');
  if (erevMincha) {
    out.push({ label: SK_TEXT.erevMinchaShabbos, times: erevMincha, calc: 'erevMincha' });
    out.push({ label: SK_TEXT.candles, times: [tmT(candlesT())], calc: 'shabbosCandles' });
    out.push({
      label: SK_TEXT.mincha,
      times: [tmT(candlesT().plus(3, 'the מנין three minutes after candles, the sheet\'s own convention'))],
      calc: 'candlesMincha',
    });
  } else {
    out.push({ label: SK_TEXT.candles, times: [tmT(candlesT())], calc: 'shabbosCandles' });
  }
  out.push({ label: SK_TEXT.shkia, times: [tmT(shkiaT())], calc: 'shabbosShkia' });
  out.push({
    label: SK_TEXT.maariv,
    times: [tmT(shkiaT().plus(20, 'the first מעריב of the night, a מנין the wall chart has no column for'))],
    calc: 'shabbosMaariv',
    /* The later Friday מעריב, the Shabbos morning, the מנחה menu and מוצאי שבת are the חורף
       chart's own columns for this week, so each carries the chart's own working rather than a
       second account of it. See chartLine in posters/chart-cell.js. */
    extra: { label: SK_TEXT.maarivSheini, times: chartLine(row.F, row.traces?.F) },
  });
  out.push({ label: SK_TEXT.shacharis, times: chartLine(row.E, row.traces?.E), calc: 'shabbosShacharis' });
  out.push({ label: SK_TEXT.krias, times: bothWays(shabbosSerial), calc: 'krias' });
  out.push({ label: SK_TEXT.nineHours, times: nineWays(shabbosSerial), calc: 'nineHours' });
  out.push({ label: SK_TEXT.mincha, times: chartLine(row.C, row.traces?.C), calc: 'shabbosMincha' });
  out.push({ label: SK_TEXT.maariv, times: chartLine(row.B, row.traces?.B), calc: 'shabbosMotzei' });
  return out;
}

/** The מנינים of one of those Shabbosos, for the card on the congregation's home page.
 *
 *  Off the same chart row and the same two poster-side rules the printed block is made of,
 *  rather than read back out of the finished lines, so the time counted down to on a phone and
 *  the time on the sheet are one number. הדלקת נרות and שקיעה are not מנינים and are not here.
 *
 *  The Friday מעריב twenty minutes after שקיעה is the only one on the Friday itself besides
 *  the ערב שבת run and the מנחה that goes with candles; the chart's F is the later one. */
function addShabbosMinyanim(M, shabbosSerial, settings, erevMincha) {
  const friday = shabbosSerial - 1;
  const row = buildChorefRow({ serial: shabbosSerial, specialParsha: '' }, settings);
  const shkia = floorToMinute(Z.sunsetElev(dateFromSerial(friday), settings));
  // הדלקת נרות of that Friday, in the זמנים list rather than among the מנינים. The Shabbosos
  // this sheet carries are weeks the charts have no row for, so without this their Friday has
  // no candle lighting anywhere. See `zman` in posters/minyanim.js.
  M.zman(friday, SK_TEXT.candles, shkia - settings.candleLightingMinutes * SK_MIN);
  if (erevMincha) {
    M.list(friday, SK_TEXT.erevMinchaShabbos, erevMincha, AFTERNOON);
    M.at(friday, SK_TEXT.mincha, shkia - settings.candleLightingMinutes * SK_MIN + 3 * SK_MIN);
  }
  M.at(friday, SK_TEXT.maariv, shkia + 20 * SK_MIN);
  M.list(friday, SK_TEXT.maariv, chartTimes(row.F), AFTERNOON);
  M.list(shabbosSerial, SK_TEXT.shacharis, chartTimes(row.E), MORNING);
  M.list(shabbosSerial, SK_TEXT.mincha, chartTimes(row.C), AFTERNOON);
  M.list(shabbosSerial, SK_TEXT.maariv, chartTimes(row.B), AFTERNOON);
}

/** The whole sheet for one year. */
export function buildSukkosPoster(year, settings) {
  if (!year) return null;
  const rh = roshHashana(year - 3761);
  const day = (n) => skSerial(rh, n);
  const shkiaOf = (n) => skShkia(day(n), settings);

  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });
  const txt = (s, underlined = false, mark = '') => ({ text: s, underlined, mark });
  /* The same two taking a traced value, so a printed line carries the working that made it,
     and one for the times this sheet simply has typed on it. See zmanim/trace.js. The `am`
     flag is not guessed: a board is a twelve hour clock with no meridiem, so both readings
     format to the same string, and only the string is ever asked of it. */
  const tmT = (trace, underlined = false, mark = '') => ({ text: trace.plain(), underlined, mark, trace });
  const txtT = (s, label, { am = false, underlined = false, mark = '' } = {}) => ({
    text: s, underlined, mark,
    trace: /^\d{1,2}:\d{2}$/.test(s) ? fixedTime(s, { am, label }) : null,
  });
  /* `wrap: true` says the label is a sentence rather than a name: a דרשה announcement, the
     שיעור, the מכירת עליות. Those are allowed to break over two lines, where every other label
     on this sheet is held whole. See .poster.is-sukkos .poster-row-label in app.css: a name
     split down the middle reads as two rows, and a sentence held whole would set the size of
     the whole sheet by itself. */
  const line = (label, times, opts = {}) => ({ label, times, ...opts });
  /* Each item's trace comes with it, and an underlined מנין says so in its working too, so the
     opened cell and the printed row cannot disagree about which בית מדרש it is in. */
  const list = (items) => items.map((x) => {
    const under = Boolean(x.u);
    const trace = x.trace && under ? x.trace.underline() : (x.trace || null);
    return { ...tm(x.t, under, x.mark || ''), trace };
  });
  // Earliest first, each time under the name of its own reckoning: see reckonings.js.
  const bothWays = (serial) => {
    const d = dateFromSerial(serial);
    const mga = zman('סוף זמן קריאת שמע מ״א', Z.sofZmanShmaMGA72(d, settings), 'the day measured from עלות 72 to צאת 72');
    const gra = zman('סוף זמן קריאת שמע גר״א', Z.sofZmanShmaGRA(d, settings), 'the day measured from sunrise to שקיעה');
    return twoReckonings(mga.value, gra.value).map((r) => ({ ...tmT(r.at === mga.value ? mga : gra), name: r.name }));
  };
  /* ט' שעות the same way, which is the point of it being the same helper: one זמן answered on
     both reckonings, each answer under its own name and the earlier of the two on the left.
     See posters/reckonings.js, where writing the pair the other way round crossed the names
     over the times for real. */
  const nineWays = (serial) => {
    const nine = nineHours(dateFromSerial(serial), settings);
    const mga = zman('ט׳ שעות מ״א', nine.mga, 'nine of the twelve seasonal hours of a day measured from עלות 72 to צאת 72');
    const gra = zman('ט׳ שעות גר״א', nine.gra, 'nine of the twelve seasonal hours of a day measured from sunrise to שקיעה');
    return twoReckonings(mga.value, gra.value).map((r) => ({ ...tmT(r.at === mga.value ? mga : gra), name: r.name }));
  };

  const M = minyanList();
  const isShabbos = (n) => excelWeekday(day(n)) === SK_SHABBOS;

  /** The evening that opens a day: candles, the מנחה three minutes after them, שקיעה, the
   *  דרשה before מעריב (see SK_DRASHA_BEFORE), and מעריב fifty minutes after שקיעה. The same
   *  five lines open יום א' and שמיני עצרת. */
  const eveningLines = (nightDay, opts = {}) => {
    const shkia = shkiaOf(nightDay);
    const candles = shkia - settings.candleLightingMinutes * SK_MIN;
    const maariv = shkia + 50 * SK_MIN;
    const on = day(nightDay);
    const shkiaT = () => skShkiaT(on, settings);
    const candlesT = () => shkiaT().minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings');
    const erevMincha = sukkosErevMincha(on, settings, { allDown: opts.allDown === true });
    const out = [
      // מנחה עיו"ט whichever day of the week it is. A year where יום א' or שמיני עצרת falls on
      // Shabbos still says עיו"ט here, which is what the תשפ"ד sheet prints on both of its
      // Shabbos days: the afternoon is ערב יום טוב first, and the Shabbos is said in the
      // heading above.
      line(SK_TEXT.erevMincha, list(erevMincha), { calc: 'erevMincha' }),
      /* The עירוב, on the afternoon it is made, after that afternoon's מנחה and before its
         candles. One rule and one shape for all three sheets: see posters/eiruv.js. */

      // הדלקת נרות, and the מנין three minutes behind it on a line of its own. The two were
      // one row for a while, the way the sheets it was ported from set them; the shul asked
      // for two, which is also how the one-page sheet has always set them.
      line(SK_TEXT.candles, [tmT(candlesT())], { calc: 'candles' }),
      line(SK_TEXT.mincha, [tmT(candlesT().plus(3, 'the מנין three minutes after candles, the sheet\'s own convention'))],
        { calc: 'candlesMincha' }),
      line(SK_TEXT.shkia, [tmT(shkiaT())], { calc: 'nightShkia' }),
    ];
    if (opts.drasha !== false) {
      /* Off the מעריב the sheet prints rather than the fraction behind it, which is why the
         rounding to the minute is a step of its own here: see SK_DRASHA_BEFORE. */
      out.push(line(SK_TEXT.drasha, [tmT(shkiaT()
        .plus(50, 'מעריב is fifty minutes after שקיעה')
        .round('to the minute the sheet prints מעריב as, which is what the דרשה is measured back from')
        .minus(SK_DRASHA_BEFORE, 'the דרשה is announced at least this long before מעריב')
        .floorToStep(5, 'announced as a round time, and down so the gap is never shorter than it was asked to be'))],
      { calc: 'drasha', wrap: true }));
    }
    out.push(line(SK_TEXT.maariv, [tmT(shkiaT().plus(50, 'מעריב is fifty minutes after שקיעה'))], { calc: 'nightMaariv' }));
    M.list(on, SK_TEXT.erevMincha, list(erevMincha), AFTERNOON);
    // A זמן rather than a מנין, so its own list: see `zman` in posters/minyanim.js.
    M.zman(on, SK_TEXT.candles, candles);
    M.at(on, SK_TEXT.mincha, candles + 3 * SK_MIN);
    M.at(on, SK_TEXT.maariv, maariv);
    return out;
  };

  /** ט' שעות, on a day of this sheet that falls on Shabbos, and nothing on one that does not.
   *  A list rather than a line so it can be spread into a block's lines either way. */
  const nineLine = (n) => (isShabbos(n)
    ? [line(SK_TEXT.nineHours, nineWays(day(n)), { calc: 'nineHours' })] : []);

  /** The morning of a יום טוב: the fixed pair, then ס"ז ק"ש both ways, and ט' שעות on a
   *  Shabbos. */
  const morningLines = (n) => [
    line(SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), { calc: 'shacharis' }),
    line(SK_TEXT.krias, bothWays(day(n)), { calc: 'krias' }),
    ...nineLine(n),
  ];

  const blocks = [];
  const heading = (name, n) => (isShabbos(n) ? [name, SK_TEXT.shabbos].join(SK_TEXT.daySep) : name);

  /** Whether an עירוב תבשילין is made before this yom tov.
   *
   *  **When any of its days is a Friday**, first or last, because that is the day Shabbos gets
   *  cooked for. This asked whether the day after the last one was Shabbos, which is the same answer
   *  for a yom tov running Thursday into Friday and the wrong one for a yom tov running Friday into
   *  Shabbos. The shul said it in those words: "eiruv tavshilin is when yomtov is on Friday,
   *  regardless if its 1st day or 2nd day of yom tov".
   *
   *  It mattered on this sheet. In a year where פסח opens on Shabbos, שביעי is the Friday and אחרון
   *  the Shabbos, so the day after אחרון is a Sunday and the old test said no: תשפ"ט, תשצ"ב, תשצ"ו
   *  and תשצ"ט all printed שביעי with no עירוב over it. The first days happen never to show the
   *  difference, since 15 ניסן and 15 תשרי can never fall on a Friday, and they are written the same
   *  way regardless so that the next reader is not left working out which of the two rules this is. */
  const isFriday = (n) => excelWeekday(day(n)) === SK_FRIDAY;
  const eiruvDay1 = eiruvMade(isFriday, SK_DAY1, SK_DAY2);
  const eiruvShmini = eiruvMade(isFriday, SK_SHMINI, SK_SIMCHAS);
  /* A different question that used to be written as the same one: whether יום ב' itself runs
     straight into Shabbos, which is what decides that its afternoon belongs to both days. It was
     an alias of eiruvDay1, and the two agree only because 15 תשרי is never a Friday. Asked on its
     own now, so that neither can quietly change the other. */
  const day2Friday = excelWeekday(day(SK_DAY2)) === SK_FRIDAY;

  /* ערב סוכות's own morning, which is not on this sheet and is on the card all the same.
     The sheet opens at that afternoon's מנחה, because the morning is an ordinary one and the
     box on the יום כיפור sheet has already said so: its שחרית runs from after יו"כ to סוכות.
     "What is on next" hands a whole day over to a sheet or to the charts and not half of each,
     so a day the sheet speaks for has to be the whole day. Left out, ערב סוכות came back with
     an afternoon and no morning at all. Read off the everyday schedule, the same call the
     after יו"כ box makes, so the card and that box cannot say different things. */
  M.list(day(SK_EREV), SK_TEXT.shacharis, everydayShacharis(), MORNING);

  // יום א'. Its afternoon opens with the early מנין in a year where it is Shabbos.
  const day1Mincha = sukkosDayMincha(day(SK_DAY1), settings, { early: isShabbos(SK_DAY1) });
  blocks.push({
    heading: heading(SK_TEXT.day1, SK_DAY1) + (eiruvDay1 ? ' · ' + EIRUV_LABEL : ''),
    lines: [
      ...eveningLines(SK_EREV, { eiruv: eiruvDay1 }),
      ...morningLines(SK_DAY1),
      line(SK_TEXT.mincha, list(day1Mincha), { calc: 'dayMincha' }),
    ],
  });
  M.list(day(SK_DAY1), SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), MORNING);
  M.list(day(SK_DAY1), SK_TEXT.mincha, list(day1Mincha), AFTERNOON);

  // יום ב'. Its night is the first day's: the שיעור, then the two מעריב, fifty and seventy two
  // minutes after שקיעה. The שיעור is twenty minutes before the first of them, on a round five.
  {
    const shkia = shkiaOf(SK_DAY1);
    const m1 = shkia + 50 * SK_MIN;
    const m2 = shkia + 72 * SK_MIN;
    const on = day(SK_DAY1);
    blocks.push({
      heading: heading(SK_TEXT.day2, SK_DAY2),
      lines: [
        line(SK_TEXT.shkia, [tmT(skShkiaT(on, settings))], { calc: 'nightShkia' }),
        line(SK_TEXT.shiur, [tmT(skShkiaT(on, settings)
          .plus(50, 'the first מעריב is fifty minutes after שקיעה')
          .minus(20, 'the שיעור is twenty minutes in front of it')
          .floorToStep(5, 'announced as a round time'))], { calc: 'shiur', wrap: true }),
        line(SK_TEXT.maariv, [
          tmT(skShkiaT(on, settings).plus(50, 'the first מעריב is fifty minutes after שקיעה')),
          tmT(skShkiaT(on, settings).plus(72, 'the second is seventy two minutes after it').underline(), true),
        ], { calc: 'twoMaariv' }),
        /* The שמחת בית השואבה, which is ליל ב' סוכות and so belongs to this night, after the
           מעריב it follows. It has a sheet of its own as well, hung where people will see it;
           here it is one row in the day it happens on rather than a block with a heading,
           which is where somebody reading the schedule would look for it.
           The name and the hour only. The street address was a second row under it and the
           shul asked for it off: the sheet of its own carries the address, and this is the
           schedule, where the line is there to say the evening is on and when. */
        line(SK_SHUAVA.title, [txtT(SK_SHUAVA.at, 'the hour the Rav sets for the evening, which does not move with the year')],
          { calc: 'shuava', wrap: true }),
        ...morningLines(SK_DAY2),
        line(SK_TEXT.mincha, list(sukkosDayMincha(day(SK_DAY2), settings)), { calc: 'dayMincha' }),
        // מוצאי יום טוב, sixty and seventy two minutes after the second day's own שקיעה, the
        // same pair and the same way round as the ראש השנה sheet's.
        //
        // Not in a year where יום ב' is a Friday: nothing goes out that evening, Shabbos comes
        // in, and the שבת חול המועד block below gives the night instead. That is how the תשפ"ה
        // sheet sets it, where the block stops at מנחה.
        day2Friday ? null
          : line(SK_TEXT.maariv, [
            tmT(skShkiaT(day(SK_DAY2), settings).plus(60, 'מוצאי יום טוב, an hour after שקיעה')),
            tmT(skShkiaT(day(SK_DAY2), settings).plus(72, 'and seventy two minutes after it').underline(), true),
          ], { calc: 'motzeiMaariv' }),
      ].filter(Boolean),
    });
    M.at(on, SK_TEXT.maariv, m1);
    M.at(on, SK_TEXT.maariv, m2, { underlined: true });
    M.list(day(SK_DAY2), SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), MORNING);
    M.list(day(SK_DAY2), SK_TEXT.mincha, list(sukkosDayMincha(day(SK_DAY2), settings)), AFTERNOON);
    if (!day2Friday) {
      M.at(day(SK_DAY2), SK_TEXT.maariv, shkiaOf(SK_DAY2) + 60 * SK_MIN);
      M.at(day(SK_DAY2), SK_TEXT.maariv, shkiaOf(SK_DAY2) + 72 * SK_MIN, { underlined: true });
    }
  }

  /* חול המועד, and the שבת among those days in the years that have one, in the order the days
     actually run.
     Which comes first moves with the year and the shul asked for it to: in תשפ"ה the Shabbos
     is 17 תשרי and the ordinary weekdays start on the 18th, and in תשפ"ו the first weekday is
     the 17th and the Shabbos is the 19th. Each block is placed by the first day it speaks
     for, so neither has to know about the other. */
  const chmDays = sukkosChmDays(rh);
  const shabbosChm = SK_CHM.map((n) => day(n)).find((s) => excelWeekday(s) === SK_SHABBOS) || null;
  const middle = [];
  /* חול המועד: the everyday mornings, the מנחה run and the מעריב run, and then הושענא רבה's
     own morning, which starts earlier than the rest and is given last. A block like the days
     rather than a ruled box at the foot of a column, which is where it was and which put the
     one part of the sheet that is a week rather than a day into a frame of its own. */
  const hoshana = day(SK_HOSHANA);
  const hoshanaTimes = [
    tmT(zman('נץ', skNetz(hoshana, settings), 'הושענא רבה\'s own sunrise')
      .minus(36, 'שחרית starts thirty six minutes in front of it')
      .round('to the minute the sheet prints')
      .underline(), true),
    ...parseTimes(SK_TEXT.hoshanaRest),
  ];
  middle.push({
    at: Math.min(...chmDays),
    heading: SK_TEXT.cholHamoed,
    lines: [
      line(SK_TEXT.shacharis, parseTimes(SK_TEXT.chmShacharis), { calc: 'chmShacharis' }),
      line(SK_TEXT.mincha, list(sukkosChmMincha(chmDays, settings)), { calc: 'chmMincha' }),
      line(SK_TEXT.maariv, list(sukkosChmMaariv(chmDays, settings)), { calc: 'chmMaariv' }),
    ],
  });
  if (shabbosChm) {
    // It opens with the ערב שבת מנחה, because that Friday is חול המועד and the חול המועד block
    // leaves Fridays out, so this is the only place that afternoon is given. Unless that
    // Friday is יום ב', in which case the block above has already given the afternoon and
    // candles are lit off a flame that has been burning since יום א'. תשפ"ה is that year, and
    // its sheet opens this block at הדלקת נרות for exactly that reason.
    const erev = shabbosChm - 1 > day(SK_DAY2) ? list(sukkosErevMincha(shabbosChm - 1, settings)) : null;
    middle.push({
      at: shabbosChm,
      heading: SK_TEXT.shabbosChm,
      lines: sukkosShabbosLines(shabbosChm, settings, bothWays, nineWays, { erevMincha: erev }),
    });
    addShabbosMinyanim(M, shabbosChm, settings, erev);
  }
  /* The mornings run on every day of חול המועד that is not Shabbos, the Friday included: the
     sheet's שחרית line covers all of them and only Shabbos has a morning of its own. The
     afternoon and the evening are the weekdays' alone, since the Friday's belong to the
     ערב שבת run in the Shabbos block above. הושענא רבה keeps its own morning either way. */
  for (const n of SK_CHM) {
    const on = day(n);
    if (excelWeekday(on) === SK_SHABBOS) continue;
    if (n === SK_HOSHANA) M.list(on, SK_TEXT.shacharis, hoshanaTimes, MORNING);
    else M.list(on, SK_TEXT.shacharis, parseTimes(SK_TEXT.chmShacharis), MORNING);
  }
  for (const s of chmDays) {
    M.list(s, SK_TEXT.mincha, list(sukkosChmMincha(chmDays, settings)), AFTERNOON);
    M.list(s, SK_TEXT.maariv, list(sukkosChmMaariv(chmDays, settings)), AFTERNOON);
  }
  blocks.push(...middle.sort((a, b) => a.at - b.at).map(({ at, ...b }) => b));

  /* הושענא רבה, which is the last day of חול המועד and does not run on its schedule: the
     משנה תורה is finished that night and the morning starts earlier than the rest of the week.
     So it is a block of its own between חול המועד and שמיני עצרת, in the order the days come.
     Its night first and its morning after, the same way round every other block on this sheet
     gathers a day. */
  blocks.push({
    heading: SK_TEXT.hoshana,
    lines: [
      // Starred, because it is in the עזרת נשים and that is what a star means on these sheets.
      // The name alone beside it: the star and the key already say where, and the row was
      // saying it twice.
      line(SK_SHUAVA.mishna, [txtT(SK_SHUAVA.mishnaAt, 'the hour the משנה תורה is finished at, which does not move with the year', { mark: '*' })],
        { calc: 'mishna', wrap: true }),
      // It has no time of its own and names the שיעור above it, so the column break may not
      // come between the two: on its own at the head of a column it is a line about nothing.
      line(SK_SHUAVA.mishnaMaariv, [], { calc: 'mishnaMaariv', wrap: true, keepUp: true }),
      // The first מנין is when שחרית starts, thirty six minutes before נץ, and נץ is printed
      // beside it so the sheet says what it was worked from.
      line(SK_TEXT.shacharis, hoshanaTimes,
        { calc: 'hoshanaShacharis', note: `(${SK_TEXT.netz} ${formatTime(skNetz(hoshana, settings))})` }),
    ],
  });

  // שמיני עצרת
  {
    const n = SK_SHMINI;
    /* Two lines, the two שחרית on one and their two יזכור on the other, read down: the 7:30
       davens יזכור at the first time and the 8:15 at the second. It was four lines, a שחרית
       and its own יזכור and then the same again, which said the pairing outright and cost
       twice the room; the shul asked for the two.

       Each יזכור keeps the mark of the מנין it belongs to. The 7:30 is the למטה מנין, so its
       יזכור is underlined too, being said where that מנין is; the 8:15's is in the main בית
       מדרש and stays plain. On Shabbos both run later, the davening being longer: 9:40 and
       10:55 against 9:10 and 10:25. */
    const yizkor = [
      line(SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), { calc: 'shacharis' }),
      line(SK_TEXT.yizkor, [
        txtT(isShabbos(n) ? SK_TEXT.yizkorShabbosEarly : SK_TEXT.yizkorEarly,
          isShabbos(n)
            ? 'announced at this time, the שבת davening running half an hour longer than a weekday יום טוב\'s'
            : 'announced at this time, and "בערך" because it is where the davening reaches rather than a זמן',
          { am: true, underlined: true }),
        txtT(isShabbos(n) ? SK_TEXT.yizkorShabbos : SK_TEXT.yizkorLate,
          isShabbos(n)
            ? 'the same for the later שחרית, likewise half an hour on'
            : 'the same for the later שחרית', { am: true }),
      ], { calc: 'yizkor' }),
    ];
    const shminiMincha = sukkosDayMincha(day(n), settings,
      { five: false, fiveIfRoom: true, early: isShabbos(n) });
    blocks.push({
      heading: heading(SK_TEXT.shmini, n) + (eiruvShmini ? ' · ' + EIRUV_LABEL : ''),
      lines: [
        /* the evening of הושענא רבה, which is the one that opens שמיני עצרת. Its whole מנחה
           run is למטה: see sukkosErevMincha. */
        ...eveningLines(SK_SHMINI - 1, { allDown: true, eiruv: eiruvShmini }),
        ...yizkor,
        line(SK_TEXT.krias, bothWays(day(n)), { calc: 'krias' }),
        ...nineLine(n),
        line(SK_TEXT.mincha, list(shminiMincha), { calc: 'shminiMincha' }),
      ],
    });
    M.list(day(n), SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), MORNING);
    M.list(day(n), SK_TEXT.mincha, list(shminiMincha), AFTERNOON);
  }

  // שמחת תורה. Its night is שמיני עצרת's, and its מעריב is sixty minutes after that שקיעה
  // rather than fifty: the מכירת עליות comes first.
  //
  // שמחת תורה can be a Friday, and then the night that closes it is Shabbos coming in rather
  // than a weekday evening. The block stops at מנחה in that year and שבת בראשית below takes
  // the evening, which is how the תשפ"ה sheet sets it.
  const bereishis = excelWeekday(day(SK_SIMCHAS)) === SK_FRIDAY ? day(SK_SIMCHAS) + 1 : null;
  {
    const nightShkia = shkiaOf(SK_SHMINI);
    const dayShkia = shkiaOf(SK_SIMCHAS);
    const on = day(SK_SHMINI);
    blocks.push({
      heading: SK_TEXT.simchas,
      lines: [
        line(SK_TEXT.shkia, [tmT(skShkiaT(on, settings))], { calc: 'nightShkia' }),
        line(SK_TEXT.mechiras, [], { calc: 'mechiras', wrap: true }),
        line(SK_TEXT.maariv, [tmT(skShkiaT(on, settings)
          .plus(60, 'an hour after שקיעה rather than the fifty minutes every other night here runs on: the מכירת עליות comes first'))],
        { calc: 'simchasMaariv' }),
        line(SK_TEXT.shacharis, parseTimes(SK_TEXT.simchasShacharis), { calc: 'simchasShacharis' }),
        line(SK_TEXT.krias, bothWays(day(SK_SIMCHAS)), { calc: 'krias' }),
        // Straight after מוסף, and then one twenty minutes before שקיעה. It was twenty two,
        // which is what the sheets it was ported from print; the shul asked for twenty.
        line(SK_TEXT.mincha, [txt(SK_TEXT.afterMusaf),
          tmT(skShkiaT(day(SK_SIMCHAS), settings)
            .minus(SK_SIMCHAS_BEFORE, 'the last מנחה of שמחת תורה is twenty minutes in front of שקיעה'))],
        { calc: 'simchasMincha', sep: ' & ' }),
        bereishis ? null
          : line(SK_TEXT.maariv, [
            tmT(skShkiaT(day(SK_SIMCHAS), settings).plus(60, 'מוצאי יום טוב, an hour after שקיעה')),
            tmT(skShkiaT(day(SK_SIMCHAS), settings).plus(72, 'and seventy two minutes after it').underline(), true),
          ], { calc: 'motzeiMaariv' }),
      ].filter(Boolean),
    });
    M.at(on, SK_TEXT.maariv, nightShkia + 60 * SK_MIN);
    M.list(day(SK_SIMCHAS), SK_TEXT.shacharis, parseTimes(SK_TEXT.simchasShacharis), MORNING);
    M.at(day(SK_SIMCHAS), SK_TEXT.mincha, dayShkia - SK_SIMCHAS_BEFORE * SK_MIN);
    if (!bereishis) {
      M.at(day(SK_SIMCHAS), SK_TEXT.maariv, dayShkia + 60 * SK_MIN);
      M.at(day(SK_SIMCHAS), SK_TEXT.maariv, dayShkia + 72 * SK_MIN, { underlined: true });
    }
  }

  /* שבת בראשית, in a year where שמחת תורה is the Friday before it. No ערב שבת מנחה and no
     מנחה three minutes after candles: that afternoon is שמחת תורה's own, and the block above
     has already given it. */
  if (bereishis) {
    blocks.push({
      heading: SK_TEXT.shabbosBereishis,
      lines: sukkosShabbosLines(bereishis, settings, bothWays, nineWays),
    });
    addShabbosMinyanim(M, bereishis, settings, null);
  }

  /* The everyday schedule that starts the morning after שמחת תורה, which is where the sheet
     ends. On the תשפ"ד sheet it is the last block of the left hand column, under the same
     name; the times are worked here rather than copied off it, on the rules the shul gave for
     the schedule that starts after יום כיפור. See buildSukkosAfter.

     Its מנינים are not gathered into M. Every other block on this sheet is a day of יום טוב
     with times of its own, and these are a week of ordinary days that the wall chart already
     carries in full: adding them here would put the same week in twice, once off the chart
     and once off a poster, with nothing to keep the two the same. */
  {
    const after = buildSukkosAfter(rh, settings);
    blocks.push({
      heading: SK_TEXT.afterTitle,
      lines: [
        line(SK_TEXT.shacharis, after.shacharis, { calc: 'afterShacharis' }),
        line(SK_TEXT.mincha, after.mincha, { calc: 'afterMincha' }),
        line(SK_TEXT.maariv, after.maariv, { calc: 'afterMaariv' }),
      ],
    });
  }

  // Every printed time on the sheet, the second half of a two-part row included: which marks
  // the key at the foot explains is a question about what is actually on the paper.
  const all = blocks.flatMap((b) => b.lines.flatMap((l) => [...l.times, ...(l.extra?.times || [])]));
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    /* From the afternoon of ערב סוכות to שמחת תורה, or the שבת בראשית after it in a year that
       has one - the last day the sheet is actually about. The schedule that starts the morning
       after שמחת תורה is printed at the foot of the same sheet (blocks.afterTitle above) so
       whoever kept it on the wall has something to read that week without a new sheet yet, and
       for a while that block's own last day was let stretch this span and so decide how long
       the sheet stayed up on the congregation's own page. Reversed for the same reason the
       יום כיפור sheet's own after-block was: it is the same week the Weekday chart already
       carries, and a page reading "Special Schedules" through a week that is not special is
       the wrong answer, whatever the printed sheet still has to say for itself. */
    span: {
      from: day(SK_EREV),
      to: bereishis || day(SK_SIMCHAS),
    },
    blocks,
    /* Every מנין on the sheet, already resolved to a day and a minute, the shape every poster
       hands back. Nothing asks for these yet: posters/day.js hands a whole day over to a sheet
       only from ערב ר"ה to the morning after יו"כ, and סוכות is outside that window, so "what
       is on next" still reads the charts through these days. They are gathered here because
       they are the same numbers the printed lines are made of, which is the only way the time
       on a phone and the time on the wall can be one thing rather than two that agree most
       years. Widening that window is a change to the congregation's home page, not to this
       sheet, and belongs with it. */
    minyanim: M.out,
    zmanim: M.zmanim,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}

/** The שמחת בית השואבה sheet.
 *
 *  A sheet of its own rather than a block, which is how the shul hangs it: nothing on it is
 *  worked out from the sun, so the only thing this builder does with the year is say which
 *  night ליל ב' סוכות actually is, so the sheet can be sorted and dated with the rest.
 *
 *  ליל ב' is the evening that opens the second day, which is the evening of the first: the
 *  same night the שיעור and the two מעריב on the main sheet belong to. */
export function buildSukkosShuavaPoster(year) {
  if (!year) return null;
  const night = skSerial(roshHashana(year - 3761), SK_DAY1);
  return {
    hebrewYear: year,
    span: { from: night, to: night },
    text: SK_SHUAVA,
    // The 8:00 is a שיעור and the מעריב after it has no clock time, so there is nothing here
    // for the card on the home page to count down to.
    minyanim: [],
    legend: [],
  };
}
