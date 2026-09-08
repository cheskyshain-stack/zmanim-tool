// The פסח sheet: ליל בדיקת חמץ, ערב פסח, the two days, חול המועד, a שבת חול המועד where there
// is one, שביעי של פסח and אחרון של פסח.
//
// Ported off five sheets the shul hung, תשפ"ב through תשפ"ו, which between them cover every
// shape this sheet takes: a ערב פסח on a Friday and on a Shabbos, a יום א' on Shabbos, a
// שביעי on Shabbos, an אחרון on Shabbos, a שבת חול המועד early in the week and late in it, and
// two years with an עירוב תבשילין. Where those sheets disagree with each other the later year
// wins, which is what the shul asked for; where they disagree with a rule, the rule is here and
// the difference is written down beside it.
//
// The marks are this project's, not the old sheets'. Those used * for בעזרת נשים and ** for
// בית מדרש למטה; here plain is the main בית מדרש, an underline is למטה and * is בעזר״נ. Same
// translation the ראש השנה, יום כיפור and סוכות sheets already make, so somebody holding this
// and the board is reading one set of marks.
import { roshHashana, excelWeekday, hebrewDateExtended } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute, roundToMinute, UL_START } from '../format.js';
import { SLASH } from '../util.js';
import { buildKayitzRow, earlyMinchaPlag, hasEarlyPlag } from '../sheets/kayitz.js';
import { parseTimes } from './slichos.js';
import { twoReckonings } from './reckonings.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { everydayShacharis } from './yomkippur.js';
import { chartTimes } from './chart-cell.js';

const PS_MIN = 1 / 1440;
const PS_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos
const PS_FRIDAY = 6;

/** A clock time as a day fraction. */
const psAt = (h, m) => (h * 60 + m) * PS_MIN;
/** Down to the last 5 minutes, up to the next, and to the nearest. Announced times are round
 *  fives; which way each one goes is said where it is used. */
const psDown5 = (t) => Math.floor(t * 288 + 1e-9) / 288;
const psUp5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;
const psNear5 = (t) => Math.round(t * 288) / 288;
/** A day fraction snapped to the minute it prints as, so a comparison here and the sheet
 *  cannot disagree by a rounding. */
const psPrinted = (t) => Math.round(t * 1440) / 1440;

/** Which day of ניסן each part of the sheet is. */
const PS_BEDIKA = 13;    // the night bedikas chometz is on, in a year where 14 is not Shabbos
const PS_EREV = 14;
const PS_DAY1 = 15;
const PS_DAY2 = 16;
const PS_CHM = [17, 18, 19, 20];  // חול המועד
const PS_SHVII = 21;
const PS_ACHRON = 22;

/** How long before מעריב the דרשה of the first night is announced, in minutes.
 *
 *  The same rule and the same number the סוכות sheet's דרשה runs on: the announced time is a
 *  round five and מעריב is not, so the gap cannot be one number, and taking it off 28 puts it
 *  between 28 and 32. The five sheets this was ported from range from 28 to 33, hand-typed and
 *  not self-consistent. */
const PS_DRASHA_BEFORE = 28;

/** How long before שקיעה the last מנחה of a יום טוב day is, and how long before שקיעה נעילת החג
 *  is on אחרון של פסח.
 *
 *  Both were asked for. The five sheets put the last מנחה anywhere from 15 to 29 minutes before
 *  שקיעה and נעילה from 39 to 53, neither following any rule; half an hour is what the סוכות
 *  sheet already uses for a יום טוב afternoon, and נעילה is three quarters of an hour announced
 *  on the nearest five. */
const PS_LAST_MINCHA = 30;
const PS_NEILA_BEFORE = 45;

const psSerial = (rh, day) => rh + day - 1;
const psShkia = (serial, settings) => Z.sunsetElev(dateFromSerial(serial), settings);

/** 15 ניסן of a Hebrew year, as a serial.
 *
 *  Found by walking rather than by a formula, because the calendar's own month arithmetic is
 *  what says where ניסן starts and a leap year moves it by a month. The walk opens five months
 *  after ר"ה and gives up after eight, so it is a few dozen turns and never runs away. */
export function pesachSerial(year) {
  const rh = roshHashana(year - 3761);
  for (let serial = rh + 150; serial <= rh + 240; serial += 1) {
    const hd = hebrewDateExtended(serial);
    // month 1 is ניסן in the workbook's own numbering: Nissan=1 .. Elul=6, Tishrei=7 .. Adar=12.
    if (hd.month === 1 && hd.dayOfMonth === 15 && hd.year === year) return serial;
  }
  return null;
}

/** The wording, and the times the shul sets by hand rather than by the sun. */
export const PS_TEXT = {
  title: 'פסח',
  bedika: 'ליל בדיקת חמץ',
  erev: 'ערב פסח',
  day1: "יום א'",
  day2: "יום ב'",
  cholHamoed: 'חול המועד',
  shabbosChm: 'שבת חול המועד',
  shvii: 'שביעי של פסח',
  achron: 'אחרון של פסח',
  // What a heading adds when the day is Shabbos, or when an עירוב תבשילין is made that
  // afternoon. Said the ראש השנה sheet's way, after a dot rather than in brackets: the heading
  // is underlined and an underline running under a bracket reads as though it is cutting
  // through it.
  shabbos: 'שבת',
  eiruv: 'עירוב תבשילין',
  daySep: ' · ',
  shirHashirim: 'שיר השירים',

  maariv: 'מעריב',
  maarivLmata: "מעריב ג'",
  shacharis: 'שחרית',
  mincha: 'מנחה',
  erevMincha: 'מנחה עיו"ט',
  erevMinchaShabbos: 'מנחה ערב שבת',
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
  drasha: 'דרשה מאת הרב שליט"א',
  shiur: 'שיעור בעניני החג מאחד מבני החבורה',
  krias: 'ס"ז ק"ש',
  chatzos: 'חצות הלילה',
  tzais: 'צאת הכוכבים',
  yizkor: 'יזכור בערך',
  neila: 'נעילת החג',
  achila: 'סוף זמן אכילת חמץ',
  biur: 'סוף זמן ביעור חמץ',
  /* Said beside the word מעריב rather than under the times: it is a note about that מנין, not
     a time of its own. It goes on the first מעריב after the two first days that is not a יום
     טוב, which is מוצאי יום ב' in most years and מוצאי שבת in a year where יום ב' is a Friday.
     Only that one: the sheets it was ported from print it once. */
  vsenBracha: 'מתחילין לומר ותן ברכה',
  /* The early מנחה and פלג, off the קיץ chart's own columns I, J and K. The shul asked for them
     on שבת חול המועד and on שביעי של פסח, which are the two nights of this sheet a person can
     bring in early from a weekday. One line a column: the label names the מנחה and the פלג it
     is a quarter of an hour before, the reckoning's own name after it, and the two times in the
     same order the label reads. */
  earlyMincha: 'מנחה / פלג',

  // The two morning runs, which do not move with the year.
  // The יום טוב morning of the first days, and of שביעי and אחרון, which is the ordinary
  // Shabbos pair. Both are on all five sheets and do not move.
  yomTovShacharis: '<u>8:00</u>, 8:55',
  lastDaysShacharis: '<u>7:30</u>, 8:15',
  // חול המועד's three, which are the same three the סוכות sheet's חול המועד prints.
  chmShacharis: '<u>7:00</u>, 8:00, <u>8:40</u>',
  // The fixed מנחה of a יום טוב afternoon, in front of the one worked from שקיעה. All five
  // sheets carry these three and mark them this way round; only a 6:30 between the 6:00 and the
  // last one moves, and it is on two of the five, so it is left off. The סוכות sheet's own
  // afternoon is 2:00 and 5:30 with no 6:00 and the marks the other way round, which is why
  // this is written out here rather than shared with it.
  dayMincha: '<u>2:00</u>, 5:30, <u>6:00</u>',
  // The afternoon before a יום טוב. No 1:15 or 1:20 the way the סוכות sheet opens: חצות is an
  // hour later in ניסן, so מנחה גדולה lands around 1:30 and 1:35 is the first that clears it on
  // every one of these days. Measured across תשפ"ב to תשפ"ו: מנחה גדולה לחומרא runs 1:29 to
  // 1:31 on ערב פסח, ערב שביעי and ערב אחרון in all five.
  erevMincha4: '<u>1:35</u>, 1:50, 2:15, 3:00',
  // The bedika night's second מעריב, which is announced and does not move.
  bedikaLate: '<u>10:30</u>',
  // יזכור on אחרון, announced rather than worked out. 10:20 on four of the five sheets and
  // 10:40 on תשפ"ב alone, so 10:20 it is.
  yizkorAt: '10:20',
};

/** The מנחה run of a יום טוב afternoon: the three fixed ones, then the last worked from that
 *  day's own שקיעה. */
function pesachDayMincha(serial, settings) {
  return [...parseTimes(PS_TEXT.dayMincha),
    { text: formatTime(psPrinted(psShkia(serial, settings) - PS_LAST_MINCHA * PS_MIN)),
      underlined: false, mark: '' }];
}

/** The חול המועד days that keep the everyday schedule: not Shabbos, and not a Friday, which
 *  runs on an ערב שבת one. They are what the block's own times are set by. */
export function pesachChmDays(rh) {
  return PS_CHM.map((n) => psSerial(rh, n))
    .filter((s) => excelWeekday(s) !== PS_SHABBOS && excelWeekday(s) !== PS_FRIDAY);
}

/** The חול המועד מנחה run.
 *
 *  1:35, 1:50 and 4:15 to open, then from 6:00 every twenty minutes, and last a מנין a quarter
 *  of an hour before the earliest שקיעה of those days so it clears on all of them, taken down to
 *  a round five. A twenty minute step landing within a quarter of an hour of that last one is
 *  not printed, and where dropping it leaves more than twenty minutes with nothing in them one
 *  goes back in. The same shape as the סוכות sheet's חול המועד run, which the shul settled.
 *
 *  Everything is למטה except the 1:50, as on all five sheets. */
export function pesachChmMincha(days, settings) {
  const earliest = Math.min(...days.map((s) => psShkia(s, settings)));
  const last = psDown5(earliest - 15 * PS_MIN);
  const out = [{ t: psAt(13, 35), u: true }, { t: psAt(13, 50) }, { t: psAt(16, 15), u: true }];
  const run = [];
  for (let t = psAt(18, 0); t <= last + 1e-9; t += 20 * PS_MIN) {
    if (last - t >= 15 * PS_MIN - 1e-9) run.push(t);
  }
  const before = run.length ? run[run.length - 1] : psAt(16, 15);
  if (last - before > 20 * PS_MIN + 1e-9) {
    const fill = [20, 15].map((m) => last - m * PS_MIN)
      .find((t) => t - before >= 15 * PS_MIN - 1e-9);
    if (fill !== undefined) run.push(fill);
  }
  for (const t of run) out.push({ t, u: true });
  out.push({ t: last, u: true });
  return out;
}

/** The חול המועד מעריב run.
 *
 *  The first is fifty minutes after the latest שקיעה of those days, so it clears on all of them,
 *  taken up to the next five. After that the list is fixed and does not move: 8:45, then 9:30
 *  and the top and the bottom of every hour to 12:00. All five sheets print exactly those, and
 *  none of them has a 9:00 in it, which is why this is a written list rather than the grid the
 *  סוכות sheet builds: that one steps every half hour from the first and does carry a 9:00.
 *  The 12:00 is on the two later sheets and not the three older ones, so it is in.
 *
 *  A time within a quarter of an hour of the first is not printed, which in a year with a late
 *  שקיעה takes the 8:45 off.
 *
 *  Everything is למטה except the 8:45 and the 10:30, the same way round as the weekday chart
 *  and as all five sheets have it. */
const PS_CHM_MAARIV = [[20, 45, false], [21, 30, true], [22, 0, true], [22, 30, false],
  [23, 0, true], [23, 30, true], [24, 0, true]];
export function pesachChmMaariv(days, settings) {
  const latest = Math.max(...days.map((s) => psShkia(s, settings)));
  const first = psUp5(latest + 50 * PS_MIN);
  return [{ t: first, u: true },
    ...PS_CHM_MAARIV.map(([h, m, u]) => ({ t: psAt(h, m), u }))
      .filter((g) => g.t - first >= 15 * PS_MIN - 1e-9)];
}

/** The whole sheet for one year. */
export function buildPesachPoster(year, settings) {
  if (!year) return null;
  const pesach = pesachSerial(year);
  if (!pesach) return null;
  const rh = pesach - PS_DAY1 + 1;   // the serial 1 ניסן would have, so psSerial still works
  const day = (n) => psSerial(rh, n);
  const shkiaOf = (n) => psShkia(day(n), settings);
  const isShabbos = (n) => excelWeekday(day(n)) === PS_SHABBOS;

  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });
  const txt = (s, underlined = false, mark = '') => ({ text: s, underlined, mark });
  const line = (label, times, opts = {}) => ({ label, times, ...opts });
  const list = (items) => items.map((x) => tm(x.t, Boolean(x.u), x.mark || ''));

  const bothWays = (serial) => twoReckonings(
    Z.sofZmanShmaMGA72(dateFromSerial(serial), settings),
    Z.sofZmanShmaGRA(dateFromSerial(serial), settings)
  ).map((r) => ({ ...tm(r.at), name: r.name }));
  /** חצות הלילה of the night that opens a day, which is what the seder is timed against.
   *  Solar noon of that night's own day plus twelve hours. */
  const chatzosLine = (nightDay) => line(PS_TEXT.chatzos,
    [tm(Z.solarNoon(dateFromSerial(day(nightDay)), settings) + 0.5)], { calc: 'chatzos' });

  const M = minyanList();
  const blocks = [];
  const heading = (name, n, { eiruv = false, note = '' } = {}) => {
    const notes = [];
    if (isShabbos(n)) notes.push(PS_TEXT.shabbos);
    if (note) notes.push(note);
    if (eiruv) notes.push(PS_TEXT.eiruv);
    return [name, ...notes].join(PS_TEXT.daySep);
  };

  /* An עירוב תבשילין is made when a יום טוב runs into Shabbos, which is to say when the day
     after the second day of יום טוב is Shabbos, and again when the day after שביעי is. */
  const eiruvDay1 = excelWeekday(day(PS_DAY2 + 1)) === PS_SHABBOS;
  const eiruvShvii = excelWeekday(day(PS_ACHRON + 1)) === PS_SHABBOS;

  /* Where ותן ברכה is said for the first time. In most years יום ב' goes out into a weekday
     night and its own מוצאי is the first מעריב that is neither יום טוב nor שבת. In a year where
     יום ב' is a Friday there is no such מעריב that evening at all: Shabbos comes straight in,
     and the first one is מוצאי שבת חול המועד. */
  const day2Friday = excelWeekday(day(PS_DAY2)) === PS_FRIDAY;

  /* --- ליל בדיקת חמץ ------------------------------------------------------------------
     The night of the 14th, which is the evening at the end of the 13th, and the Thursday night
     before in a year where the 14th is Shabbos: nothing is searched on Shabbos itself and the
     search is brought forward. Its מעריב is fifty minutes after that evening's שקיעה, and the
     10:30 after it is announced and does not move. */
  const bedikaOn = excelWeekday(day(PS_EREV)) === PS_SHABBOS
    ? day(PS_BEDIKA) - 1 : day(PS_BEDIKA);
  blocks.push({
    at: bedikaOn,
    heading: PS_TEXT.bedika,
    lines: [line(PS_TEXT.maariv,
      [tm(psShkia(bedikaOn, settings) + 50 * PS_MIN), ...parseTimes(PS_TEXT.bedikaLate)],
      { calc: 'bedikaMaariv' })],
  });
  M.at(bedikaOn, PS_TEXT.maariv, psShkia(bedikaOn, settings) + 50 * PS_MIN);
  M.list(bedikaOn, PS_TEXT.maariv, parseTimes(PS_TEXT.bedikaLate), AFTERNOON);

  /* --- ערב פסח -------------------------------------------------------------------------
     The morning is the everyday one out of Settings, so the sheet and the boards cannot drift.
     The two זמנים are on the מגן אברהם's hours, counted from עלות 72 to צאת 72: measured against
     all five sheets, the מ"א's fourth and fifth hours reproduce every one of their printed
     numbers to the minute, and the גר"א's are a good twenty minutes later than any of them. */
  {
    const on = day(PS_EREV);
    const d = dateFromSerial(on);
    const alos = Z.alos72(d, settings);
    const hour = (Z.tzais72(d, settings) - alos) / 12;
    const erevShabbos = excelWeekday(on) === PS_SHABBOS;
    blocks.push({
      at: on,
      heading: heading(PS_TEXT.erev, PS_EREV),
      lines: [
        line(PS_TEXT.shacharis, everydayShacharis(settings), { calc: 'erevShacharis' }),
        line(PS_TEXT.achila, [tm(alos + 4 * hour)], { calc: 'achila' }),
        line(PS_TEXT.biur, [tm(alos + 5 * hour)], { calc: 'biur' }),
        // The afternoon is the ערב יום טוב run, and on a year where ערב פסח is Shabbos there is
        // no such run: that afternoon is Shabbos's own and the board carries it.
        erevShabbos ? null
          : line(PS_TEXT.erevMincha, parseTimes(PS_TEXT.erevMincha4), { calc: 'erevMincha' }),
      ].filter(Boolean),
    });
    M.list(on, PS_TEXT.shacharis, everydayShacharis(settings), MORNING);
    if (!erevShabbos) M.list(on, PS_TEXT.erevMincha, parseTimes(PS_TEXT.erevMincha4), AFTERNOON);
  }

  /** The evening that opens a day: candles, the מנחה three minutes after them, שקיעה, and
   *  מעריב fifty minutes after שקיעה, with a דרשה before it on the first night only. The same
   *  five lines the סוכות sheet's evenings are made of. */
  const eveningLines = (nightDay, { drasha = false } = {}) => {
    const shkia = shkiaOf(nightDay);
    const candles = shkia - settings.candleLightingMinutes * PS_MIN;
    const maariv = shkia + 50 * PS_MIN;
    const on = day(nightDay);
    const out = [
      line(PS_TEXT.candles, [tm(candles)], { calc: 'candles' }),
      line(PS_TEXT.mincha, [tm(candles + 3 * PS_MIN)], { calc: 'candlesMincha' }),
      line(PS_TEXT.shkia, [tm(shkia)], { calc: 'nightShkia' }),
    ];
    if (drasha) {
      out.push(line(PS_TEXT.drasha,
        [tm(psDown5(roundToMinute(maariv) - PS_DRASHA_BEFORE * PS_MIN))], { calc: 'drasha', wrap: true }));
    }
    out.push(line(PS_TEXT.maariv, [tm(maariv)], { calc: 'nightMaariv',
      note: `(${PS_TEXT.tzais} ${formatTime(shkia + 72 * PS_MIN)})` }));
    M.at(on, PS_TEXT.mincha, candles + 3 * PS_MIN);
    M.at(on, PS_TEXT.maariv, maariv);
    return out;
  };

  /** The three early מנחה and פלג pairs of an evening a person can bring in early from a
   *  weekday, off the קיץ chart's own columns: see earlyMinchaPlag in sheets/kayitz.js.
   *
   *  Earliest first, which is the chart's columns read backwards: the board sets them out
   *  left to right and a poster reads down the evening in the order it happens. The מנין
   *  carries the mark, the פלג does not, it being a זמן and not a place to daven. Nothing at
   *  all outside the window the chart prints them in, which פסח is always inside. */
  const earlyLines = (friday) => (hasEarlyPlag(friday, settings)
    ? earlyMinchaPlag(dateFromSerial(friday), settings).reverse().map((e) => {
      // The מנחה is a מנין; the פלג beside it is the זמן it is set against and is not one.
      M.at(friday, PS_TEXT.mincha, e.mincha, { underlined: e.underlined, mark: e.mark });
      return line(`${PS_TEXT.earlyMincha} ${e.name}`,
        [tm(e.mincha, e.underlined, e.mark), tm(e.plag)], { calc: 'earlyMincha' });
    })
    : []);

  /** The morning of a day of this sheet: the fixed pair and ס"ז ק"ש both ways. No ט' שעות,
   *  which the ראש השנה and סוכות sheets print on their Shabbosos: the shul asked for it off
   *  this one. */
  const morningLines = (n, times) => [
    line(PS_TEXT.shacharis, parseTimes(times), { calc: 'shacharis' }),
    line(PS_TEXT.krias, bothWays(day(n)), { calc: 'krias' }),
  ];

  // יום א'
  blocks.push({
    at: day(PS_DAY1),
    heading: heading(PS_TEXT.day1, PS_DAY1, { eiruv: eiruvDay1 }),
    lines: [
      ...eveningLines(PS_EREV, { drasha: true }),
      chatzosLine(PS_EREV),
      ...morningLines(PS_DAY1, PS_TEXT.yomTovShacharis),
      line(PS_TEXT.mincha, pesachDayMincha(day(PS_DAY1), settings), { calc: 'dayMincha' }),
    ],
  });
  M.list(day(PS_DAY1), PS_TEXT.shacharis, parseTimes(PS_TEXT.yomTovShacharis), MORNING);
  M.list(day(PS_DAY1), PS_TEXT.mincha, pesachDayMincha(day(PS_DAY1), settings), AFTERNOON);

  // יום ב'. Its night is the first day's: שקיעה, the שיעור, מעריב, and the מעריב למטה seventy
  // two minutes after שקיעה, which is צאת הכוכבים.
  {
    const shkia = shkiaOf(PS_DAY1);
    const maariv = shkia + 50 * PS_MIN;
    const on = day(PS_DAY1);
    blocks.push({
      at: day(PS_DAY2),
      heading: heading(PS_TEXT.day2, PS_DAY2),
      lines: [
        line(PS_TEXT.shkia, [tm(shkia)], { calc: 'nightShkia' }),
        line(PS_TEXT.shiur, [tm(psDown5(roundToMinute(maariv) - 20 * PS_MIN))], { calc: 'shiur', wrap: true }),
        line(PS_TEXT.maariv, [tm(maariv)], { calc: 'nightMaariv',
          note: `(${PS_TEXT.tzais} ${formatTime(shkia + 72 * PS_MIN)})` }),
        line(PS_TEXT.maarivLmata, [tm(shkia + 72 * PS_MIN, true)], { calc: 'maarivLmata' }),
        chatzosLine(PS_DAY1),
        ...morningLines(PS_DAY2, PS_TEXT.yomTovShacharis),
        line(PS_TEXT.mincha, pesachDayMincha(day(PS_DAY2), settings), { calc: 'dayMincha' }),
        // מוצאי יום טוב, sixty and seventy two minutes after the second day's own שקיעה. Not in
        // a year where יום ב' is a Friday: nothing goes out that evening, Shabbos comes in, and
        // the שבת חול המועד block gives the night instead.
        day2Friday ? null
          : line(PS_TEXT.maariv,
            [tm(shkiaOf(PS_DAY2) + 60 * PS_MIN), tm(shkiaOf(PS_DAY2) + 72 * PS_MIN, true)],
            { calc: 'motzeiMaariv', sub: PS_TEXT.vsenBracha }),
      ].filter(Boolean),
    });
    M.at(on, PS_TEXT.maariv, maariv);
    M.at(on, PS_TEXT.maarivLmata, shkia + 72 * PS_MIN, { underlined: true });
    M.list(day(PS_DAY2), PS_TEXT.shacharis, parseTimes(PS_TEXT.yomTovShacharis), MORNING);
    M.list(day(PS_DAY2), PS_TEXT.mincha, pesachDayMincha(day(PS_DAY2), settings), AFTERNOON);
    if (!day2Friday) {
      M.at(day(PS_DAY2), PS_TEXT.maariv, shkiaOf(PS_DAY2) + 60 * PS_MIN);
      M.at(day(PS_DAY2), PS_TEXT.maariv, shkiaOf(PS_DAY2) + 72 * PS_MIN, { underlined: true });
    }
  }

  /* חול המועד, and the שבת among those days, each placed by the first day it speaks for so
     neither has to know about the other. Three lines rather than a ruled box at the foot: the
     shul asked for no box on this sheet. */
  const chmDays = pesachChmDays(rh);
  if (chmDays.length) {
    blocks.push({
      at: Math.min(...chmDays),
      heading: PS_TEXT.cholHamoed,
      lines: [
        line(PS_TEXT.shacharis, parseTimes(PS_TEXT.chmShacharis), { calc: 'chmShacharis' }),
        line(PS_TEXT.mincha, list(pesachChmMincha(chmDays, settings)), { calc: 'chmMincha' }),
        line(PS_TEXT.maariv, list(pesachChmMaariv(chmDays, settings)), { calc: 'chmMaariv' }),
      ],
    });
    for (const s of chmDays) {
      M.list(s, PS_TEXT.shacharis, parseTimes(PS_TEXT.chmShacharis), MORNING);
      M.list(s, PS_TEXT.mincha, list(pesachChmMincha(chmDays, settings)), AFTERNOON);
      M.list(s, PS_TEXT.maariv, list(pesachChmMaariv(chmDays, settings)), AFTERNOON);
    }
  }

  /* שבת חול המועד, worked off the שבת קיץ chart's own columns the way the סוכות sheet works
     its Shabbosos: the shul asked for those to be calculated like a regular Shabbos of the
     year, and this is the same call. It opens with the ערב שבת מנחה menu unless that Friday is
     יום ב', whose own block has already given the afternoon. */
  const shabbosChm = PS_CHM.map((n) => day(n)).find((s) => excelWeekday(s) === PS_SHABBOS);
  if (shabbosChm) {
    const friday = shabbosChm - 1;
    /* The קיץ chart's row, not the חורף one. פסח is inside the spring clock window, so the
       board for that week is a קיץ row whatever season the saved sheet says (see rowFor in
       sheets/rows.js), and this Shabbos should be the board's own answer. */
    const row = buildKayitzRow({ serial: shabbosChm, specialParsha: '' }, settings);
    const shkia = floorToMinute(Z.sunsetElev(dateFromSerial(friday), settings));
    const candles = shkia - settings.candleLightingMinutes * PS_MIN;
    const erev = friday > day(PS_DAY2);
    const lines = [];
    if (erev) {
      lines.push(line(PS_TEXT.erevMinchaShabbos, parseTimes(PS_TEXT.erevMincha4), { calc: 'erevMincha' }));
    }
    // Only where that Friday is an ordinary weekday. In a year where יום ב' is the Friday
    // there is nothing to bring in early from: the day is already יום טוב.
    if (erev) lines.push(...earlyLines(friday));
    lines.push(line(PS_TEXT.candles, [tm(candles)], { calc: 'shabbosCandles' }));
    if (erev) lines.push(line(PS_TEXT.mincha, [tm(candles + 3 * PS_MIN)], { calc: 'candlesMincha' }));
    lines.push(line(PS_TEXT.shkia, [tm(shkia)], { calc: 'shabbosShkia' }));
    lines.push(line(PS_TEXT.maariv, [tm(shkia + 20 * PS_MIN)], { calc: 'shabbosMaariv',
      extra: { label: PS_TEXT.maarivLmata, times: chartTimes(row.F) } }));
    lines.push(line(PS_TEXT.shacharis, chartTimes(row.E), { calc: 'shabbosShacharis' }));
    lines.push(line(PS_TEXT.krias, bothWays(shabbosChm), { calc: 'krias' }));
    lines.push(line(PS_TEXT.mincha, chartTimes(row.C), { calc: 'shabbosMincha' }));
    lines.push(line(PS_TEXT.maariv, chartTimes(row.B), { calc: 'shabbosMotzei',
      ...(day2Friday ? { sub: PS_TEXT.vsenBracha } : {}) }));
    blocks.push({
      at: shabbosChm,
      heading: [PS_TEXT.shabbosChm, PS_TEXT.shirHashirim].join(PS_TEXT.daySep),
      lines,
    });
    if (erev) {
      M.list(friday, PS_TEXT.erevMinchaShabbos, parseTimes(PS_TEXT.erevMincha4), AFTERNOON);
      M.at(friday, PS_TEXT.mincha, candles + 3 * PS_MIN);
    }
    M.at(friday, PS_TEXT.maariv, shkia + 20 * PS_MIN);
    M.list(friday, PS_TEXT.maariv, chartTimes(row.F), AFTERNOON);
    M.list(shabbosChm, PS_TEXT.shacharis, chartTimes(row.E), MORNING);
    M.list(shabbosChm, PS_TEXT.mincha, chartTimes(row.C), AFTERNOON);
    M.list(shabbosChm, PS_TEXT.maariv, chartTimes(row.B), AFTERNOON);
  }

  // שביעי של פסח. Its night is 20 ניסן's evening.
  {
    const n = PS_SHVII;
    const erevShabbos = excelWeekday(day(n) - 1) === PS_SHABBOS;
    blocks.push({
      at: day(n),
      heading: heading(PS_TEXT.shvii, n, { eiruv: eiruvShvii }),
      lines: [
        erevShabbos ? null
          : line(PS_TEXT.erevMincha, parseTimes(PS_TEXT.erevMincha4), { calc: 'erevMincha' }),
        // The same gate: an ערב שביעי that is Shabbos is already Shabbos and has nothing to
        // bring in early from.
        ...(erevShabbos ? [] : earlyLines(day(PS_SHVII) - 1)),
        ...eveningLines(PS_SHVII - 1),
        line(PS_TEXT.maarivLmata, [tm(shkiaOf(PS_SHVII - 1) + 72 * PS_MIN, true)], { calc: 'maarivLmata' }),
        ...morningLines(n, PS_TEXT.lastDaysShacharis),
        line(PS_TEXT.mincha, pesachDayMincha(day(n), settings), { calc: 'dayMincha' }),
      ].filter(Boolean),
    });
    if (!erevShabbos) M.list(day(n) - 1, PS_TEXT.erevMincha, parseTimes(PS_TEXT.erevMincha4), AFTERNOON);
    M.at(day(n) - 1, PS_TEXT.maarivLmata, shkiaOf(PS_SHVII - 1) + 72 * PS_MIN, { underlined: true });
    M.list(day(n), PS_TEXT.shacharis, parseTimes(PS_TEXT.lastDaysShacharis), MORNING);
    M.list(day(n), PS_TEXT.mincha, pesachDayMincha(day(n), settings), AFTERNOON);
  }

  // אחרון של פסח. Its night is שביעי's, and it carries יזכור and נעילת החג.
  {
    const n = PS_ACHRON;
    const nightShkia = shkiaOf(PS_SHVII);
    const dayShkia = shkiaOf(PS_ACHRON);
    const neila = psNear5(dayShkia - PS_NEILA_BEFORE * PS_MIN);
    blocks.push({
      at: day(n),
      heading: heading(PS_TEXT.achron, n),
      lines: [
        line(PS_TEXT.shkia, [tm(nightShkia)], { calc: 'nightShkia' }),
        line(PS_TEXT.maariv, [tm(nightShkia + 50 * PS_MIN)], { calc: 'nightMaariv' }),
        line(PS_TEXT.maarivLmata, [tm(nightShkia + 72 * PS_MIN, true)], { calc: 'maarivLmata' }),
        ...morningLines(n, PS_TEXT.lastDaysShacharis),
        line(PS_TEXT.yizkor, [txt(PS_TEXT.yizkorAt)], { calc: 'yizkor' }),
        line(PS_TEXT.mincha, pesachDayMincha(day(n), settings), { calc: 'dayMincha' }),
        line(PS_TEXT.neila, [tm(neila)], { calc: 'neila' }),
        line(PS_TEXT.maariv,
          [tm(dayShkia + 60 * PS_MIN), tm(dayShkia + 72 * PS_MIN, true)],
          { calc: 'motzeiMaariv' }),
      ],
    });
    M.at(day(n) - 1, PS_TEXT.maariv, nightShkia + 50 * PS_MIN);
    M.at(day(n) - 1, PS_TEXT.maarivLmata, nightShkia + 72 * PS_MIN, { underlined: true });
    M.list(day(n), PS_TEXT.shacharis, parseTimes(PS_TEXT.lastDaysShacharis), MORNING);
    M.list(day(n), PS_TEXT.mincha, pesachDayMincha(day(n), settings), AFTERNOON);
    M.at(day(n), PS_TEXT.neila, neila);
    M.at(day(n), PS_TEXT.maariv, dayShkia + 60 * PS_MIN);
    M.at(day(n), PS_TEXT.maariv, dayShkia + 72 * PS_MIN, { underlined: true });
  }

  // In the order the days actually run, which is what the shul asked for: the Word sheets it
  // was ported from set שביעי and אחרון at the head of the first column, above the days that
  // come before them.
  blocks.sort((a, b) => a.at - b.at);

  const all = blocks.flatMap((b) => b.lines.flatMap((l) => [...l.times, ...(l.extra?.times || [])]));
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    // The heading of the full sheet. It shares its renderer with סוכות, whose own title was
    // the only one that renderer knew.
    title: PS_TEXT.title,
    // From the night of בדיקת חמץ to אחרון של פסח, which is every date on the sheet.
    span: { from: bedikaOn, to: day(PS_ACHRON) },
    blocks: blocks.map(({ at, ...b }) => b),
    minyanim: M.out,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
