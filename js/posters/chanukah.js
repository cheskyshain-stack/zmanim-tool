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
import { dateFromHebrew, excelWeekday, hasRoshChodesh, hasParsha, hebrewDateExtended } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, formatTimeWithSeconds, floorToMinute } from '../format.js';
import { SLASH, splitLinesInHalf } from '../util.js';
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
  netz: 'נץ',
  mincha: 'מנחה',
  maariv: 'מעריב',
  erevShabbos: 'ערב שבת',
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

/** Rosh Chodesh's own floor: the ותיקין minyan is never more than 20 minutes earlier than
 *  Rosh Chodesh's own 7:00 (the schedule's own second line, unmoved - see chanukahShacharisDay),
 *  the same shape the everyday board's own floor is, asked for directly after a year (תשצ"ג)
 *  where נץ minus 25 alone printed 6:37, 23 minutes ahead of the 7:00 beside it. Its own number
 *  rather than CH_REGULAR_SHIFT_MINUTES's ten: a Rosh Chodesh morning already opens earlier than
 *  an ordinary one by design, and the floor asked for is wider, not the same one moved over. */
const CH_RC_FLOOR_MINUTES = 20;

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

/** Whether `serial` falls among the eight days of חנוכה (25 Kislev through 2 Teves), and if
 *  so the Hebrew year to build that חנוכה's own poster or extras from. Both months land in
 *  the same AM year (Kislev and Teves both follow תשרי within one year's own count), so
 *  there is no year-boundary to special-case. Shared by the weekday and שבת charts, so a
 *  week or a Friday only ever asks this one place whether it is inside חנוכה. */
export function chanukahYearFor(serial, settings) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  if (j.month === 9 && j.dayOfMonth >= 25) return j.year;
  if (j.month === 10 && j.dayOfMonth <= 2) return j.year;
  return null;
}

/** For the שבת chart's own parsha column: whether `shabbosSerial` itself falls inside
 *  חנוכה, or is the שבת right in front of it (ערב חנוכה) - meaning חנוכה actually opens
 *  the night this שבת ends, so the first candle is lit at מוצאי שבת. That is only true
 *  when 25 Kislev itself is the Sunday right after this שבת: any other weekday for 25
 *  Kislev puts a day or more of the week between this שבת and חנוכה's own start, and a
 *  שבת that is not the one immediately before is not "ערב" anything. Never both: a שבת
 *  inside חנוכה is answered by the first check before the second is ever asked. */
export function chanukahShabbosLabel(shabbosSerial, settings) {
  if (chanukahYearFor(shabbosSerial, settings)) return 'chanukah';
  const sunday = hebrewDateExtended(shabbosSerial + 1, settings.useGregorianBefore1582);
  if (sunday.month === 9 && sunday.dayOfMonth === 25) return 'erev';
  return null;
}

/** For the שבת chart's own ערב שבת מנחה column: the Hebrew year to treat `fridaySerial`'s
 *  own evening as חנוכה's, which is not always the answer `chanukahYearFor` gives the
 *  Friday itself. Every ordinary year that evening is simply one of the eight days, but
 *  where 25 Kislev falls on שבת the very first candle is lit Friday evening, before שבת's
 *  own - that Friday's own calendar day is still 24 Kislev, a day `chanukahYearFor` reads
 *  as not-yet-חנוכה, though the night it opens genuinely is. The same Friday
 *  `chanukahErevShabbosPairs` already gives a pair of its own for the Special Schedules
 *  poster; this is the שבת chart's own way of asking the same question, so the two cannot
 *  disagree about which Friday actually opens חנוכה. */
export function chanukahFridayYear(fridaySerial, settings) {
  const direct = chanukahYearFor(fridaySerial, settings);
  if (direct) return direct;
  const shabbos = hebrewDateExtended(fridaySerial + 1, settings.useGregorianBefore1582);
  return shabbos.month === 9 && shabbos.dayOfMonth === 25 ? shabbos.year : null;
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
 *  Both kinds of day carry a floor: a non-Rosh-Chodesh morning is never earlier than the
 *  everyday board's own first minyan (7:00) moved ten minutes earlier, and a Rosh Chodesh
 *  morning is never more than CH_RC_FLOOR_MINUTES (20) earlier than Rosh Chodesh's own 7:00 -
 *  נץ minus 25 only when that is the later of the two either way. Confirmed against a year
 *  (תשפ״ז) where נץ falls early enough that נץ minus 25 alone would print a non-Rosh-Chodesh
 *  morning earlier than 6:50, which the sheet does not do, and a year (תשצ"ג) where the same
 *  thing happened to Rosh Chodesh's own morning - 6:37, 23 minutes ahead of the 7:00 beside
 *  it - which asked for its own floor rather than none at all. */
function chanukahShacharisDay(serial, settings) {
  const netz = Z.sunriseElev(dateFromSerial(serial), settings);
  const rchLabel = hasRoshChodesh(serial, settings);
  const isRoshChodesh = Boolean(rchLabel);

  const before10 = (h, m, why) => clockTime(h, m, why).minus(CH_REGULAR_SHIFT_MINUTES,
    `${CH_REGULAR_SHIFT_MINUTES} minutes earlier than the everyday board's own time, which is what the morning does on a day that is not Rosh Chodesh`);

  const vasikinNetz = zman('נץ', netz, 'on this day of חנוכה')
    .minus(CH_VASIKIN_BEFORE_NETZ, 'the ותיקין minyan is timed this far before נץ every day of חנוכה')
    .round('to the closer minute');
  const vasikin = isRoshChodesh
    ? vasikinNetz.laterOf(
      clockTime(7, 0, "Rosh Chodesh's own second morning minyan, unmoved").minus(CH_RC_FLOOR_MINUTES,
        `${CH_RC_FLOOR_MINUTES} minutes earlier than Rosh Chodesh's own 7:00, the floor its own first minyan does not cross`),
      `the ותיקין minyan is never more than ${CH_RC_FLOOR_MINUTES} minutes earlier than Rosh Chodesh's own 7:00`)
    : vasikinNetz.laterOf(
      before10(7, 0, "the everyday board's own first morning minyan"),
      'the ותיקין minyan is never earlier than the everyday board\'s own first minyan moved ten minutes earlier');
  /* Whether נץ is actually why this day's ותיקין prints when it does, asked for directly:
     a day the floor wins is a day the shul's own everyday minyan (or Rosh Chodesh's own) is
     on the board same as any other, and נץ had nothing to do with the printed time - naming
     it there is a fact nobody asked for beside a time that needed no explaining. Read off
     vasikin's own last step rather than compared again here, so this can never disagree with
     which candidate laterOf actually kept - true for either kind of day now that both carry
     a floor to have won instead of נץ. */
  const netzBinding = vasikin.steps[vasikin.steps.length - 1]?.took === 'this';

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

  return { serial, isRoshChodesh, netz, netzBinding, lines };
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

/** Every row's own single ותיקין time, the first thing שחרית prints and the one position
 *  that can vary across a merged group's own days: the average of the group's own
 *  netz-minus-25 candidates, each still at its own full precision, floored to the start of
 *  its minute rather than rounded to the nearest one - the beginning of the one minute the
 *  group's own mornings actually straddle, not whichever whole minute happens to land
 *  closest to the average. Asked for directly, in place of the live either-or choice
 *  mergedCell writes everywhere else a group disagrees (see combineShacharisRows).
 *
 *  Every day of the eight is merged into one row this way now (see combineShacharisRows),
 *  so the group behind this call is no longer always two days agreeing on everything but
 *  this one position (Rosh Chodesh) or days that already print identically (the standing
 *  ones) - it can hold days that land on the morning's own floor beside days נץ actually
 *  decided. Asked for directly: a day whose own ותיקין sits at the everyday board's own
 *  floor (`netzBinding` false, see chanukahShacharisDay) is a day נץ decided nothing, and
 *  naming its נץ beside a time that needed no explaining is a fact nobody asked for, so the
 *  note names only the days נץ actually explains, exactly as netzNote used to - and the
 *  note itself comes back null when nothing in the group is one of them, which the merged
 *  row's own blended time can still be, once the floor days outnumber the netz days enough
 *  to pull the average back onto the floor's own minute.
 *
 *  Handed back as the two pieces rather than one joined string: posters-view.js sets the נץ
 *  note in its own bdi, the same isolation `.poster-row-note` already carries elsewhere on
 *  this sheet, because the Hebrew in "נץ" sitting loose beside the times (unlike the row's
 *  own label, which is outside the times' own ltr run entirely) reads as a strong character
 *  of that run and turns the times after it backwards - measured directly, the same bug the
 *  label itself made before this sheet's own times were given their own direction. */
/** The one candidate a day actually contributes to the average, at full precision rather
 *  than the minute `vasikin` itself rounds to: נץ minus 25, floored at 20 minutes before
 *  Rosh Chodesh's own 7:00 on a Rosh Chodesh day or ten minutes before the everyday board's
 *  own 7:00 on any other - the same comparison chanukahShacharisDay's own `vasikin` makes,
 *  asked again here rather than read off `vasikin.value` because that value is already
 *  rounded to its own minute and this average wants to round only once, at the end.
 *
 *  Needed once a group can hold a floor day beside a נץ day, now that every non-Rosh-Chodesh
 *  day merges into one row regardless of whether they agree (see combineShacharisRows): a
 *  floor day's own נץ minus 25 can sit under its own floor, and averaging that number in
 *  rather than the floor the day actually prints would pull the whole row's own time down to
 *  something no single day on the sheet is printing - the "don't change the zman of
 *  prayer" the floor exists for in the first place. */
const rawVasikinCandidate = (d) => {
  const netzBased = d.netz - CH_VASIKIN_BEFORE_NETZ / 1440;
  const floorMinutes = d.isRoshChodesh ? CH_RC_FLOOR_MINUTES : CH_REGULAR_SHIFT_MINUTES;
  return Math.max(netzBased, T(7, 0) - floorMinutes / 1440);
};

/** Which day(s) of the week each נץ time in the note belongs to, asked for directly: the
 *  note lists a time for every day נץ actually explains, in the same left-to-right order
 *  they are typed in, and a reader counting slashes against "יום א' ב' ג' ד'" four words
 *  above it had to count correctly every time. Grouped by the printed time itself (not by
 *  day) since two days can in principle share one printed second - rare, but a reader is
 *  still owed both letters rather than only the first day's, so dayLetter joins every day
 *  that landed on one slot with the same "/" the row's own times use elsewhere. */
function netzDayGroups(bound) {
  const order = [];
  const byTime = new Map();
  for (const d of bound) {
    const time = formatTimeWithSeconds(d.netz);
    if (!byTime.has(time)) { byTime.set(time, []); order.push(time); }
    byTime.get(time).push(dayLetter(d.serial));
  }
  return order.map((time) => ({ time, letters: byTime.get(time) }));
}

/** The floored average of a set of days' own raw candidates (`rawVasikinCandidate`), the
 *  arithmetic `chanukahVasikinBetween` runs on whichever days it is handed - split out so
 *  `combineShacharisRows` can run it once across all eight days and hand the one result to
 *  both rows, rather than each row running it again on its own four. */
const averageBetween = (group) => floorToMinute(group.reduce((sum, d) => sum + rawVasikinCandidate(d), 0) / group.length);

/** One row's own ותיקין time and נץ note. `sharedBetween`, when given, is the time to print
 *  instead of this row's own average - see combineShacharisRows, which passes one in only
 *  where every one of the eight days needed נץ to move its own morning: on every other year
 *  the two rows keep their own separate averages, one or both resting wholly on its own
 *  floor (CH_REGULAR_SHIFT_MINUTES for a non-Rosh-Chodesh day, CH_RC_FLOOR_MINUTES for a
 *  Rosh Chodesh one), which is the ordinary shape of the eight days and the reason the two
 *  rows are two rows rather than one. The נץ note still comes off this row's own days
 *  regardless, since it is naming which of them נץ actually explains, not what the row's own
 *  time happens to equal. */
export function chanukahVasikinBetween(group, sharedBetween) {
  const between = sharedBetween !== undefined ? sharedBetween : averageBetween(group);
  const bound = group.filter((d) => d.netzBinding);
  const netzDays = bound.length ? netzDayGroups(bound) : null;
  return { time: formatTime(between), netzDays };
}

/** One row for every one of the eight days that is not Rosh Chodesh, together, and one more
 *  for Rosh Chodesh's own days (grouped together whether or not their own ותיקין time
 *  agrees, labelled "ראש חודש" with each day's own letter) - asked for directly, in place
 *  of the narrower combining this used to do, which only ever merged a run of consecutive
 *  days: a non-Rosh-Chodesh run on both sides of Rosh Chodesh (the ordinary shape of the
 *  eight days, which only ever carries Rosh Chodesh as one block in the middle of them)
 *  printed as two rows of its own kind rather than one, same as a day whose own נץ moved the
 *  ותיקין time even a minute from its neighbour used to open a row of its own before every
 *  position but that one started being merged regardless of agreement. Grouping by kind
 *  rather than by run is what reaches both: every day of one kind is one row wherever in the
 *  eight it falls. Every position after the ותיקין time is a fixed clock time that cannot
 *  disagree across the eight days however they are grouped, so this changes nothing about
 *  what the rest of either line says - only how many lines there are and what the one
 *  varying position, the ותיקין time, prints (see chanukahVasikinBetween).
 *
 *  The two rows print in whichever order their own earliest day actually falls, so a year
 *  whose eight days open with Rosh Chodesh (its own non-Rosh-Chodesh days all coming after)
 *  still reads top to bottom the way the calendar does, not in a fixed order that would read
 *  backwards that one year.
 *
 *  Both kinds of row carry `isRoshChodesh` and `vasikin` (chanukahVasikinBetween's own
 *  in-between time and, where at least one of the group's own days needs it, its
 *  seconds-precise נץ note) - what posters-view.js's own shacharisRunLines reads in place
 *  of `cells[0]` to open every row the same way: the ותיקין time first, then its own נץ
 *  note where one is needed. `cells` still carries the full line, merged position by
 *  position the same way a Rosh Chodesh row's always has, so every position from the second
 *  on is read off it exactly as before; only the first position, superseded by `vasikin`,
 *  is no longer what a reader of this row is shown.
 *
 *  The non-Rosh-Chodesh row's own label names every one of its days rather than a range: with
 *  Rosh Chodesh carved out of the middle of the eight days (its ordinary place), the days left
 *  are two separate runs, before and after it, and the eight days are enough that those two
 *  runs can open and close on the very same weekday - a range's own first and last day letter
 *  alone then read as "day ב'-ב'", one day a reader would take as a range of none, where six
 *  were actually meant. Naming every day plainly, the same list Rosh Chodesh's own label
 *  already names its days with, has no such case to misread: "יום א' ב' ג' ד' א'" repeats a
 *  letter across the week's own turn rather than hiding it inside a dash. */
const dayList = (group) => group.map((d) => `${dayLetter(d.serial)}'`).join(' ');

export function combineShacharisRows(days) {
  const rc = days.filter((d) => d.isRoshChodesh);
  const other = days.filter((d) => !d.isRoshChodesh);
  /* Where every one of the eight days needed נץ to move its own morning - not the ordinary
     shape, where the non-Rosh-Chodesh days sit on the floor while Rosh Chodesh (which has no
     floor to sit on) does not - both rows print the one average across all eight rather than
     two rows each averaging their own four: asked for directly, after a year where every day
     really was moved and the two rows still printed a minute apart from each other (6:52
     against 6:53), which read as two different answers to the same question. */
  const allPushed = days.length > 0 && days.every((d) => d.netzBinding);
  const shared = allPushed ? averageBetween(days) : undefined;
  const row = (group, label) => {
    const cells = group[0].lines.map((_, k) => mergedCell(group.map((d) => d.lines[k])));
    return { label, cells, isRoshChodesh: group[0].isRoshChodesh, vasikin: chanukahVasikinBetween(group, shared) };
  };
  const rows = [];
  if (other.length) rows.push(row(other, `יום ${dayList(other)}`));
  if (rc.length) rows.push(row(rc, `ראש חודש יום ${dayList(rc)}`));
  if (rows.length === 2 && rc[0].serial < other[0].serial) rows.reverse();
  return rows;
}

/** `days`' own combined morning(s) (see combineShacharisRows), as the wall chart prints
 *  them rather than as the poster does: plain lines of times, no label in front of them,
 *  ready for shacharisGridHtml to set in columns. A wall-chart row is already dated by its
 *  own parsha column, and the panel's own line already carries its own heading ("חנוכה"),
 *  so the label combineShacharisRows builds ("יום א'-ד'", "ראש חודש ...") would only repeat
 *  what is already said beside it. ותיקין prints inline, the first time of its own line,
 *  matching every other row on this chart - the special schedules' own broken-out line is
 *  that page's own choice, not this one's. More than one group (a run split by Rosh
 *  Chodesh, say) prints as more than one two-line block, a blank line between them so
 *  shacharisGridHtml reads them as separate blocks rather than one.
 *
 *  `includeRoshChodesh: false` drops any Rosh Chodesh day out of the group entirely rather
 *  than printing its own block beside the regular days': asked for the one row a week every
 *  one of whose five days is חנוכה gets (sheet-view.js), which has only the one row's own
 *  height to spend and not the many the standing panel is free to run a second block down.
 *  A Rosh Chodesh day inside that week still has its own morning on the Special Schedules
 *  poster (buildChanukahPoster), which is asked without this flag and keeps both blocks.
 *
 *  `mergeAll: true` is that same one row's own reason again, reached a second way: even with
 *  Rosh Chodesh out, the remaining days can still fail to share one exact line - נץ moves
 *  daily, so ותיקין's own rounding can land a minute apart on two days that agree on
 *  everything else, and combineShacharisRows still calls that two groups rather than one
 *  (measured: a 45px row asked to hold both ran to 68px, the same overflow a Rosh Chodesh
 *  day makes). Asked to merge, every day is one group regardless of where it agrees or not,
 *  the disagreeing position slash-joined the way a live choice between two times is written
 *  anywhere else on this sheet - one two-line block, always, whatever the days underneath
 *  it are actually doing. The poster keeps the fuller day-by-day picture; this row does not
 *  have the room for it. */
/* A wall-chart cell is one column of shacharisGridHtml's own grid, and never two stacked
   values in it: shacharisGridHtml counts every digit:digit run in a line to decide how many
   columns the line needs, so a merged cell that disagrees ("6:49 / 6:50", two days a minute
   apart) reads as two columns instead of one and throws the whole row's grid out of true -
   measured live, on a Rosh Chodesh pair whose own נץ moves a minute between the two days: the
   line came out four columns wide instead of three, jammed against the line below it. The
   poster prints the same disagreement as a real choice (chanukahRunLine in posters-view.js,
   which lists cells as plain text rather than gridding them, so it has no such limit); this
   is the one context that cannot. The earlier of the two is kept, which the chart's own
   footer already asks a reader to allow for ("All zmanim are rounded off. Please be מחמיר
   two minutes.") - a day apart on ותיקין is well inside that. */
const firstOf = (text) => text.split(SLASH)[0];

/** The wall chart's own שחרית panel never writes a slash between its times - WEEKDAY_SHACHARIS
 *  and WEEKDAY_SHACHARIS_SPECIAL in settings.js are plain-space-separated, matching the hand-made
 *  boards this is ported from - unlike every other column on this chart, which does. A plain
 *  space here, rather than splitLinesInHalf's own default (SLASH, right for a מנחה/מעריב cell
 *  reporting a live either/or choice), is what keeps חנוכה's own two blocks set the same way as
 *  the standing one beside them: firstOf above has already resolved any live choice between two
 *  days to the earlier one, so there is no choice left here for a slash to mark. */
const SH_PANEL_SPACE = ' ';

export function chanukahScheduleLines(days, settings, { includeRoshChodesh = true, mergeAll = false } = {}) {
  const cellHtml = (c) => `${c.underlined ? `<u>${firstOf(c.text)}</u>` : firstOf(c.text)}${c.mark || ''}`;
  const dayObjs = days.map((d) => chanukahShacharisDay(d, settings))
    .filter((d) => includeRoshChodesh || !d.isRoshChodesh);
  if (mergeAll) {
    if (!dayObjs.length) return '';
    const cells = dayObjs[0].lines.map((_, k) => mergedCell(dayObjs.map((d) => d.lines[k])));
    return splitLinesInHalf(cells.map(cellHtml), SH_PANEL_SPACE);
  }
  return combineShacharisRows(dayObjs)
    .map((row) => splitLinesInHalf(row.cells.map(cellHtml), SH_PANEL_SPACE))
    .join('\n\n');
}

/** A small נץ note for the Weekday chart's own tiny panel - far too little room for the
 *  Special Schedules poster's own day-by-day picture (netzDayGroups, a letter and a
 *  seconds-precise time per day). Every day in the block that needed נץ to move its own
 *  morning (`netzBinding`), reduced to the distinct minutes its own נץ falls on, earliest
 *  to latest: "נץ 7:17-7:18" rather than a time a day, which 150px of panel does not have
 *  the width for even at a fraction of the poster's own size. Sorted by the underlying נץ
 *  value before formatting, not by the formatted string ("7:5" would otherwise sort after
 *  "7:17"). Null where נץ moved nothing in the block, the same as the poster's own note. */
function chanukahPanelNetzNote(dayObjs) {
  const bound = dayObjs.filter((d) => d.netzBinding).sort((a, b) => a.netz - b.netz);
  if (!bound.length) return null;
  const times = [...new Set(bound.map((d) => formatTime(d.netz)))];
  const range = times.length > 1 ? `${times[0]}-${times[times.length - 1]}` : times[0];
  /* U+2066/U+2067/U+2069 (LRI/RLI/PDI) rather than the poster's own <bdi> - shacharis-grid.js
     flattens a line to plain text plus a few flags (underlined, big, small) and does not carry
     DOM structure through it, so a <bdi> here would be dropped on the way back out. These are
     plain Unicode codepoints, invisible but real characters in the text itself, so they survive
     shPlainHtml's escaping untouched and isolate נץ the same way the poster's own bdi does: the
     whole note forced ltr (outer LRI/PDI), נץ isolated inside it with no direction forced on it
     (RLI/PDI, a single word has no internal order to protect), the range isolated and forced ltr
     in its own pair. Measured directly before this: plain "נץ 7:17-7:18" in a direction: ltr
     container (.shacharis-panel) rendered with נץ at the line's own right and the range at its
     left, the reverse of the poster's own established reading for the same phrase. */
  return `⁦⁧נץ⁩ ⁦${range}⁩⁩`;
}

/** The Weekday chart's standing שחרית panel, חנוכה's own addition to it: up to two
 *  two-line blocks, one for the eight days' ordinary mornings and one for ר"ח טבת's own
 *  (which always falls entirely inside them), each of which the panel heads with its own
 *  line the same way it already heads the standing ר"ח/בה"ב/תענית block. Either comes
 *  back null where the page holds none of that kind.
 *
 *  Every day of a kind is merged into that one block regardless of whether its own line
 *  agrees with the others (`chanukahScheduleLines`'s own `mergeAll`), the same trade the
 *  page's standing special-schedule block already makes for בה"ב and Rosh Chodesh alike:
 *  a page-wide panel says one thing about the whole run rather than a line per day, and a
 *  day's own disagreement (נץ drifting a minute) is a live choice, slash-joined, the same
 *  as anywhere else on this sheet. The day-by-day picture is the Special Schedules
 *  poster's job, not this panel's.
 *
 *  Asked for directly, a small נץ note (chanukahPanelNetzNote, one per block that needs one)
 *  now follows, under the ר"ח block rather than one under each block's own schedule - the
 *  wall chart used to carry no נץ note at all, where the Special Schedules poster for the
 *  same days always has. `<span class="small">` is shacharis-grid.js's own signal for a line
 *  to print smaller than the schedule above it (see its own `is-small`, the same mechanism
 *  `is-big` already is): the note is never itself a row of times (it carries a range and the
 *  word נץ, not a schedule), so shacharisGridHtml reads it as a line of its own rather than
 *  trying to grid it, which is what lets it print at all without the block's real times
 *  being misread. */
export function chanukahPanelBlocks(days, settings) {
  const regularDays = days.filter((d) => !hasRoshChodesh(d, settings));
  const roshChodeshDays = days.filter((d) => hasRoshChodesh(d, settings));
  const schedule = (list) => (list.length ? chanukahScheduleLines(list, settings, { mergeAll: true }) : null);
  const note = (list) => (list.length ? chanukahPanelNetzNote(list.map((d) => chanukahShacharisDay(d, settings))) : null);
  const notes = [note(regularDays), note(roshChodeshDays)].filter(Boolean);
  return {
    regular: schedule(regularDays),
    roshChodesh: schedule(roshChodeshDays),
    // Both blocks' own notes, where either has one, printed together rather than one under
    // each block's own schedule - asked for directly, under the ר"ח block specifically
    // (sheet-view.js appends this after both schedules, and ר"ח prints second whenever both
    // blocks exist). Neither note says which block it is its own, the same as the poster's
    // own consolidated note does not say which row either once that moved the same way.
    netz: notes.length ? notes.map((n) => `<span class="small">${n}</span>`).join('\n') : null,
  };
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
    ? `${CH_TEXT.erevShabbos} · ${CH_TEXT.title} פרשת ${parshaNames.join(' ו')}`
    // The calendar tables have not loaded (only reachable when this poster is asked for
    // without them): the sheet still has to say something rather than print nothing.
    : erevShabbosList.map((es) => `${CH_TEXT.erevShabbos} · ${CH_TEXT.title} ${es.night}`).join(' / ');
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
