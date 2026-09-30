// The חנוכה sheet: eight days of שחרית, the weekday מנחה and מעריב, and the Erev Shabbos and
// (where one falls inside the eight days) Sunday מנחה menus that go with them.
//
// Ported off seven Word sheets the shul hung, תש״פ through תשפ״ו, plus two more that carried
// just the first (ותיקין) minyan's day-by-day times on their own page. Every number below was
// checked against those seven before it was written here; see the rules' own comments for what
// each one actually reproduces and where the old sheets disagree with each other (the shul's
// own answer, given directly, is what is here - a later year over an earlier one wherever the
// two conflict and there is no calendar reason for the difference).
//
// The marks are this project's, not the old sheets'. Those used a plain time for the main בית
// מדרש, one star for בעזרת נשים, two stars for בית מדרש למטה and three for אולם השמחות; here
// plain is the main בית מדרש, an underline is למטה, one star is בעזר״נ and two stars is אולם
// השמחות. The same translation the סוכות and צום גדליה sheets already make, so a mark means one
// thing everywhere a reader holds this beside another sheet or the boards themselves.
import { dateFromHebrew, excelWeekday, hasRoshChodesh } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime } from '../format.js';
import { zman, clockTime, fixedTime } from '../zmanim/trace.js';
import { T, weekLatestMinchaGedola, fridayMainMinchaParts, candleLightingParts } from '../sheets/common.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';

const CH_MIN = 1 / 1440;
const CH_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos
const CH_FRIDAY = 6;

/** The wording. Everything else on the sheet is worked out. */
export const CH_TEXT = {
  title: 'חנוכה',
  shacharis: 'שחרית',
  mincha: 'מנחה',
  maariv: 'מעריב',
  erevShabbos: 'ערב שבת',
  sunday: "יום א'",
  candleLighting: 'הדלקת נרות',
};

/** The first ותיקין שחרית, in front of everything else the morning offers.
 *
 *  25 minutes before נץ, every day of the eight, Rosh Chodesh or not. Read off the two years
 *  that give a day-by-day breakdown (תשפ״ג and תשפ״ה): every single sampled day of both comes
 *  to exactly this, no exceptions. Two years before that (תש״פ, תשפ״א) used 24 instead, which
 *  is why 25 is a rule here rather than a bare number: the shul moved it once already and the
 *  later value is the one kept. */
export const CH_VASIKIN_BEFORE_NETZ = 25;

/** The morning's second line, once the ותיקין time is out of the way: the everyday שחרית's own
 *  first line (7:00, 7:20*, 7:35 למטה) moved ten minutes earlier, and its second line (8:00,
 *  8:20*, 8:40 למטה) printed exactly as it stands the rest of the year.
 *
 *  Confirmed against five straight years, תשפ״ב through תשפ״ז: once the old sheets' own marks
 *  are read through the translation above (their ** is this project's underline), the two
 *  lines match `WEEKDAY_SHACHARIS`'s own two lines mark for mark, first line shifted and second
 *  line untouched. תש״פ and תשפ״א carried an older, more elaborate morning with an extra option
 *  that dropped away starting תשפ״ב and never came back, so they are not part of this rule. */
const CH_REGULAR_SHIFT_MINUTES = 10;

/** Rosh Chodesh's own morning is `WEEKDAY_SHACHARIS_SPECIAL`, untouched, except the ותיקין
 *  swap every day gets and one more thing: the 8:00 in the middle of that schedule prints as
 *  8:05 during חנוכה. Four of the five sampled Rosh Chodesh mornings (תשפ״ג-תשפ״ז) say 8:05;
 *  only תשפ״ב says 8:00, which reads as the one that slipped rather than the rule. */
const CH_ROSH_CHODESH_MIDDLE_SHIFT = 5;

/** The weekday afternoon's own fixed slots, off `js/sheets/weekday.js`'s own `minchaParts`:
 *  12:45 (only once the clocks are back, which every חנוכה is), 1:15 or 1:20, and 1:35 or 1:40,
 *  each weighed against the latest מנחה גדולה לחומרא reaches across the relevant week, exactly
 *  the way the everyday board decides them - then 1:50, unmarked, the same fixed close every
 *  year keeps. 12:45 is only on the sheet from תשפ״ו on; earlier years do not print it, the
 *  same way the everyday board did not carry it yet either. */
export function chanukahWeekdayMincha(referenceSerial, settings, includeTwelveForty5) {
  const weekMgl = weekLatestMinchaGedola(referenceSerial, settings);
  const mgl = () => zman('מנחה גדולה לחומרא', weekMgl,
    "the latest מנחה גדולה לחומרא reaches across this day's own week");
  const notBefore = 'a מנחה is never offered before it';

  const twelveForty5 = clockTime(12, 45, 'the first of the early weekday מנחה מנינים')
    .laterOf(mgl(), notBefore).mark('**');
  const earlyMincha = weekMgl <= T(13, 15)
    ? clockTime(13, 15, 'the earlier of the two early weekday מנחה מנינים').mark('**')
    : clockTime(13, 20, 'offered instead of 1:15, מנחה גדולה לחומרא reaching past it').mark('**');
  const mainMincha = weekMgl <= T(13, 35)
    ? clockTime(13, 35, 'the earlier of the two main weekday מנחה מנינים').mark('**')
    : clockTime(13, 40, 'offered instead of 1:35, מנחה גדולה לחומרא reaching past it').mark('**');
  const oneFifty = fixedTime('1:50', { label: 'the standing close of the early afternoon' });
  /* Not on any board the rest of the year: a late, fixed מנחה in front of candle lighting,
     identical across all six sampled years (תשפ״א-תשפ״ז) despite שקיעה itself moving several
     minutes across them, which is what says it is a flat clock time and not a computed one. */
  const late = fixedTime('4:15', { label: 'the fixed late מנחה before candle lighting, unchanged across every sampled year' }).underline();

  const all = includeTwelveForty5 ? [twelveForty5, earlyMincha, mainMincha, oneFifty, late]
    : [earlyMincha, mainMincha, oneFifty, late];
  return all;
}

/** The weekday מעריב: the everyday board's own regular run (6:35 through 11:00 - see
 *  `maarivParts` in `js/sheets/weekday.js`) with one extra, earlier מנין of its own in front.
 *
 *  That first מנין is 50 minutes after the latest שקיעה among the eight nights of חנוכה that
 *  fall Sunday through Thursday - the night that opens the first day and the night that opens
 *  the eighth, and every night between, but never a Friday or Shabbos night, which davens its
 *  own Erev Shabbos or מוצאי שבת schedule instead. Confirmed exactly against the newest sampled
 *  year (תשפ״ז) and within a minute or two of five years before it, which is the same small
 *  spread this sheet's own שחרית times show against the app's own נץ before תשפ״ג. */
export function chanukahEarlyMaariv(hebrewYear, settings) {
  const kislev25 = dateFromHebrew(25, 9, hebrewYear);
  const shkias = [];
  for (let d = 0; d < 8; d++) {
    const serial = kislev25 - 1 + d; // the evening that opens each of the eight days
    const wd = excelWeekday(serial);
    if (wd < 1 || wd > 5) continue; // Friday and Shabbos evenings run their own schedule
    shkias.push(Z.sunsetElev(dateFromSerial(serial), settings));
  }
  const latest = Math.max(...shkias);
  return zman('שקיעה', latest, "the latest of חנוכה's own Sunday-through-Thursday evenings")
    .plus(50, 'a מעריב is 50 minutes after שקיעה, the same rule the everyday board keeps')
    .floorToStep(5, 'to the lower five minutes');
}

const CH_MAARIV_REGULAR = [
  [6, 35], [7, 0], [7, 30], [8, 0], // underlined, למטה
];
const CH_MAARIV_MAIN = [8, 45]; // the one that stays in the main בית מדרש
const CH_MAARIV_LATE = [
  [9, 30], [10, 0], [10, 30], [11, 0], // underlined again except 10:30
];

function chanukahMaariv(hebrewYear, settings) {
  const early = chanukahEarlyMaariv(hebrewYear, settings).mark('**');
  const regular = CH_MAARIV_REGULAR.map(([h, m]) =>
    clockTime(h, m, 'one of the everyday board\'s own מעריב times').underline());
  const main = clockTime(...CH_MAARIV_MAIN, "the everyday board's own מעריב that stays upstairs");
  const late = CH_MAARIV_LATE.map(([h, m]) =>
    (h === 10 && m === 30
      ? clockTime(h, m, "the everyday board's own מעריב that stays upstairs")
      : clockTime(h, m, "one of the everyday board's own מעריב times").underline()));
  return [early, ...regular, main, ...late];
}

/** One day of the morning: the ותיקין time first, then either the everyday board's own two
 *  lines (shifted ten minutes on the first) or, on Rosh Chodesh, the Rosh Chodesh schedule
 *  with the one 8:00 that prints as 8:05. */
function chanukahShacharisDay(serial, settings) {
  const netz = Z.sunriseElev(dateFromSerial(serial), settings);
  const rchLabel = hasRoshChodesh(serial, settings);
  const isRoshChodesh = Boolean(rchLabel);

  const vasikin = zman('נץ', netz, 'on this day of חנוכה')
    .minus(CH_VASIKIN_BEFORE_NETZ, 'the ותיקין minyan is timed this far before נץ every day of חנוכה')
    .round('to the closer minute');

  const before10 = (h, m, why) => clockTime(h, m, why).minus(CH_REGULAR_SHIFT_MINUTES,
    `${CH_REGULAR_SHIFT_MINUTES} minutes earlier than the everyday board's own time, which is what the morning does on a day that is not Rosh Chodesh`);

  const lines = isRoshChodesh
    ? [
      vasikin,
      clockTime(7, 0, "the everyday board's own Rosh Chodesh morning, unmoved").mark('*'),
      clockTime(7, 15, "the everyday board's own Rosh Chodesh morning, unmoved").underline(),
      clockTime(7, 35, "the everyday board's own Rosh Chodesh morning, unmoved").mark('**'),
      clockTime(8, 5, 'the Rosh Chodesh schedule\'s own 8:00, five minutes later during חנוכה'),
      clockTime(8, 20, "the everyday board's own Rosh Chodesh morning, unmoved").mark('*'),
      clockTime(8, 40, "the everyday board's own Rosh Chodesh morning, unmoved").underline(),
    ]
    : [
      vasikin,
      before10(7, 20, "the everyday board's own second morning minyan").mark('*'),
      before10(7, 35, "the everyday board's own third morning minyan").underline(),
      clockTime(8, 0, "the everyday board's own morning minyan, unmoved"),
      clockTime(8, 20, "the everyday board's own morning minyan, unmoved").mark('*'),
      clockTime(8, 40, "the everyday board's own morning minyan, unmoved").underline(),
    ];

  return { serial, isRoshChodesh, netz, lines };
}

export const toCell = (t) => ({ text: t.plain(), underlined: Boolean(t.flags.underlined), mark: t.flags.mark || '', trace: t });

/** The Erev Shabbos מנחה menu: the everyday Friday's own menu (see `fridayMainMinchaParts`)
 *  with its early, underlined options moved from למטה to אולם השמחות for חנוכה's larger
 *  crowd - two stars rather than an underline - while the standing 1:50/2:15/3:00 stay put,
 *  and the Friday's own candle lighting (see `candleLightingParts`) appended after it.
 *
 *  12:45, the same addition the weekday מנחה gained from תשפ״ו on, gets its own candidate
 *  here too: the everyday Friday menu does not carry one at all, so this is חנוכה's own,
 *  not a moved copy of an existing one. */
function chanukahErevShabbos(fridaySerial, shabbosSerial, settings, includeTwelveForty5) {
  const fridayDate = dateFromSerial(fridaySerial);
  const friday = fridayMainMinchaParts(fridayDate, settings, shabbosSerial);
  const moved = friday.times.filter((t) => t.flags.underlined).map((t) =>
    zman(CH_TEXT.mincha, t.value, "one of the everyday Friday's own early מנחה מנינים, moved to אולם השמחות for חנוכה").mark('**'));
  // Between 12:30 and 1:00, the same place the weekday chart's own 12:45 sits ahead of 1:15.
  if (includeTwelveForty5) {
    moved.splice(1, 0, clockTime(12, 45, "חנוכה's own early Erev Shabbos מנחה, offered from תשפ״ו on").mark('**'));
  }
  const rest = friday.times.filter((t) => !t.flags.underlined);
  const candle = candleLightingParts(fridayDate, settings).times[0];
  return [...moved, ...rest, candle];
}

/** The finished poster for one Hebrew year. */
export function buildChanukahPoster(year, settings) {
  if (!year) return null;
  const kislev25 = dateFromHebrew(25, 9, year);
  const M = minyanList();

  const days = [];
  let fridaySerial = null;
  let shabbosSerial = null;
  let sundayAfterShabbos = null;
  for (let d = 0; d < 8; d++) {
    const serial = kislev25 + d;
    const wd = excelWeekday(serial);
    if (wd === CH_SHABBOS) { shabbosSerial = serial; continue; }
    if (wd === CH_FRIDAY) fridaySerial = serial;
    if (shabbosSerial != null && sundayAfterShabbos == null && wd === 1) sundayAfterShabbos = serial;
    const day = chanukahShacharisDay(serial, settings);
    day.dayNumber = d + 1;
    days.push(day);
    M.list(serial, CH_TEXT.shacharis, day.lines.map(toCell), MORNING);
  }

  const weekdayMincha = chanukahWeekdayMincha(days[0]?.serial ?? kislev25, settings, year >= 5786);
  for (const day of days) {
    if (day.serial === fridaySerial || day.serial === sundayAfterShabbos) continue;
    M.list(day.serial, CH_TEXT.mincha, weekdayMincha.map(toCell), AFTERNOON);
  }
  /* The Sunday that opens the second week, where one falls inside the eight days, prints its
     own early options on every sampled sheet - but which ones, and how many, is the one piece
     of this sheet the old sheets disagree with each other about in a way the calendar does not
     explain (see the two newest, תשפ״ה and תשפ״ו, against the two before them). Rather than
     invent a rule the shul has not confirmed, this Sunday is given the same weekday מנחה menu
     as every other day until that is settled - flagged here so it is not mistaken for a
     verified number the way the rest of this sheet's times are. */
  if (sundayAfterShabbos != null) {
    M.list(sundayAfterShabbos, CH_TEXT.mincha, weekdayMincha.map(toCell), AFTERNOON);
  }

  const maariv = chanukahMaariv(year, settings);
  for (const day of days) {
    if (day.serial === fridaySerial) continue;
    M.list(day.serial, CH_TEXT.maariv, maariv.map(toCell), AFTERNOON);
  }

  let erevShabbos = null;
  if (fridaySerial != null && shabbosSerial != null) {
    const times = chanukahErevShabbos(fridaySerial, shabbosSerial, settings, year >= 5786);
    erevShabbos = { serial: fridaySerial, times };
    M.list(fridaySerial, CH_TEXT.mincha, times.map(toCell), AFTERNOON);
  }

  return {
    hebrewYear: year,
    span: { from: kislev25, to: kislev25 + 7 },
    days,
    weekdayMincha,
    maariv,
    erevShabbos,
    sundayAfterShabbos,
    minyanim: M.out,
    legend: [
      { dir: 'ltr', text: 'Underlined מנינים are in בית מדרש למטה' },
      { dir: 'rtl', text: '*בעזרת נשים    **באולם השמחות' },
    ],
  };
}
