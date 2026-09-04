// Every column on every chart, and every line on every poster, and how each is worked out.
//
// Two readers at once. The plain rule is in the shul's own terms, for checking that the
// board says what it should. The exact rule under it is the formula as the code has it,
// for checking the port against the workbook. Neither has to read the other's half.
//
// The columns themselves are not listed here. They come from the same KAYITZ_COLUMNS,
// CHOREF_COLUMNS and WEEKDAY_COLUMNS the charts are built from, so this page cannot
// describe a column that no longer exists or quietly miss one that was added: a column
// with no prose still gets a card, saying in as many words that it has not been written
// up. That is deliberate rather than a gap. A page that silently omitted it would look
// complete while being wrong, and the test watches for that sentence.
//
// The posters are listed the same way and for the same reason. They have lines rather than
// columns, and a label cannot key them: מנחה, שקיעה and מעריב are each on the ראש השנה sheet
// more than once with a different rule each time. So every line carries a `calc` name beside
// the rule that made it, and the prose here is keyed on that. A line whose calc has no prose
// gets a card saying so, exactly as a column does.
//
// The worked examples are not written down either: they are produced by calling the real
// build functions for a real week, and the real poster builders for the yomim noraim coming
// up, so a number on this page is the number on that board or that sheet.

import { buildSlichosPoster } from '../posters/slichos.js';
import { buildRoshHashanaPoster } from '../posters/roshhashana.js';
import { buildYomKippurPoster, buildAfterYomKippurPoster } from '../posters/yomkippur.js';
import { buildTzomGedaliaPoster } from '../posters/tzomgedalia.js';
import { nextYomimNoraim } from './posters-view.js';
import { hebrewYear } from '../hebrew-calendar.js';
import { KAYITZ_COLUMNS, buildKayitzRow } from '../sheets/kayitz.js';
import { CHOREF_COLUMNS, buildChorefRow } from '../sheets/choref.js';
import { WEEKDAY_COLUMNS, buildWeekdayRow } from '../sheets/weekday.js';
import { currentSerial } from './nav-helpers.js';
import { weekEndsMins } from '../upcoming.js';
import { resolveSettings } from '../settings.js';
import { UL_START, UL_END } from '../format.js';

const calcEsc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A built cell as readable text: the underline sentinels become an <u>, the line breaks
 *  become real ones. Same content the chart prints, without the chart. */
function cellHtml(text) {
  if (!text) return '<span class="calc-blank">(blank that week)</span>';
  // Escaped first. The underline sentinels are private use characters, so escaping cannot
  // touch them, and swapping them for tags afterwards cannot let anything else through.
  return calcEsc(text)
    .split(UL_START)
    .join('<u>')
    .split(UL_END)
    .join('</u>')
    .split('\n')
    .join('<br>');
}

/** A rule is either the words themselves or a function of the settings, for the few that
 *  quote a number a person can change. */
const text = (rule, settings) => (typeof rule === 'function' ? rule(settings) : rule);

/** Every Hebrew run in an English sentence, isolated.
 *
 *  Done here rather than by hand because these rules are nearly all English sentences with
 *  Hebrew words in them, and every one of those words is a chance to get it wrong. Left
 *  plain, a neutral character next to the Hebrew is absorbed into it and moves: "worked
 *  from שקיעה: 45 minutes" rendered as "worked from 45 :שקיעה minutes", with the colon
 *  jumping the number. Measured before and after, not guessed.
 *
 *  Runs of Hebrew letters are taken whole, along with the geresh and gershayim inside
 *  abbreviations like גר״א and the spaces between words of one phrase, so הדלקת נרות is
 *  one isolated run rather than two. */
const HEBREW_RUN = /[\u0590-\u05FF]+(?:[ \u0590-\u05FF\u05F3\u05F4"']*[\u0590-\u05FF]+)*/g;
const isolateHebrew = (html) => html.replace(HEBREW_RUN, (run) => `<bdi>${run}</bdi>`);

// --- what each column is ---------------------------------------------------------------
// Keyed by the column key the chart uses. `plain` is the rule in words; `exact` is the
// formula. Both are prose: the numbers in them are the fixed times written into the
// formulas, and anything a person can change in Settings is filled in from Settings at
// render time rather than written down here.

const SHARED = {
  B: {
    plain: 'Motzei Shabbos מעריב. Two times: 60 minutes after שקיעה, then 72 minutes after it. The 72 is underlined, so it davens למטה.',
    exact: 'צאת 60 and צאת 72, both measured from שקיעה at the shul\'s elevation, each rounded up to the whole minute, printed with a slash between them. The second is underlined.',
  },
  C: {
    plain:
      'Shabbos afternoon מנחה. It starts at 1:40 on daylight saving time and 1:20 on standard time. Then 5:30, 6:00 and 6:30, each printed only once שקיעה is late enough for it. Then two more worked from שקיעה: 45 minutes before it, and 30 minutes before it. Printed over two lines.',
    exact:
      'First 1:40 when DST is in force, otherwise 1:20. Then each of 5:30, 6:00 and 6:30 is kept only if 5:30pm, 6:00pm or 6:30pm respectively is at or before שקיעה minus one hour; the kept ones are underlined. Then the earlier of (שקיעה minus 45 minutes, rounded up) and 7:00, and the earlier of (שקיעה minus 30 minutes, rounded up) and 7:30, the second underlined. Rounded up rather than down, which is what the workbook does here and nowhere else. The list is split across two lines, the longer half second.',
  },
  D: {
    plain:
      'סוף זמן קריאת שמע, both opinions. The earlier of the two is the מגן אברהם, whose day runs from עלות; the later is the גר״א, whose day runs from sunrise.',
    exact:
      'סוף זמן שמע מ״א with the day measured from עלות 72 minutes to צאת 72 minutes, then סוף זמן שמע גר״א from sunrise to שקיעה, printed with a slash between them in that order.',
  },
  E: {
    plain: 'שחרית. The same two times every week, 7:30 and 8:15, with 7:30 underlined for למטה. Nothing about it is worked out from the date.',
    exact: 'The literal string 7:30 / 8:15, the 7:30 underlined, with no-break spaces around the slash so it can never wrap.',
  },
  H: {
    plain: (settings) =>
      `הדלקת נרות, with שקיעה printed underneath it. Candle lighting is ${settings.candleLightingMinutes} minutes before שקיעה, which is the offset set in Settings: change it there and every Friday on every chart moves with it.`,
    exact:
      'שקיעה at the shul\'s elevation, rounded down to the whole minute, is the second line. The first line is that time less the candle lighting offset from Settings.',
  },
};

const KAYITZ_RULES = {
  ...SHARED,
  F: {
    plain: 'Friday מעריב, 50 minutes after שקיעה. Between Pesach and Shavuos it is 55 minutes instead.',
    exact:
      'שקיעה on the Friday plus 50 minutes, rounded down, underlined. Inside the Sefirah window the offset is 55 rather than 50. That window is Hebrew day-of-year above 16 and below 65, measured on the Friday.',
  },
  G: {
    plain:
      'The מנחה that runs straight into מעריב, 15 minutes before שקיעה. Between Pesach and Shavuos a second מעריב is printed under it, half an hour after שקיעה.',
    exact:
      'שקיעה on the Friday less 15 minutes, rounded down. In the same Sefirah window as column מעריב, a second line reading מעריב followed by שקיעה plus 30 minutes, rounded down.',
  },
  I: {
    plain:
      'The פלג מנחה that davens בעזרת נשים, on the מגן אברהם\'s פלג with the day ending at צאת 72. Printed 15 minutes before the פלג, with the פלג itself under it. Only in the season when the early minyanim run.',
    exact:
      'פלג המנחה with the day running from עלות 16.1 degrees to צאת 72 minutes. The first line is that less 15 minutes, rounded up; the second is the word פלג and the פלג itself, rounded up. Blank outside the פלג window.',
  },
  J: {
    plain: 'The same thing למטה, but on the פלג with the day ending at צאת 50 rather than 72, so it is a little earlier.',
    exact:
      'פלג המנחה with the day running from עלות 16.1 degrees to צאת 50 minutes. First line that less 15 minutes, rounded up and underlined; second line the פלג itself. Blank outside the פלג window.',
  },
  K: {
    plain: 'The same again on the גר״א\'s פלג, which measures the day from sunrise to שקיעה.',
    exact:
      'פלג המנחה גר״א for the Friday. First line that less 15 minutes, rounded up; second line the פלג itself. Blank outside the פלג window.',
  },
  L: {
    plain:
      'The main ערב שבת מנחה. While the clocks are forward nothing is offered before 1:35, so the list is 1:35, 1:50, 2:15 and 3:00. On standard time it opens earlier, with 12:30, 1:00 and one around 1:15 in front of those. The early ones never come out before מנחה גדולה: where the clock time would be too early, מנחה גדולה is printed instead.',
    exact:
      'Built from מנחה גדולה לחומרא, which is the later of מנחה גדולה and half an hour after חצות. On standard time only: the later of 12:30 and מנחה גדולה לחומרא, then 1:00, then, when מנחה גדולה לחומרא is before 1:20, the later of it and 1:15. Then, on any day, מנחה גדולה לחומרא if it is after 1:35, otherwise 1:35. Then the fixed 1:50, 2:15 and 3:00. Everything except the last three is underlined. Split across two lines, the longer half second. The three early ones are held to standard time because חורף opens at Sukkos while the clocks are still forward, and through those weeks מנחה גדולה לחומרא sits just under 1:20, which used to put a 1:15 in front of the 1:35.',
  },
};

const CHOREF_RULES = {
  ...SHARED,
  F: {
    plain: 'Friday מעריב, 50 minutes after שקיעה. No Sefirah exception here: in the winter season that stretch does not arise.',
    exact: 'שקיעה on the Friday plus 50 minutes, rounded down, underlined.',
  },
  G: {
    plain:
      'The Friday מנחה. Through most of the winter it is the single time 15 minutes before שקיעה. Once the early minyanim start running, three פלג times are printed before it on the same line: the גר״א\'s פלג, then the מגן אברהם\'s to צאת 50, then to צאת 72, each 15 minutes early.',
    exact:
      'Outside the פלג window: שקיעה less 15 minutes, rounded down. Inside it, four times joined by slashes: פלג גר״א less 15, פלג with the day ending at צאת 50 less 15, פלג with the day ending at צאת 72 less 15, and שקיעה less 15 rounded down. The three פלג values are not rounded to the minute before the 15 is taken off.',
  },
  I: KAYITZ_RULES.L,
};

const WEEKDAY_RULES = {
  B: {
    plain:
      'The weekday מעריב times, one row for the whole week. The regular list is 6:35, 7:00, 7:30, 8:00, 8:45, 9:30, 10:00, 10:30, 11:00, and 11:30 and 12:00 while BMG is out of session. Every one of them has to be at least 50 minutes after שקיעה on all five days, so as the days lengthen each is pushed later in 5 minute steps until it clears. A time pushed up to within a quarter of an hour of the next one stops being printed. All of them are למטה except 10:30, which is the main בית מדרש, and the 8:45.',
    exact:
      'Sunday through Thursday of the week ending on this Shabbos. The binding שקיעה is the latest of the five, rounded up; a time must be at or after that plus 50 minutes. Each time steps forward by 5 minutes until it does. Then, walking from the last time backwards, a time that moved and now sits within 14 minutes of the next one still being kept is dropped. The 8:45 is exempt from that, being its own מנין rather than a duplicate; it is in the main בית מדרש up to 8:45, למטה from 8:50 to 9:15, and בעזרת נשים from 9:20.',
  },
  C: {
    plain:
      'The weekday מנחה times. The regular list is 12:45 and 1:15 on standard time only, then an early afternoon one, then 1:50, then 4:15 while BMG is in session, then 6:35, 7:30 and 8:00. The evening ones have to be at least 15 minutes before שקיעה on all five days, so they are pulled earlier in 5 minute steps as the days shorten, and one that lands within a quarter of an hour of the one before it stops being printed. Everything is למטה except 1:50, the main בית מדרש. The days between יום כיפור and סוכות are the exception: that week the column carries the schedule off the יום כיפור sheet instead, whose own opening מנחה is held to מנחה גדולה.',
    exact:
      'Sunday through Thursday of the week ending on this Shabbos. 12:45 and 1:15 only when none of the five days is on DST. The early afternoon time is 1:35, or 1:40 if מנחה גדולה לחומרא is after 1:35 on any of the five days. 4:15 only in a BMG week. The binding שקיעה is the earliest of the five, rounded down; an evening time must be at or before that less 15 minutes, and steps back by 5 minutes until it is. A time that moved and sits within 14 minutes of the one before it is dropped. On the week whose Sunday-to-Thursday run holds the last day between יום כיפור and סוכות, all of the above is set aside and the schedule from the יום כיפור sheet is printed. Its list opens at 1:15, or at מנחה גדולה לחומרא where that is later, taken from the latest of the run\'s own days; and if that leaves under 15 minutes to the 1:35 behind it, the opening מנין is not printed at all.',
  },
  E: {
    plain:
      'שחרית on the weekday chart is not worked out at all. It is one merged cell down the whole chart, holding whatever is typed into Settings, so the daily schedule is written once rather than computed.',
    exact:
      'Taken from the שחרית field in Settings, rendered as the small markup subset that field stores. A week carrying a fast or a Rosh Chodesh uses the second field instead.',
  },
};

const CHARTS = [
  { key: 'kayitz', name: 'שבת קיץ', columns: KAYITZ_COLUMNS, rules: KAYITZ_RULES, build: buildKayitzRow,
    note: 'Pesach to Sukkos. The early פלג minyanim run for part of it, which is why it has four מנחה columns the winter chart does not.' },
  { key: 'choref', name: 'שבת חורף', columns: CHOREF_COLUMNS, rules: CHOREF_RULES, build: buildChorefRow,
    note: 'Sukkos to Pesach. A page holding a week past the spring clock change prints as a full שבת קיץ chart instead, so the last page of a winter season can be a summer one.' },
  { key: 'weekday', name: 'Weekday', columns: WEEKDAY_COLUMNS, rules: WEEKDAY_RULES, build: buildWeekdayRow,
    note: 'One row per week, covering Sunday through Thursday. Every time on it has to work for all five days at once, which is what makes it the only chart whose times move themselves.' },
];

// --- what each poster line is ----------------------------------------------------------
// Same two answers as a column, keyed on the `calc` name the builder puts beside the line.
// `rows` turns a built poster into the lines the page shows, so what is listed is what that
// poster actually produced this year rather than a list kept in step by hand.

/** The times of one line as the sheet sets them, underlines and marks and all. */
function posterTimes(times) {
  if (times == null) return '';
  if (typeof times === 'string') return times;
  const one = (t) => {
    if (typeof t === 'string') return t;
    const text = String(t.text ?? '');
    return (t.underlined ? UL_START + text + UL_END : text) + (t.mark || '');
  };
  return (Array.isArray(times) ? times : [times]).map(one).join(' / ');
}

const POSTER_SHEETS = [
  {
    key: 'slichos',
    name: 'סליחות',
    note: 'The one poster with no arithmetic in its times: every one of them is a מנין slot the shul sets, and none of them moves with the sun. What is worked out is the calendar around them, which is what used to be wrong every few years when this was retyped: which mornings each of the two long lines covers, and which of יום ב\' and יום ה\' fall inside it.',
    build: (year, settings) => buildSlichosPoster(year, settings),
    rows: (built) => built.rows.map((r) => ({
      key: r.label,
      name: r.label,
      value: posterTimes(r.times) + (r.note ? '\n' + r.note : ''),
    })),
    rules: {
      'דרשה מאת הרב שליט"א': {
        plain: 'The דרשה on the first night, before the first סליחות. A fixed 12:30.',
        exact: 'Not calculated. Written into the poster\'s own table, which is where every time on this sheet comes from.',
      },
      'סליחות מוצ"ש': {
        plain: 'The first סליחות, on the מוצאי שבת that opens the run. A fixed 12:55.',
        exact: 'Not calculated. From the same table. Which מוצאי שבת it is comes from the run\'s start, below.',
      },
      "שחרית יום א' (no סליחות)": {
        plain: 'The Sunday morning that opens the run. It is the only morning of the season with no סליחות, those having been said the night before, so it has its own list and its own line.',
        exact: 'Not calculated. Six fixed מנינים. The first Sunday itself is the Sunday on or before 29 אלול, moved a week earlier when that would leave fewer than four days of סליחות, which is why the run is four mornings in some years and nine in others.',
      },
      'סליחות': {
        plain: 'Every סליחות morning after that first Sunday, up to but not including ערב ר"ה, which has a line of its own. Six fixed מנינים, with a note saying that the first one is five minutes earlier on the mornings there is קריאת התורה, because the davening runs longer.',
        exact: 'The times are fixed. The days are every day from the Sunday after the run opens up to the day before ערב ר"ה, skipping Shabbos, which has no weekday שחרית to print. The note names whichever of יום ב\' and יום ה\' actually fall in that stretch, and says nothing at all when neither does: a four-morning run in a year ר"ה opens on a Thursday goes Sunday to Wednesday and never reaches a Thursday.',
      },
      'ערב ר"ה': {
        plain: 'ערב ראש השנה\'s own morning, which is the longest סליחות of the year and starts earlier still. Two fixed מנינים.',
        exact: 'Not calculated. 29 אלול, the day before ר"ה.',
      },
      'צום גדליה': {
        plain: 'The fast day\'s morning. Five fixed מנינים, the same list the צום גדליה sheet prints.',
        exact: 'Not calculated. The day is 3 תשרי, or the 4th when the 3rd is Shabbos.',
      },
      'עשי"ת': {
        plain: 'The rest of the עשרת ימי תשובה: the mornings between צום גדליה and ערב יו"כ, each of which has a line of its own. Six fixed מנינים and the same קריאת התורה note.',
        exact: 'The times are fixed. The days are 3 through 8 תשרי, less Shabbos, less צום גדליה and less the 9th, all of which are listed separately. The note is worked the same way as the סליחות line\'s, and is likewise absent in a year where neither יום ב\' nor יום ה\' falls in the stretch.',
      },
      'ערב יו"כ': {
        plain: 'ערב יום כיפור\'s morning, which is back to the everyday times. Five fixed מנינים.',
        exact: 'Not calculated. 9 תשרי.',
      },
    },
  },
  {
    key: 'rh',
    name: 'ראש השנה',
    note: 'The most calculated of the sheets: nearly every time on it moves with the year, and so does its shape. A day\'s heading gathers the night that opens it, so the שקיעה and מעריב under יום א\' are ערב ר"ה\'s and the ones under יום ב\' are the first day\'s. The מעריב at the very foot is מוצאי יום טוב.',
    build: (year, settings) => buildRoshHashanaPoster(year, settings),
    rows: (built) => [
      { key: 'slichosLine', name: 'סליחות ערב ר"ה', value: '' },
      { key: 'chatzos', name: 'חצות', value: built.chatzos },
      { key: 'erevMincha', name: 'מנחה ערב ראש השנה', value: '' },
      ...built.blocks.flatMap((block) => block.lines.map((l) => ({
        key: l.calc,
        name: `${block.heading} · ${l.label}`,
        value: posterTimes(l.times) + (l.extra ? '   ' + l.extra.label + ' ' + posterTimes(l.extra.times) : ''),
      }))),
    ],
    rules: {
      slichosLine: {
        plain: 'ערב ראש השנה\'s own סליחות, repeated at the head of this sheet from the סליחות one so the two days can be read without both sheets. Fixed times.',
        exact: 'Not calculated. The same two מנינים the סליחות sheet prints on its ערב ר"ה line.',
      },
      chatzos: {
        plain: 'חצות on ערב ראש השנה, which is when the שופר stops being blown. A זמן, not a מנין.',
        exact: 'True solar noon on 29 אלול, taken down to the whole minute.',
      },
      erevMincha: {
        plain: 'ערב ראש השנה\'s afternoon מנחה, before the day starts. Four fixed times.',
        exact: 'Not calculated: 1:35, 1:50, 2:15 and 3:00, written into the sheet\'s own wording. The 1:35 is למטה.',
      },
      candles: {
        plain: 'הדלקת נרות on ערב ראש השנה, the usual number of minutes before שקיעה.',
        exact: (settings) => `שקיעה on the night that opens the first day, less the ${settings.candleLightingMinutes} minutes set in Settings.`,
      },
      nightMincha: {
        plain: 'The מנחה that runs into the first night, a quarter of an hour before שקיעה.',
        exact: 'שקיעה of ערב ראש השנה less 15 minutes.',
      },
      nightShkia: {
        plain: 'שקיעה of the night that opens this day. A זמן, not a מנין.',
        exact: 'Sunset at the shul\'s horizon on the day before the block\'s own day: under יום א\' that is ערב ר"ה, under יום ב\' the first day.',
      },
      nightDrasha: {
        plain: 'The דרשה on the first night, half an hour after שקיעה, announced to a round time.',
        exact: 'שקיעה of ערב ראש השנה plus 30 minutes, taken to the nearest 5.',
      },
      nightMaariv: {
        plain: 'מעריב on the night that opens this day, an hour after שקיעה.',
        exact: 'That night\'s שקיעה plus 60 minutes. Printed on both days, worked on each day\'s own opening night.',
      },
      shacharis: {
        plain: 'שחרית, with המלך on the same line. Both fixed.',
        exact: 'Not calculated: 7:30 and 8:30. המלך rides on the שחרית line as a second name and time rather than as one run of text, so it takes the same gap between word and time that every other row has.',
      },
      krias: {
        plain: 'סוף זמן קריאת שמע, given both ways: the מגן אברהם\'s first, then the גר"א\'s.',
        exact: 'The מ"א on a day running from עלות 72 minutes to צאת 72 minutes, the גר"א on a day running נץ to שקיעה, each a quarter of the way through its own day. Printed מ"א then גר"א, joined by the charts\' own slash.',
      },
      drashaBeforeMusaf: {
        plain: 'On a first day that is Shabbos there is no שופר, so the דרשה moves to before מוסף. An announcement with no time on it.',
        exact: 'Printed instead of the דרשה קודם תקיעת שופר whenever this day is Shabbos.',
      },
      nineHours: {
        plain: 'ט\' שעות, given both ways like the קריאת שמע above it. Printed only on a day that is Shabbos, standing in for the שופר lines.',
        exact: 'Nine seasonal hours from the start of the day, counted forward. The מ"א on a day running from עלות 72 minutes to צאת 72 minutes, the גר"א on a day running נץ to שקיעה: each day divided by twelve and nine of those taken. Printed מ"א then גר"א, which on this זמן is the later one first, unlike the קריאת שמע line above it.',
      },
      drashaBeforeShofar: {
        plain: 'The דרשה before תקיעת שופר, on a day that is not Shabbos. An announcement with no time on it.',
        exact: 'Printed instead of the דרשה קודם מוסף whenever this day is not Shabbos.',
      },
      shofar: {
        plain: 'תקיעת שופר, given as an approximate time because it follows the davening rather than the sun.',
        exact: 'Not calculated: a fixed 11:40, and only on a day that is not Shabbos.',
      },
      shofarWomen: {
        plain: 'The second תקיעת שופר, for the women, in the afternoon. Also approximate.',
        exact: 'Not calculated: a fixed 3:05, and only on a day that is not Shabbos.',
      },
      dayMincha: {
        plain: 'The afternoon מנחה, an hour before that day\'s own שקיעה. One of the two days carries an earlier מנין in front of it as well, so there is daylight after מנחה for תשליך.',
        exact: 'That day\'s שקיעה less 60 minutes, taken down to the last 5. The תשליך day gets a second time 50 minutes in front of that, underlined for למטה, and it is the first day unless the first day is Shabbos, when תשליך is put off and so is the earlier מנין.',
      },
      motzeiMaariv: {
        plain: 'מוצאי יום טוב, at the foot of the second day. Two times, 60 and 72 minutes after שקיעה, the 72 underlined for למטה.',
        exact: 'The second day\'s own שקיעה plus 60 minutes and plus 72 minutes. The only place on this sheet the 72 minute צאת is printed, and the same way round the boards print a two time מעריב.',
      },
    },
  },
  {
    key: 'yk',
    name: 'יום כיפור',
    note: 'One sheet for ערב יום כיפור and the day, ending with the schedule that runs from the morning after until סוכות. As on the ראש השנה sheet, the שקיעה and מעריב at the head belong to the night that opens the day.',
    build: (year, settings) => buildYomKippurPoster(year, settings),
    rows: (built) => [
      ...built.erevLines.map((l) => ({ key: l.calc, name: 'ערב יו"כ · ' + l.label, value: posterTimes(l.times) })),
      ...built.dayLines.map((l) => ({
        key: l.calc,
        name: l.label,
        value: posterTimes(l.times) + (l.extra ? '   ' + l.extra.label + ' ' + posterTimes(l.extra.times) : ''),
      })),
      { key: built.nextMorning.calc, name: built.nextMorning.label, value: posterTimes(built.nextMorning.times) },
      { key: 'afterShacharis', name: 'אחרי יו"כ · שחרית', value: posterTimes(built.after.shacharis) },
      { key: 'afterMincha', name: 'אחרי יו"כ · מנחה', value: posterTimes(built.after.mincha) },
      { key: 'afterMaariv', name: 'אחרי יו"כ · מעריב', value: posterTimes(built.after.maariv) },
    ],
    rules: {
      erevShacharis: {
        plain: 'ערב יום כיפור\'s morning, back on the everyday times. Five fixed מנינים.',
        exact: 'Not calculated. Set in the sheet\'s own wording, and the same list the סליחות sheet prints on its ערב יו"כ line.',
      },
      erevMincha: {
        plain: 'ערב יום כיפור\'s afternoon מנחה, before the fast. Six fixed times, half an hour apart.',
        exact: 'Not calculated: 1:30 through 4:00 in half hours.',
      },
      candles: {
        plain: 'הדלקת נרות, the usual number of minutes before שקיעה.',
        exact: (settings) => `ערב יום כיפור's שקיעה less the ${settings.candleLightingMinutes} minutes set in Settings.`,
      },
      erevShkia: {
        plain: 'שקיעה on ערב יום כיפור, which is when the fast begins. A זמן, not a מנין.',
        exact: 'Sunset at the shul\'s horizon on 9 תשרי.',
      },
      kolNidrei: {
        plain: 'כל נדרי, on the next round five after הדלקת נרות, and on the five after that when the first would leave less than four minutes to light in.',
        exact: 'הדלקת נרות taken up to the next 5. If that leaves under 4 minutes, up to the 5 after it. תשפ"ו lights at 6:21 and davens at 6:25, exactly four; תשפ"ד lights at 6:33, where 6:35 would leave two, so it goes to 6:40.',
      },
      nightDrasha: {
        plain: 'The דברי התעוררות on the night, half an hour before מעריב, announced to a round time.',
        exact: 'The night\'s מעריב less 30 minutes, taken to the nearest 5.',
      },
      nightMaariv: {
        plain: 'מעריב on the night of כל נדרי, 72 minutes after שקיעה.',
        exact: 'ערב יום כיפור\'s שקיעה plus 72 minutes.',
      },
      shacharis: {
        plain: 'שחרית on the day, with המלך on the same line. Both fixed.',
        exact: 'Not calculated: 7:30 and 8:30, the same pair the ראש השנה sheet prints.',
      },
      krias: {
        plain: 'סוף זמן קריאת שמע on יום כיפור, given the מגן אברהם\'s way and then the גר"א\'s.',
        exact: 'Worked exactly as on the ראש השנה sheet: a quarter of the way through the day, the מ"א on עלות 72 to צאת 72 and the גר"א on נץ to שקיעה, on 10 תשרי.',
      },
      yizkor: {
        plain: 'יזכור, given as an approximate time because it follows the davening.',
        exact: 'Not calculated: a fixed 11:55.',
      },
      dayMincha: {
        plain: 'מנחה on יום כיפור, an hour and fifty minutes before נעילה.',
        exact: 'נעילה less 110 minutes. Since נעילה is itself worked back from the 60 minute מעריב, this is that מעריב less 220 minutes.',
      },
      drashaBeforeNeila: {
        plain: 'The דברי התעוררות before נעילה. An announcement with no time on it.',
        exact: 'Printed every year, with no time beside it: it is said when מנחה ends.',
      },
      neila: {
        plain: 'נעילה, an hour and fifty minutes before the first מעריב of מוצאי יום כיפור.',
        exact: 'The 60 minute מעריב less 110 minutes, taken to the nearest 5. Which is what moves נעילה earlier as the year puts יום כיפור later in the autumn.',
      },
      motzeiMaariv: {
        plain: 'מוצאי יום כיפור. Two times, 60 and 72 minutes after שקיעה, the 72 underlined for למטה.',
        exact: 'יום כיפור\'s own שקיעה plus 60 and plus 72 minutes, the same way round the boards print a two time מעריב.',
      },
      maarivGimmel: {
        plain: 'A third מעריב, למטה, for anybody who has not davened yet. On every year\'s sheet.',
        exact: 'Not calculated: a fixed 10:00, underlined for למטה.',
      },
      kiddushLevana: {
        plain: 'קידוש לבנה, offered two ways: after מעריב, or at a set time.',
        exact: 'Not calculated. The words אחר מעריב and a fixed 10:30, set as a pair rather than as one long label.',
      },
      nextMorning: {
        plain: 'The morning after יום כיפור, which is the everyday שחרית run five minutes early. The heading names the day.',
        exact: 'Every time in the שחרית schedule from Settings, each less 5 minutes. The day name comes from the calendar, so the heading is right whichever day the 11th of תשרי falls on.',
      },
      afterShacharis: {
        plain: 'The box at the foot: the schedule from the morning after יום כיפור until סוכות. שחרית is the everyday one out of Settings, unchanged.',
        exact: 'Taken straight from the שחרית field in Settings, so this sheet and the boards cannot drift apart.',
      },
      afterMincha: {
        plain: 'That schedule\'s מנחה. Four fixed times, then one every 20 minutes from 4:40 for as long as a מנין still lands a quarter of an hour before שקיעה, and sometimes one more squeezed in behind them. The first of the four is held to מנחה גדולה.',
        exact: 'The opening מנין is 1:15, or מנחה גדולה לחומרא where that is later, taken from the latest of the days this list is offered on, and dropped altogether when the move leaves it under 15 minutes in front of the 1:35 behind it. Then the fixed 1:35, 1:50 and 4:15; then every 20 minutes from 4:40 while the time is at or before the earliest שקיעה of the run less 15 minutes; then one last one near the middle of the 15 to 20 minute window before שקיעה, when the 20 minute run stopped at least 15 minutes short of it. Everything is למטה except the 1:50.',
      },
      afterMaariv: {
        plain: 'That schedule\'s מעריב. The first one moves with שקיעה and the rest do not.',
        exact: 'The first is 7:30, pushed on in fives until it is a full 50 minutes after the earliest שקיעה of the run, but never past 7:45, which is a quarter of an hour in front of the 8:00 behind it. Then the fixed 8:00, 8:30, 8:45, 9:00, 9:30, 10:00, 10:30, 11:00, 11:30 and 12:00.',
      },
    },
  },
  {
    key: 'after',
    name: 'אחרי יום כיפור',
    note: 'The same schedule the box at the foot of the יום כיפור sheet gives, set large on a sheet of its own: the days between יום כיפור and סוכות. It is also what the Weekday chart prints in the מנחה and מעריב columns of that week, so all three come from one calculation.',
    build: (year, settings) => buildAfterYomKippurPoster(year, settings),
    rows: (built) => [
      { key: 'afterShacharis', name: 'שחרית', value: posterTimes(built.after.shacharis) },
      { key: 'afterMincha', name: 'מנחה', value: posterTimes(built.after.mincha) },
      { key: 'afterMaariv', name: 'מעריב', value: posterTimes(built.after.maariv) },
    ],
    rules: null, // filled in below from the יום כיפור sheet's, which are the same three
  },
  {
    key: 'tzom',
    name: 'צום גדליה',
    note: 'A fast day on one page. The morning is a fixed list, and everything in the afternoon hangs off שקיעה: the last מנין is 45 minutes in front of it, the one before that 45 minutes in front of the last, and the one before that 45 minutes again.',
    build: (year, settings) => buildTzomGedaliaPoster(year, settings),
    rows: (built) => built.sets.map((set) => ({
      key: set.calc,
      name: set.head || set.note?.label || '',
      value: set.note ? set.note.text : (set.lines || []).map(posterTimes).join('\n'),
    })),
    rules: {
      shacharis: {
        plain: 'The morning. Five fixed מנינים, starting earlier than an ordinary day because a fast day does.',
        exact: 'Not calculated, and not the ר"ח בה"ב ותענ"צ schedule out of Settings either: this is the list the sheet the shul hangs prints, written into the poster. The same five the סליחות sheet gives on its צום גדליה line.',
      },
      mincha: {
        plain: 'Two fixed early times, then three worked back from שקיעה, 45 minutes apart.',
        exact: 'A fixed 1:35 למטה and 1:50, then: the last is שקיעה less 45 minutes to the nearest 5; the middle is that less 45 minutes put up to the next quarter hour; the first is a plain 45 minutes before the middle, already on a quarter hour. The two roundings going opposite ways is deliberate and is what reproduces the תשפ"ו sheet, where a 6:49 שקיעה gives 4:45, 5:30 and 6:05. The two that open the run are למטה.',
      },
      shkia: {
        plain: 'שקיעה, which is when the fast ends. It stands on its own between מנחה and מעריב, with no heading, because it is a זמן and not a מנין.',
        exact: 'Sunset at the shul\'s horizon on the day of the fast, which is 3 תשרי, or the 4th when the 3rd is Shabbos. ר"ה can only open on a Monday, Tuesday, Thursday or Shabbos, so the one case that defers is a Thursday ר"ה.',
      },
      maariv: {
        plain: 'Two times, 35 and 50 minutes after שקיעה, the later one underlined for למטה.',
        exact: 'The fast day\'s שקיעה plus 35 minutes and plus 50 minutes, the same way round the boards print a two time מעריב.',
      },
    },
  },
  {
    key: 'shuva',
    name: 'שבת שובה',
    note: 'The only poster with no times of its own. It is read out of the מנחה cell of that week on the board, through the same code the sheet is drawn with, so it carries the rules and it carries a hand edit to that cell too. Which is the point of reading the cell rather than working the times out again beside it.',
    build: () => null,
    rows: () => [
      { key: 'drasha', name: 'דרשה', value: '' },
      { key: 'mincha', name: 'מנחה', value: '' },
    ],
    rules: {
      drasha: {
        plain: 'The time of the דרשה, taken off the board: it is the time on the line that says דרשה.',
        exact: 'Read out of the שבת שובה week\'s מנחה cell, column C of whichever chart covers that week. Found by the words in front of it rather than by its position, and asked of its own line rather than of the whole cell, so a hand-edited cell can put it anywhere and a second time on another line is not mistaken for it. The דרשה itself is put on the board by the seeded שבת שובה rule, which is in Settings and can be switched off.',
      },
      mincha: {
        plain: 'Every other time in that cell, in order, keeping the marks the board gives them.',
        exact: 'The same cell less the דרשה line. An underline is למטה and a * stuck to the digits is בעזרת נשים, read the way the boards write them. With no chart saved for that year the cell is computed from the calendar instead, which is the same calculation the chart would have made, less any hand edit.',
      },
    },
  },
];

// The sheet of its own and the box at the foot of the יום כיפור sheet are one schedule, so
// they are one set of rules rather than two copies that could drift apart.
POSTER_SHEETS.find((p) => p.key === 'after').rules = POSTER_SHEETS.find((p) => p.key === 'yk').rules;

/** Printed order, left to right. The chart reverses the workbook's B..L so that reading
 *  right to left after the parsha follows the week forward; this lists them the way they
 *  appear across the page. */
const printedOrder = (columns) => [...columns].reverse();

/** A week to work the examples on: whichever the rest of the app is showing, if this
 *  chart covers it, and otherwise the nearest one that chart has. */
function exampleWeek(state, season, settings) {
  const sheets = (state.sheets || []).filter((s) => (season === 'weekday' ? s.season === 'weekday' : s.season === season));
  const weeks = sheets.flatMap((s) => s.weeks || []);
  if (!weeks.length) return null;
  const serial = currentSerial(weeks.map((w) => w.serial), settings, (s) => weekEndsMins(s, state, settings));
  const found = weeks.find((w) => w.serial === serial) || weeks[0];
  return { ...found, date: new Date(found.date) };
}

const fmtWeek = (week) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(week.date);

function chartHtml(chart, state, settings) {
  const week = exampleWeek(state, chart.key, settings);
  let row = {};
  if (week) {
    try {
      row = chart.build(week, settings) || {};
    } catch {
      row = {};
    }
  }

  const entries = printedOrder(chart.columns)
    .map(({ key, header }) => {
      const rule = chart.rules[key];
      const worked = week && key in row
        ? `<div class="calc-worked"><span class="calc-worked-label">That week it comes out</span><span class="calc-worked-value">${cellHtml(row[key])}</span></div>`
        : '';
      return `
        <div class="calc-col">
          <div class="calc-col-head">
            <bdi class="calc-col-name">${calcEsc(String(header).replace(/\n/g, ' '))}</bdi>
            <span class="calc-col-key">column ${calcEsc(key)}</span>
          </div>
          <p class="calc-plain">${rule ? isolateHebrew(text(rule.plain, settings)) : 'Not written up yet.'}</p>
          ${worked}
          ${rule ? `<details class="calc-exact"><summary>The exact rule</summary><p>${isolateHebrew(text(rule.exact, settings))}</p></details>` : ''}
        </div>`;
    })
    .join('');

  const which = week
    ? `<p class="hint">Worked through on <strong>${calcEsc(fmtWeek(week))}</strong>, the week this chart is on now.</p>`
    : '<p class="hint">Generate a season and each column will show what it comes out to that week.</p>';

  return `
    <details class="panel calc-chart" data-chart="${chart.key}">
      <summary><bdi>${calcEsc(chart.name)}</bdi></summary>
      <div class="panel-body">
        <p class="hint">${isolateHebrew(chart.note)}</p>
        ${which}
        <div class="calc-cols">${entries}</div>
      </div>
    </details>`;
}

/** One poster, listed the way a chart is: its lines in the order the sheet has them, each
 *  with the rule that made it and what it came out to for the yomim noraim coming up.
 *
 *  The year is the one the Posters tab opens on, so somebody moving between the two tabs is
 *  reading about the same sheet. A poster that cannot be built for it says so rather than
 *  showing an empty card: שבת שובה is the standing case, having no times of its own. */
function posterHtml(poster, year, settings) {
  let built = null;
  try {
    built = poster.build(year, settings);
  } catch {
    built = null;
  }
  let rows = [];
  if (built || poster.key === 'shuva') {
    try {
      rows = poster.rows(built) || [];
    } catch {
      rows = [];
    }
  }

  const entries = rows
    .map(({ key, name, value }) => {
      const rule = poster.rules?.[key];
      const worked = value
        ? `<div class="calc-worked"><span class="calc-worked-label">This year it comes out</span><span class="calc-worked-value">${cellHtml(value)}</span></div>`
        : '';
      return `
        <div class="calc-col">
          <div class="calc-col-head">
            <bdi class="calc-col-name">${calcEsc(String(name).replace(/\n/g, ' '))}</bdi>
          </div>
          <p class="calc-plain">${rule ? isolateHebrew(text(rule.plain, settings)) : 'Not written up yet.'}</p>
          ${worked}
          ${rule ? `<details class="calc-exact"><summary>The exact rule</summary><p>${isolateHebrew(text(rule.exact, settings))}</p></details>` : ''}
        </div>`;
    })
    .join('');

  return `
    <details class="panel calc-chart" data-poster="${poster.key}">
      <summary><bdi>${calcEsc(poster.name)}</bdi></summary>
      <div class="panel-body">
        <p class="hint">${isolateHebrew(poster.note)}</p>
        ${entries ? '' : '<p class="hint">Nothing to work through here: this sheet has no times of its own.</p>'}
        <div class="calc-cols">${entries}</div>
      </div>
    </details>`;
}

export function renderCalculations(container, state, onOpenTab) {
  const settings = resolveSettings(state.settings);
  const posterYear = nextYomimNoraim();
  container.innerHTML = `
    <h2>Calculations</h2>
    <p class="hint">Every column on every chart and every line on every poster, and how each one is worked out.</p>

    <div class="guide-lede">
      <p>Two answers for each one. The plain rule is what the column or the line is, in the shul's terms. <strong>The exact rule</strong> under it is the formula as the program has it, down to the rounding, for checking against the workbook.</p>
      <p>The numbers beside each rule are not written here: they are produced by running the real formula on a real week, and the real poster on the year coming up, so a time on this page is the time on that board or that sheet.</p>
    </div>

    <p class="hint calc-not-rules">This is not the <button type="button" class="linkish" id="calc-to-rules">Rules in Settings</button>. Those are the shul's own exceptions, the ones that add דרשה on שבת הגדול and mark ט באב, applied on top of everything below. What is here is the calculation underneath, which is the same every year and is not editable: it comes from the workbook the boards were always made from.</p>

    <h3 class="calc-section">The charts</h3>
    ${CHARTS.map((c) => chartHtml(c, state, settings)).join('')}

    <h3 class="calc-section">The posters</h3>
    <p class="hint">The sheets the shul hangs that are not the zmanim board. Same two answers, line by line, worked through on <strong><bdi>${calcEsc(hebrewYear(posterYear))}</bdi></strong>, the yomim noraim the Posters tab opens on.</p>
    ${POSTER_SHEETS.map((p) => posterHtml(p, posterYear, settings)).join('')}

    <details class="panel">
      <summary>Things that are true of every column</summary>
      <div class="panel-body">
        <p><strong>Where the sun is</strong> comes from the שול's location, elevation and timezone in Settings, so moving those moves every time on every chart.</p>
        <p><strong>Underlined</strong> means the מנין davens בבית מדרש למטה. It is set by the formula, not typed, except where a cell has been typed over by hand.</p>
        <p><strong>Friday columns are worked on the Friday</strong>, not on the Shabbos the row is named for. The Shabbos columns are worked on the Shabbos.</p>
        <p><strong>ט באב</strong> is added automatically when the 9th of Av falls on that Shabbos, to the Shabbos מנחה and the motzei Shabbos מעריב. It is a fact of the calendar rather than a rule anyone set, so it is not in the rules list and cannot be switched off.</p>
        <p><strong>Then the rules, then anything typed.</strong> A rule from Settings is applied to the computed value, and a cell typed over by hand wins over both.</p>
      </div>
    </details>
  `;

  container.querySelector('#calc-to-rules')?.addEventListener('click', () => onOpenTab('settings'));
}
