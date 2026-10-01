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
  /* Whether נץ is actually why this day's ותיקין prints when it does, asked for directly:
     a day the floor wins is a day the shul's own everyday minyan is on the board same as
     any other, and נץ had nothing to do with the printed time - naming it there is a fact
     nobody asked for beside a time that needed no explaining. Read off vasikin's own last
     step rather than compared again here, so this can never disagree with which candidate
     laterOf actually kept. Rosh Chodesh has no floor to have won instead, so its own נץ is
     always why. */
  const netzBinding = isRoshChodesh || vasikin.steps[vasikin.steps.length - 1]?.took === 'this';

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

/** Every day's own נץ that is actually why its ותיקין prints when it does, joined to the
 *  time it is worked from rather than sitting apart in the row's label - the same
 *  "(נץ 6:54)" the הושענא רבה מנין on the סוכות sheet carries beside its own מנין
 *  (`sukkosRow`'s own `note`, joined by a non-breaking space so the two can never split
 *  across a line).
 *
 *  Asked for directly: a day whose own ותיקין sits at the everyday board's own floor
 *  (`netzBinding` false, see chanukahShacharisDay) is a day נץ decided nothing, and naming
 *  it beside a time that needed no explaining is a fact nobody asked for. Dropped from the
 *  group entirely rather than printed anyway, and the note itself is dropped (null) when
 *  the group has no day left that נץ actually explains - a group of only floor days has
 *  nothing for this line to say. Rosh Chodesh has no floor to have won instead, so every
 *  Rosh Chodesh day always keeps its own נץ here. */
const netzNote = (group) => {
  const bound = group.filter((d) => d.netzBinding);
  if (!bound.length) return null;
  return `(נץ ${[...new Set(bound.map((d) => formatTime(d.netz)))].join(SLASH)})`;
};

/** The Special Schedules poster's own way of opening the ראש חודש שחרית line: one time
 *  between the group's own days, rather than the live either-or choice mergedCell writes
 *  everywhere a group disagrees, with the exact נץ each day's own vasikin is worked from -
 *  to the second, not the minute - written beside it, so a reader sees why the two
 *  mornings differ by a minute instead of being asked to take a single in-between clock
 *  time on faith. Asked for directly, and only for this one line: every other group on
 *  this sheet still prints the live choice (see combineShacharisRows, mergedCell).
 *
 *  The between time is the average of the group's own netz-minus-25 candidates, each still
 *  at its own full precision, floored to the start of its minute rather than rounded to the
 *  nearest one - the beginning of the one minute the two mornings actually straddle, not
 *  whichever whole minute happens to land closest to the average.
 *
 *  Handed back as the two pieces rather than one joined string: posters-view.js sets the נץ
 *  note in its own bdi, the same isolation `.poster-row-note` already carries elsewhere on
 *  this sheet, because the Hebrew in "נץ" sitting loose beside the times (unlike the row's
 *  own label, which is outside the times' own ltr run entirely) reads as a strong character
 *  of that run and turns the times after it backwards - measured directly, the same bug the
 *  label itself made before this sheet's own times were given their own direction. */
export function chanukahRoshChodeshVasikin(group) {
  const raw = group.map((d) => d.netz - CH_VASIKIN_BEFORE_NETZ / 1440);
  const between = floorToMinute(raw.reduce((a, b) => a + b, 0) / raw.length);
  const netz = [...new Set(group.map((d) => formatTimeWithSeconds(d.netz)))].join(SLASH);
  return { time: formatTime(between), netz };
}

/** Fewer lines than one per day: consecutive days whose whole morning matches print once,
 *  under a day range rather than a day each ("יום א'-ד'"), the same combining "יום ג'-ד'"
 *  already does on the old sheets.
 *
 *  Rosh Chodesh days combine on their own terms - grouped together whether or not their own
 *  ותיקין time agrees, labelled "ראש חודש" with each day's own letter. The ותיקין time itself
 *  still opens the line of times below the label, the same as every other day - both values
 *  are slash-joined when the group's own days do not agree, the same a live choice between
 *  two times is written anywhere else on this sheet.
 *
 *  A Rosh Chodesh row also carries `isRoshChodesh` and `roshChodeshVasikin`
 *  (chanukahRoshChodeshVasikin's own in-between time and seconds-precise נץ note), which is
 *  what posters-view.js's own chanukahBody reads instead of `cells[0]`/`note` to print that
 *  one line the Special Schedules poster's own way; every other reader of this row (cells,
 *  note, label) is unchanged. */
export function combineShacharisRows(days) {
  const rows = [];
  let i = 0;
  while (i < days.length) {
    if (days[i].isRoshChodesh) {
      let j = i + 1;
      while (j < days.length && days[j].isRoshChodesh) j++;
      const group = days.slice(i, j);
      const label = `ראש חודש ${group.map((d, k) => `${k === 0 ? 'יום ' : 'ו'}${dayLetter(d.serial)}'`).join(' ')}`;
      const cells = group[0].lines.map((_, k) => mergedCell(group.map((d) => d.lines[k])));
      rows.push({ label, cells, note: netzNote(group), isRoshChodesh: true, roshChodeshVasikin: chanukahRoshChodeshVasikin(group) });
      i = j;
      continue;
    }
    let j = i + 1;
    const lineKey = (d) => d.lines.map((t) => t.text()).join('|');
    while (j < days.length && !days[j].isRoshChodesh && lineKey(days[j]) === lineKey(days[i])) j++;
    const group = days.slice(i, j);
    const first = dayLetter(group[0].serial);
    const last = dayLetter(group[group.length - 1].serial);
    rows.push({
      label: group.length === 1 ? `יום ${first}'` : `יום ${first}'-${last}'`,
      cells: group[0].lines.map(toCell),
      note: netzNote(group),
    });
    i = j;
  }
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
 *  poster's job, not this panel's. */
export function chanukahPanelBlocks(days, settings) {
  const regularDays = days.filter((d) => !hasRoshChodesh(d, settings));
  const roshChodeshDays = days.filter((d) => hasRoshChodesh(d, settings));
  const block = (list) => (list.length ? chanukahScheduleLines(list, settings, { mergeAll: true }) : null);
  return { regular: block(regularDays), roshChodesh: block(roshChodeshDays) };
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
