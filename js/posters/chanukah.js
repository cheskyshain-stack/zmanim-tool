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
// The morning's marks are this project's, not the old sheets'. Those used a plain time for
// the main בית מדרש, one star for בעזרת נשים, two stars for בית מדרש למטה and three for אולם
// השמחות; here plain is the main בית מדרש, an underline is למטה, one star is בעזר״נ and two
// stars is אולם השמחות. The same translation the סוכות and צום גדליה sheets already make, so a
// mark means one thing everywhere a reader holds this beside another sheet or the boards
// themselves - but only the morning ever needed three star levels to tell four rooms apart.
// The afternoon and evening never print a single star at all, so their own old ** already
// meant just למטה, the same room `minchaParts`, `maarivParts` and `fridayMainMinchaParts`
// already seat it in the rest of the year: nothing there moves to אולם השמחות for חנוכה.
import { dateFromHebrew, excelWeekday, hasRoshChodesh, hasParsha } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime } from '../format.js';
import { SLASH } from '../util.js';
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
 *  the way the everyday board decides them, in the same room (`LMATA` there) - then 1:50,
 *  unmarked, the same fixed close every year keeps. 12:45 is only on the sheet from תשפ״ו on;
 *  earlier years do not print it, the same way the everyday board did not carry it yet either.
 *
 *  The old sheets' own ** on these four is that room, not אולם השמחות: unlike the morning,
 *  which needs three star levels to tell four rooms apart, nothing in this afternoon or the
 *  Erev Shabbos menu below it is ever printed with a single star, so ** here is simply this
 *  section's own way of writing למטה. The location does not move for חנוכה. */
export function chanukahWeekdayMincha(referenceSerial, settings, includeTwelveForty5) {
  const weekMgl = weekLatestMinchaGedola(referenceSerial, settings);
  const mgl = () => zman('מנחה גדולה לחומרא', weekMgl,
    "the latest מנחה גדולה לחומרא reaches across this day's own week");
  const notBefore = 'a מנחה is never offered before it';

  const twelveForty5 = clockTime(12, 45, 'the first of the early weekday מנחה מנינים')
    .laterOf(mgl(), notBefore).underline();
  const earlyMincha = weekMgl <= T(13, 15)
    ? clockTime(13, 15, 'the earlier of the two early weekday מנחה מנינים').underline()
    : clockTime(13, 20, 'offered instead of 1:15, מנחה גדולה לחומרא reaching past it').underline();
  const mainMincha = weekMgl <= T(13, 35)
    ? clockTime(13, 35, 'the earlier of the two main weekday מנחה מנינים').underline()
    : clockTime(13, 40, 'offered instead of 1:35, מנחה גדולה לחומרא reaching past it').underline();
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
  // למטה, the same as every other מעריב on this line: the old sheets' own ** on this one is
  // no different from the ** on 6:35 and the rest, and none of them means אולם השמחות.
  const early = chanukahEarlyMaariv(hebrewYear, settings).underline();
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
 *  with the one 8:00 that prints as 8:05.
 *
 *  On a day that is not Rosh Chodesh, the ותיקין time is never earlier than the everyday
 *  board's own first minyan (7:00) moved ten minutes earlier - נץ minus 25 only when that is
 *  the later of the two. Confirmed against a year (תשפ״ז) where נץ falls early enough in the
 *  season that נץ minus 25 alone would print a morning earlier than 6:50, which the sheet does
 *  not do: 6:50 is the floor. Rosh Chodesh carries no such floor - its own נץ minus 25 is the
 *  ותיקין time outright, the same as every sampled Rosh Chodesh morning already confirmed. */
function chanukahShacharisDay(serial, settings) {
  const netz = Z.sunriseElev(dateFromSerial(serial), settings);
  const rchLabel = hasRoshChodesh(serial, settings);
  const isRoshChodesh = Boolean(rchLabel);

  const before10 = (h, m, why) => clockTime(h, m, why).minus(CH_REGULAR_SHIFT_MINUTES,
    `${CH_REGULAR_SHIFT_MINUTES} minutes earlier than the everyday board's own time, which is what the morning does on a day that is not Rosh Chodesh`);

  const vasikinNetz = zman('נץ', netz, 'on this day of חנוכה')
    .minus(CH_VASIKIN_BEFORE_NETZ, 'the ותיקין minyan is timed this far before נץ every day of חנוכה')
    .round('to the closer minute');
  const vasikin = isRoshChodesh ? vasikinNetz
    : vasikinNetz.laterOf(
      before10(7, 0, "the everyday board's own first morning minyan"),
      'the ותיקין minyan is never earlier than the everyday board\'s own first minyan moved ten minutes earlier');

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

/** A cell built out of more than one day (or more than one Erev Shabbos) at the same
 *  position: the shared value once, or every distinct value joined by the same slash the
 *  boards write two live options with, when the group does not agree. The room comes off
 *  the first instance, since every instance at one position is always the same room. */
function mergedCell(traces) {
  const texts = [...new Set(traces.map((t) => t.plain()))];
  return { text: texts.join(SLASH), underlined: Boolean(traces[0].flags.underlined), mark: traces[0].flags.mark || '' };
}

const HE_DAY_LETTERS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו'];
const dayLetter = (serial) => HE_DAY_LETTERS[excelWeekday(serial)] || '';

/** One line per day is not asked for: every non-Rosh-Chodesh morning and every Rosh Chodesh
 *  morning are each their own group (Rosh Chodesh or not is the only thing that changes the
 *  morning's own shape), and within a group the ותיקין time - the one thing that can differ
 *  day to day - is named per day, "יום X h:mm (נץ h:mm)", collapsing to "יום X כנ״ל" the
 *  moment a day repeats the one in front of it. Everything after the ותיקין slot is the same
 *  for every day in a group by construction, so it is printed once, at the end of the day
 *  list rather than once per day. */
export function combineShacharisRows(days) {
  const rows = [];
  let i = 0;
  while (i < days.length) {
    const isRC = days[i].isRoshChodesh;
    let j = i + 1;
    while (j < days.length && days[j].isRoshChodesh === isRC) j++;
    rows.push(shacharisRow(days.slice(i, j)));
    i = j;
  }
  return rows;
}

function shacharisRow(group) {
  // "כנ״ל" once the printed ותיקין time repeats, not once the underlying נץ does: נץ moves a
  // minute most days regardless, and it is the floored, printed time a reader is comparing
  // day to day, not the sunrise behind it.
  let prevVasikin = null;
  const dayItems = group.map((d) => {
    const letter = dayLetter(d.serial);
    const vasikinText = d.lines[0].plain();
    const text = vasikinText === prevVasikin ? `יום ${letter}' כנ״ל` : `יום ${letter}' ${vasikinText} (נץ ${formatTime(d.netz)})`;
    prevVasikin = vasikinText;
    return { text, underlined: false, mark: '' };
  });
  // Every line after the ותיקין one is identical across the whole group by construction
  // (the morning only ever differs by whether it is Rosh Chodesh), so it is read off the
  // first day and printed once rather than once per day.
  const restCells = group[0].lines.slice(1).map(toCell);
  return { cells: [...dayItems, ...restCells] };
}

/** One ערב שבת block rather than one per Friday: the eight days can touch two (see
 *  `chanukahErevShabbosPairs`), and a reader does not need to be told the same menu twice
 *  with only a night number between them. Headed by the parsha (or parshios) of the
 *  Shabbos or Shabbosos that go with it - "חנוכה פרשת X" or "חנוכה פרשת X וY" - rather than
 *  by which night of חנוכה it is, since that is what the shul calls these Fridays by.
 *
 *  Where the two Fridays' own menus agree position for position, printed once; anywhere they
 *  do not (a later week's own מנחה גדולה can move the same slot a Friday differently from an
 *  earlier one) that one position is both values, slash-joined - never two whole menus for
 *  the sake of one differing minute. */
export function combineErevShabbos(erevShabbosList, settings, tables) {
  if (!erevShabbosList.length) return null;
  const parshaNames = tables
    ? erevShabbosList.map((es) => hasParsha(es.shabbosSerial, settings, tables))
    : [];
  const title = parshaNames.length && parshaNames.every(Boolean)
    ? `${CH_TEXT.title} פרשת ${parshaNames.join(' ו')}`
    // The calendar tables have not loaded (only reachable when this poster is asked for
    // without them): the sheet still has to say something rather than print nothing.
    : erevShabbosList.map((es) => `${CH_TEXT.title} ${es.night}`).join(' / ');
  const cells = erevShabbosList[0].times.map((_, k) => mergedCell(erevShabbosList.map((es) => es.times[k])));
  return { title, cells };
}

/** The Erev Shabbos מנחה menu: the everyday Friday's own menu (see `fridayMainMinchaParts`)
 *  untouched, including its room - the early candidates stay למטה for חנוכה exactly as they
 *  are the rest of the year, with nothing moved to אולם השמחות - and the Friday's own candle
 *  lighting (see `candleLightingParts`) appended after it.
 *
 *  12:45, the same addition the weekday מנחה gained from תשפ״ו on, gets its own candidate
 *  here too: the everyday Friday menu does not carry one at all, so this is חנוכה's own,
 *  not a moved copy of an existing one. */
function chanukahErevShabbos(fridaySerial, shabbosSerial, settings, includeTwelveForty5) {
  const fridayDate = dateFromSerial(fridaySerial);
  const friday = fridayMainMinchaParts(fridayDate, settings, shabbosSerial);
  const times = [...friday.times];
  // Between 12:30 and 1:00, the same place the weekday chart's own 12:45 sits ahead of 1:15.
  if (includeTwelveForty5) {
    times.splice(1, 0, clockTime(12, 45, "חנוכה's own early Erev Shabbos מנחה, offered from תשפ״ו on").underline());
  }
  const candle = candleLightingParts(fridayDate, settings).times[0];
  return [...times, candle];
}

/** The Friday/Shabbos pairs this year's eight days touch. Usually one: the Friday that falls
 *  among the eight days, paired with the Shabbos right after it. When 25 Kislev is itself
 *  Shabbos (חנוכה תשפ״ז is the next year like this) the very first candle is lit the evening
 *  before, as part of that Friday's own Erev Shabbos - a day this poster otherwise never
 *  reaches, since it is before the eight days start - so that pair is added too, and the year
 *  prints two ערב שבת חנוכה menus rather than one. */
function chanukahErevShabbosPairs(kislev25) {
  const pairs = [];
  if (excelWeekday(kislev25) === CH_SHABBOS) pairs.push({ fridaySerial: kislev25 - 1, shabbosSerial: kislev25 });
  for (let d = 0; d < 8; d++) {
    const serial = kislev25 + d;
    if (excelWeekday(serial) === CH_FRIDAY) pairs.push({ fridaySerial: serial, shabbosSerial: serial + 1 });
  }
  return pairs;
}

/** The finished poster for one Hebrew year. `tables` is the Hebrew-calendar parsha tables
 *  (`{parshaChutz, parshaEY, parshaNames}`), only needed to head the ערב שבת block by its
 *  own parsha; the sheet still builds and prints without it, just with a plainer heading. */
export function buildChanukahPoster(year, settings, tables) {
  if (!year) return null;
  const kislev25 = dateFromHebrew(25, 9, year);
  const M = minyanList();

  const erevShabbosPairs = chanukahErevShabbosPairs(kislev25);
  const fridaySerials = new Set(erevShabbosPairs.map((p) => p.fridaySerial));

  const days = [];
  let sawShabbos = erevShabbosPairs.some((p) => p.fridaySerial < kislev25);
  let sundayAfterShabbos = null;
  for (let d = 0; d < 8; d++) {
    const serial = kislev25 + d;
    const wd = excelWeekday(serial);
    if (wd === CH_SHABBOS) { sawShabbos = true; continue; }
    if (sawShabbos && sundayAfterShabbos == null && wd === 1) sundayAfterShabbos = serial;
    const day = chanukahShacharisDay(serial, settings);
    day.dayNumber = d + 1;
    days.push(day);
    M.list(serial, CH_TEXT.shacharis, day.lines.map(toCell), MORNING);
  }

  const weekdayMincha = chanukahWeekdayMincha(days[0]?.serial ?? kislev25, settings, year >= 5786);
  for (const day of days) {
    if (fridaySerials.has(day.serial) || day.serial === sundayAfterShabbos) continue;
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
    if (fridaySerials.has(day.serial)) continue;
    M.list(day.serial, CH_TEXT.maariv, maariv.map(toCell), AFTERNOON);
  }

  const erevShabbosList = erevShabbosPairs.map(({ fridaySerial, shabbosSerial }) => {
    const times = chanukahErevShabbos(fridaySerial, shabbosSerial, settings, year >= 5786);
    M.list(fridaySerial, CH_TEXT.mincha, times.map(toCell), AFTERNOON);
    // The night whose candle is lit after this Friday's own שקיעה: night 1 when 25 Kislev
    // falls on the Shabbos right after it, counting on from there.
    return { serial: fridaySerial, shabbosSerial, night: fridaySerial - kislev25 + 2, times };
  });

  return {
    hebrewYear: year,
    span: { from: erevShabbosPairs.some((p) => p.fridaySerial < kislev25) ? kislev25 - 1 : kislev25, to: kislev25 + 7 },
    days,
    shacharisRows: combineShacharisRows(days),
    weekdayMincha,
    maariv,
    erevShabbosList,
    erevShabbos: combineErevShabbos(erevShabbosList, settings, tables),
    sundayAfterShabbos,
    minyanim: M.out,
    legend: [
      { dir: 'ltr', text: 'Underlined מנינים are in בית מדרש למטה' },
      { dir: 'rtl', text: '*בעזרת נשים    **באולם השמחות' },
    ],
  };
}
