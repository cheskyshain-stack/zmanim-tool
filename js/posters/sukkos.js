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
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute, UL_START } from '../format.js';
import { SLASH } from '../util.js';
import { buildChorefRow } from '../sheets/choref.js';
import { parseTimes } from './slichos.js';
import { twoReckonings } from './reckonings.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { everydayShacharis } from './yomkippur.js';
import { openingMincha } from './early-mincha.js';

const SK_MIN = 1 / 1440;
const SK_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos
const SK_FRIDAY = 6;

/** A clock time as a day fraction. */
const skAt = (h, m) => (h * 60 + m) * SK_MIN;
/** Down to the last 5 minutes. Announced times are round, and rounding down rather than to
 *  the nearest keeps the gap the shul asked for: a דרשה half an hour before מעריב taken to
 *  the nearest five could land 28 minutes before it. */
const skDown5 = (t) => Math.floor(t * 288 + 1e-9) / 288;
/** Up to the next 5 minutes, for the one time that is announced as the head of a run rather
 *  than as a זמן of its own. */
const skUp5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;

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
  eiruv: 'עירוב תבשילין',
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
  yizkor: 'יזכור בערך',
  mechiras: 'מכירת עליות שמחת תורה קודם מעריב',
  afterMusaf: 'מיד אחר מוסף',
  shacharis: 'שחרית',
  shacharisChm: 'חול המועד',
  hoshana: 'הושענא רבה',
  netz: 'נץ',
  // The two morning runs, which do not move with the year. The everyday one is not used on
  // חול המועד: those mornings have their own three, which is what the sheet prints.
  chmShacharis: '<u>7:00</u>, 8:00, <u>8:40</u>',
  hoshanaRest: '7:30, 8:20**',
  // The יום טוב morning, the same pair on every day of the sheet.
  yomTovShacharis: '<u>7:30</u>, 8:15',
  simchasShacharis: '8:15',
  // יזכור, which is announced rather than worked out, and moves half an hour later when
  // שמיני עצרת is Shabbos: the davening runs longer.
  yizkorEarly: '9:10',
  yizkorLate: '10:25',
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
  mishna: 'משנה תורה בעזרת נשים',
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
 *  Both of the first two are למטה, the rest the main בית מדרש. */
export function sukkosErevMincha(serial, settings) {
  const first = openingMincha(skMinchaGedola(serial, settings), skAt(13, 35));
  const rest = [
    { t: skAt(13, 35), u: true }, { t: skAt(13, 50) },
    { t: skAt(14, 15) }, { t: skAt(15, 0) },
  ];
  return first === null ? rest : [{ t: first, u: true }, ...rest];
}

/** A day fraction snapped to the minute it prints as, so a comparison here and the sheet
 *  cannot disagree by a rounding. */
const skRoundPrinted = (t) => Math.round(t * 1440) / 1440;

/** The afternoon מנחה of a יום טוב: 2:00, 5:30 למטה, and the last one half an hour before that
 *  day's own שקיעה. A day that is Shabbos opens with an early one as well, held to מנחה גדולה
 *  the same way as the ערב יום טוב list, which is what the תשפ"ד sheet prints on both of its
 *  Shabbos days. */
function sukkosDayMincha(serial, settings, { five = true, fiveIfRoom = false } = {}) {
  const last = skRoundPrinted(skShkia(serial, settings) - 30 * SK_MIN);
  const out = [];
  if (excelWeekday(serial) === SK_SHABBOS) {
    const early = openingMincha(skMinchaGedola(serial, settings), skAt(14, 0));
    if (early !== null) out.push({ t: early });
  }
  out.push({ t: skAt(14, 0) });
  if (five) out.push({ t: skAt(17, 30), u: true });
  else {
    out.push({ t: skAt(17, 0), u: true });
    // שמיני עצרת opens 2:00 then 5:00, and takes a 5:30 as well when that still leaves a
    // quarter of an hour to the last מנין. The shul asked for it; the sheets it was ported
    // from print 2:00/5:00/last and leave the 5:30 out even in a year with the room.
    if (fiveIfRoom && last - skAt(17, 30) >= 15 * SK_MIN - 1e-9) out.push({ t: skAt(17, 30), u: true });
  }
  out.push({ t: last });
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
 *  earliest שקיעה of those days, so it clears on all of them. A twenty minute step that lands
 *  within a quarter of an hour of that last one is not printed: two מנינים a few minutes apart
 *  is not a choice anybody uses, which is the same ground the weekday chart drops a zman on.
 *
 *  Everything from 5:00 is למטה, and so are the 1:15 and the 1:35. */
export function sukkosChmMincha(days, settings) {
  const earliest = Math.min(...days.map((s) => skShkia(s, settings)));
  const last = skRoundPrinted(earliest - 15 * SK_MIN);
  const out = [];
  const first = openingMincha(Math.max(...days.map((s) => skMinchaGedola(s, settings))), skAt(13, 35));
  if (first !== null) out.push({ t: first, u: true });
  out.push({ t: skAt(13, 35), u: true }, { t: skAt(13, 50) });
  for (let t = skAt(17, 0); t <= last + 1e-9; t += 20 * SK_MIN) {
    if (last - t >= 15 * SK_MIN - 1e-9) out.push({ t, u: true });
  }
  out.push({ t: last, u: true });
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
  const grid = [];
  for (let h = 19; h <= 24; h++) {
    for (const m of [0, 30]) {
      const t = skAt(h, m);
      if (t > first + 1e-9 && t <= skAt(24, 0) + 1e-9) grid.push({ t, u: !(h === 22 && m === 30) });
    }
    // The 8:45, kept in its place between the 8:30 and the 9:00. It is its own מנין on the
    // boards rather than one more step of the run, which is why the rule that makes the rest
    // of them the top and the bottom of the hour does not reach it.
    if (h === 20) grid.push({ t: skAt(20, 45) });
  }
  grid.sort((a, b) => a.t - b.t);
  return [{ t: first, u: true }, ...grid.filter((g) => g.t - first >= 15 * SK_MIN - 1e-9)];
}

/** A chart cell read back as the poster's own times.
 *
 *  The wall chart writes a cell as one string: times joined with SLASH, a line break where the
 *  formula splits them in two, and a private-use character each side of a time that is למטה
 *  (UL_START, UL_END in format.js). This turns that back into the { text, underlined, mark }
 *  pieces every row on a poster is made of, so a Shabbos on this sheet can be the chart's own
 *  answer rather than a second implementation of it that drifts. */
function chartTimes(cell) {
  return String(cell ?? '')
    .split('\n').join(SLASH)
    .split(SLASH)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const bare = part.replace(/[\uE000\uE001\u00A0]/g, '').trim();
      // A star stuck to the digits is \u05D1\u05E2\u05D6\u05E8\u05EA \u05E0\u05E9\u05D9\u05DD, the same notation the charts and the other
      // posters read. None of the four columns used here carries one today; taken off rather
      // than left in the text so a column that grows one does not print "5:41*" as a time.
      const stars = (bare.match(/\*+$/) || [''])[0];
      return {
        text: bare.slice(0, bare.length - stars.length),
        underlined: part.startsWith(UL_START),
        mark: stars,
      };
    });
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
 *  block has already given the afternoon. */
function sukkosShabbosLines(shabbosSerial, settings, bothWays, { erevMincha = null } = {}) {
  const friday = shabbosSerial - 1;
  const row = buildChorefRow({ serial: shabbosSerial, specialParsha: '' }, settings);
  const shkia = floorToMinute(Z.sunsetElev(dateFromSerial(friday), settings));
  const candles = shkia - settings.candleLightingMinutes * SK_MIN;
  const tm = (t, underlined = false) => ({ text: formatTime(t), underlined, mark: '' });
  const out = [];
  if (erevMincha) {
    out.push({ label: SK_TEXT.erevMinchaShabbos, times: erevMincha, calc: 'erevMincha' });
    out.push({ label: SK_TEXT.candles, times: [tm(candles)], calc: 'shabbosCandles' });
    out.push({ label: SK_TEXT.mincha, times: [tm(candles + 3 * SK_MIN)], calc: 'candlesMincha' });
  } else {
    out.push({ label: SK_TEXT.candles, times: [tm(candles)], calc: 'shabbosCandles' });
  }
  out.push({ label: SK_TEXT.shkia, times: [tm(shkia)], calc: 'shabbosShkia' });
  out.push({
    label: SK_TEXT.maariv,
    times: [tm(shkia + 20 * SK_MIN)],
    calc: 'shabbosMaariv',
    extra: { label: SK_TEXT.maarivSheini, times: chartTimes(row.F) },
  });
  out.push({ label: SK_TEXT.shacharis, times: chartTimes(row.E), calc: 'shabbosShacharis' });
  out.push({ label: SK_TEXT.krias, times: bothWays(shabbosSerial), calc: 'krias' });
  out.push({ label: SK_TEXT.mincha, times: chartTimes(row.C), calc: 'shabbosMincha' });
  out.push({ label: SK_TEXT.maariv, times: chartTimes(row.B), calc: 'shabbosMotzei' });
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
  /* `wrap: true` says the label is a sentence rather than a name: a דרשה announcement, the
     שיעור, the מכירת עליות. Those are allowed to break over two lines, where every other label
     on this sheet is held whole. See .poster.is-sukkos .poster-row-label in app.css: a name
     split down the middle reads as two rows, and a sentence held whole would set the size of
     the whole sheet by itself. */
  const line = (label, times, opts = {}) => ({ label, times, ...opts });
  const list = (items) => items.map((x) => tm(x.t, Boolean(x.u), x.mark || ''));
  const bothWays = (serial) => twoReckonings(
    Z.sofZmanShmaMGA72(dateFromSerial(serial), settings),
    Z.sofZmanShmaGRA(dateFromSerial(serial), settings)
  ).map((r) => ({ ...tm(r.at), name: r.name }));

  const M = minyanList();
  const isShabbos = (n) => excelWeekday(day(n)) === SK_SHABBOS;

  /** The evening that opens a day: candles, the מנחה three minutes after them, שקיעה, the
   *  דרשה half an hour before מעריב taken down to a round five, and מעריב fifty minutes after
   *  שקיעה. The same five lines open יום א' and שמיני עצרת. */
  const eveningLines = (nightDay, opts = {}) => {
    const shkia = shkiaOf(nightDay);
    const candles = shkia - settings.candleLightingMinutes * SK_MIN;
    const maariv = shkia + 50 * SK_MIN;
    const on = day(nightDay);
    const out = [
      // מנחה עיו"ט whichever day of the week it is. A year where יום א' or שמיני עצרת falls on
      // Shabbos still says עיו"ט here, which is what the תשפ"ד sheet prints on both of its
      // Shabbos days: the afternoon is ערב יום טוב first, and the Shabbos is said in the
      // heading above.
      line(SK_TEXT.erevMincha, list(sukkosErevMincha(on, settings)), { calc: 'erevMincha' }),
      // הדלקת נרות, and the מנין three minutes behind it on a line of its own. The two were
      // one row for a while, the way the sheets it was ported from set them; the shul asked
      // for two, which is also how the one-page sheet has always set them.
      line(SK_TEXT.candles, [tm(candles)], { calc: 'candles' }),
      line(SK_TEXT.mincha, [tm(candles + 3 * SK_MIN)], { calc: 'candlesMincha' }),
      line(SK_TEXT.shkia, [tm(shkia)], { calc: 'nightShkia' }),
    ];
    if (opts.drasha !== false) {
      out.push(line(SK_TEXT.drasha, [tm(skDown5(maariv - 30 * SK_MIN))], { calc: 'drasha', wrap: true }));
    }
    out.push(line(SK_TEXT.maariv, [tm(maariv)], { calc: 'nightMaariv' }));
    M.list(on, SK_TEXT.erevMincha, list(sukkosErevMincha(on, settings)), AFTERNOON);
    M.at(on, SK_TEXT.mincha, candles + 3 * SK_MIN);
    M.at(on, SK_TEXT.maariv, maariv);
    return out;
  };

  /** The morning of a יום טוב: the fixed pair, then ס"ז ק"ש both ways. */
  const morningLines = (n) => [
    line(SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), { calc: 'shacharis' }),
    line(SK_TEXT.krias, bothWays(day(n)), { calc: 'krias' }),
  ];

  const blocks = [];
  const heading = (name, n, { eiruv = false } = {}) => {
    const notes = [];
    if (isShabbos(n)) notes.push(SK_TEXT.shabbos);
    if (eiruv) notes.push(SK_TEXT.eiruv);
    return notes.length ? `${name} (${notes.join(' · ')})` : name;
  };

  /* An עירוב תבשילין is made when a יום טוב runs into Shabbos, which is to say when the day
     after the second day of יום טוב is Shabbos. Both of the years that print it, תשפ"ה and one
     other, have יום א' on a Wednesday. */
  const eiruvDay1 = excelWeekday(day(SK_DAY2 + 1)) === SK_SHABBOS;
  const eiruvShmini = excelWeekday(day(SK_SIMCHAS + 1)) === SK_SHABBOS;
  // The same fact said the other way round, and the one the blocks below need: an עירוב is
  // made because יום ב' runs straight into Shabbos, so that afternoon belongs to both days.
  const day2Friday = eiruvDay1;

  /* ערב סוכות's own morning, which is not on this sheet and is on the card all the same.
     The sheet opens at that afternoon's מנחה, because the morning is an ordinary one and the
     box on the יום כיפור sheet has already said so: its שחרית runs from after יו"כ to סוכות.
     "What is on next" hands a whole day over to a sheet or to the charts and not half of each,
     so a day the sheet speaks for has to be the whole day. Left out, ערב סוכות came back with
     an afternoon and no morning at all. Taken from Settings, the same call the after יו"כ box
     makes, so the card and that box cannot say different things. */
  M.list(day(SK_EREV), SK_TEXT.shacharis, everydayShacharis(settings), MORNING);

  // יום א'
  blocks.push({
    heading: heading(SK_TEXT.day1, SK_DAY1, { eiruv: eiruvDay1 }),
    lines: [
      ...eveningLines(SK_EREV),
      ...morningLines(SK_DAY1),
      line(SK_TEXT.mincha, list(sukkosDayMincha(day(SK_DAY1), settings)), { calc: 'dayMincha' }),
    ],
  });
  M.list(day(SK_DAY1), SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), MORNING);
  M.list(day(SK_DAY1), SK_TEXT.mincha, list(sukkosDayMincha(day(SK_DAY1), settings)), AFTERNOON);

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
        line(SK_TEXT.shkia, [tm(shkia)], { calc: 'nightShkia' }),
        line(SK_TEXT.shiur, [tm(skDown5(m1 - 20 * SK_MIN))], { calc: 'shiur', wrap: true }),
        line(SK_TEXT.maariv, [tm(m1), tm(m2, true)], { calc: 'twoMaariv' }),
        /* The שמחת בית השואבה, which is ליל ב' סוכות and so belongs to this night, after the
           מעריב it follows. It has a sheet of its own as well, hung where people will see it;
           here it is two rows in the day it happens on rather than a block with a heading,
           which is where somebody reading the schedule would look for it. */
        line(SK_SHUAVA.title, [txt(SK_SHUAVA.at)], { calc: 'shuava', wrap: true }),
        line(SK_SHUAVA.where, [], { calc: 'shuavaWhere', wrap: true, ltrLabel: true }),
        ...morningLines(SK_DAY2),
        line(SK_TEXT.mincha, list(sukkosDayMincha(day(SK_DAY2), settings)), { calc: 'dayMincha' }),
        // מוצאי יום טוב, sixty and seventy two minutes after the second day's own שקיעה, the
        // same pair and the same way round as the ראש השנה sheet's.
        //
        // Not in a year where יום ב' is a Friday: nothing goes out that evening, Shabbos comes
        // in, and the שבת חול המועד block below gives the night instead. That is how the תשפ"ה
        // sheet sets it, where the block stops at מנחה.
        day2Friday ? null
          : line(SK_TEXT.maariv, [tm(shkiaOf(SK_DAY2) + 60 * SK_MIN), tm(shkiaOf(SK_DAY2) + 72 * SK_MIN, true)],
            { calc: 'motzeiMaariv' }),
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
  const hoshanaTimes = [tm(skRoundPrinted(skNetz(hoshana, settings) - 36 * SK_MIN), true),
    ...parseTimes(SK_TEXT.hoshanaRest)];
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
      lines: sukkosShabbosLines(shabbosChm, settings, bothWays, { erevMincha: erev }),
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
      // The words say so as well: that is the wording the shul's own sheet uses and it is left
      // alone, so this row says where twice over, once in words and once in the key's mark.
      line(SK_SHUAVA.mishna, [txt(SK_SHUAVA.mishnaAt, false, '*')], { calc: 'mishna', wrap: true }),
      line(SK_SHUAVA.mishnaMaariv, [], { calc: 'mishnaMaariv', wrap: true }),
      // The first מנין is when שחרית starts, thirty six minutes before נץ, and נץ is printed
      // beside it so the sheet says what it was worked from.
      line(SK_TEXT.shacharis, hoshanaTimes,
        { calc: 'hoshanaShacharis', note: `(${SK_TEXT.netz} ${formatTime(skNetz(hoshana, settings))})` }),
    ],
  });

  // שמיני עצרת
  {
    const n = SK_SHMINI;
    const yizkor = isShabbos(n)
      // On Shabbos the davening runs longer and there is one יזכור, half an hour later than
      // the second of the two an ordinary year prints.
      ? [line(SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), { calc: 'shacharis' }),
        line(SK_TEXT.yizkor, [txt(SK_TEXT.yizkorShabbos)], { calc: 'yizkor' })]
      // Otherwise each שחרית carries its own, which is how the sheet sets them.
      : [line(SK_TEXT.shacharis, [txt('7:30', true)],
        { calc: 'shacharis', extra: { label: SK_TEXT.yizkor, times: [txt(SK_TEXT.yizkorEarly)] } }),
      line(SK_TEXT.shacharis, [txt('8:15')],
        { calc: 'shacharis', extra: { label: SK_TEXT.yizkor, times: [txt(SK_TEXT.yizkorLate)] } })];
    blocks.push({
      heading: heading(SK_TEXT.shmini, n, { eiruv: eiruvShmini }),
      lines: [
        // the evening of הושענא רבה, which is the one that opens שמיני עצרת
        ...eveningLines(SK_SHMINI - 1),
        ...yizkor,
        line(SK_TEXT.krias, bothWays(day(n)), { calc: 'krias' }),
        line(SK_TEXT.mincha, list(sukkosDayMincha(day(n), settings, { five: false, fiveIfRoom: true })),
          { calc: 'shminiMincha' }),
      ],
    });
    M.list(day(n), SK_TEXT.shacharis, parseTimes(SK_TEXT.yomTovShacharis), MORNING);
    M.list(day(n), SK_TEXT.mincha,
      list(sukkosDayMincha(day(n), settings, { five: false, fiveIfRoom: true })), AFTERNOON);
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
        line(SK_TEXT.shkia, [tm(nightShkia)], { calc: 'nightShkia' }),
        line(SK_TEXT.mechiras, [], { calc: 'mechiras', wrap: true }),
        line(SK_TEXT.maariv, [tm(nightShkia + 60 * SK_MIN)], { calc: 'simchasMaariv' }),
        line(SK_TEXT.shacharis, parseTimes(SK_TEXT.simchasShacharis), { calc: 'simchasShacharis' }),
        line(SK_TEXT.krias, bothWays(day(SK_SIMCHAS)), { calc: 'krias' }),
        // Straight after מוסף, and then one twenty two minutes before שקיעה.
        line(SK_TEXT.mincha, [txt(SK_TEXT.afterMusaf), tm(dayShkia - 22 * SK_MIN)],
          { calc: 'simchasMincha', sep: ' & ' }),
        bereishis ? null
          : line(SK_TEXT.maariv, [tm(dayShkia + 60 * SK_MIN), tm(dayShkia + 72 * SK_MIN, true)],
            { calc: 'motzeiMaariv' }),
      ].filter(Boolean),
    });
    M.at(on, SK_TEXT.maariv, nightShkia + 60 * SK_MIN);
    M.list(day(SK_SIMCHAS), SK_TEXT.shacharis, parseTimes(SK_TEXT.simchasShacharis), MORNING);
    M.at(day(SK_SIMCHAS), SK_TEXT.mincha, dayShkia - 22 * SK_MIN);
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
      lines: sukkosShabbosLines(bereishis, settings, bothWays),
    });
    addShabbosMinyanim(M, bereishis, settings, null);
  }

  // Every printed time on the sheet, the second half of a two-part row included: which marks
  // the key at the foot explains is a question about what is actually on the paper.
  const all = blocks.flatMap((b) => b.lines.flatMap((l) => [...l.times, ...(l.extra?.times || [])]));
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    // From the afternoon of ערב סוכות to the last day the sheet gives, which is שמחת תורה
    // most years and the שבת בראשית after it in a year that has one.
    span: { from: day(SK_EREV), to: bereishis || day(SK_SIMCHAS) },
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
