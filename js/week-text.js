// The weekly message, the one that goes out on a Sunday for the week ahead.
//
// What the shul sends:
//
//   Week of P' Ki Seitzei
//   Shacharis 7:00m, 7:20en, 7:35d, 8:00m, 8:20en, 8:40d
//   Mincha: 1:35d, 1:50m, 4:15d, 6:35d, 7:30d
//   Mariv: 8:45d, 9:30d, 10:00d, 10:20m, 10:30m, 11:00d, 11:30d
//
// **Every time in it is a cell of the Weekday chart**, which is the whole reason this can be
// built at all: the shul's rule for this page is that nothing works from a new calculation and
// everything comes off the boards. The three lines are the chart's three columns.
//
//   the morning   the שחרית schedule out of Settings, which is what the chart prints in its own
//                 merged cell, or the סליחות season's own lists where the week is in it. See
//                 wkMornings, which asks the same question the week card asks.
//   Mincha:       the chart's מנחה column, C.
//   Mariv:        the chart's מעריב column, B.
//
// Both of those two are computed by the chart and can be reshaped by a rule or typed over in a
// saved sheet, and this reads whatever the chart ended up printing, overrides and all. So a cell
// somebody corrected by hand reaches the message rather than being computed back to what it was.
//
// The room letters are the chart's own marks, through the one definition every message here uses:
// underlined is d, one star en, two sh, unmarked m. See erevWhereMark in erev-text.js.
//
// Two things the sent messages have that the chart has not got, and which are therefore not here.
// A 7:10 and an 8:10 בעזרת נשים appear in the שחרית of some of them, and a T"T beside the 10:20
// מעריב. Neither is on any chart, so nothing in this program knows when they are or what would
// move them, and the box on the messages page can be typed into. It is the same answer the shul
// already gave for the ROSH CHODESH line's own T"T and its 6:50 בעזרת נשים.
//
// A fourth line joins the three where the week carries the morning after יום כיפור:
//
//   TOMORROW ALL SHACHARIS Minyanim 5 min earlier then posted
//
// It names no minute of its own, only "earlier then posted", which is the Shacharis line right
// above it in the same message, so it cannot say a time the chart disagrees with. See
// afterYomKippurInWeek.

import { erevTimes, erevWhereMark } from './erev-text.js';
import { weekdayMornings } from './posters/day.js';
import { SLICHOS_TEXT } from './posters/slichos.js';
import { hebrewDateExtended, dateFromHebrew, excelWeekday } from './hebrew-calendar.js';

/** The wording, as the shul writes it. The colons are theirs: the morning line has none and the
 *  other two do, in every one of the forty sent messages. */
export const WK_TEXT = {
  title: 'Week of',
  /** In front of a parsha name and not in front of anything else. The sent messages read
   *  "Week of P' Ki Seitzei" but "Week of Rosh Hashana", "Week of Shavuos", "Week of Chanuka":
   *  a week named for the yom tov in it is not a week named for a parsha. */
  parsha: "P'",
  shacharis: 'Shacharis',
  selichos: 'Selichos',
  mincha: 'Mincha:',
  maariv: 'Mariv:',
  /** Where the shul spells a yom tov differently from the calendar's own English table, the same
   *  way ROSH CHODESH says Menachem Av. Their own messages say Sukkos, and so does every other
   *  message on this page, where the table says Succos. Rosh Hashana, Shavuos and Pesach come off
   *  that table already spelled the way they write them. */
  spelling: { Succos: 'Sukkos' },
  /** Sent the week the morning after יום כיפור falls in it, and only that week. No time of its
   *  own, on purpose: it says "earlier then posted" rather than naming a minute, so it cannot
   *  come apart from the Shacharis line printed right above it in the same message. "then" is
   *  the shul's own spelling, kept as sent. */
  afterYomKippur: 'TOMORROW ALL SHACHARIS Minyanim 5 min earlier then posted',
};

/** Whether the day after יום כיפור falls Sunday through Friday of this week (see weekText's own
 *  comment for that range). יום כיפור is 10 תשרי and never falls on a Friday or a Sunday, so the
 *  day after it never falls on a Shabbos, but the check is written as a plain range rather than
 *  leaning on that so the next reader is not left re-deriving why.
 *
 *  Only asked of a week genuinely anchored on a Shabbos. computeWeekdayWeeks in sheets/weeks.js
 *  also emits a trailing-gap row anchored on a season boundary that is not a Saturday at all, to
 *  carry the handful of regular days left over between the last real week and the next season.
 *  Sunday-through-Friday-in-front-of-it is not what that row covers, so shabbosSerial - 6 can
 *  land on an unrelated date; a 5786 gap row anchored the Wednesday after יום כיפור was found
 *  reading its own -6 as landing back on יום כיפור itself and flagging a week the line has no
 *  business being on. */
function afterYomKippurInWeek(shabbosSerial, settings) {
  if (excelWeekday(shabbosSerial) !== 7) return false;
  const year = hebrewDateExtended(shabbosSerial, settings.useGregorianBefore1582).year;
  const dayAfter = dateFromHebrew(10, 7, year) + 1;
  return dayAfter >= shabbosSerial - 6 && dayAfter <= shabbosSerial - 1;
}

/** What the סליחות season's own morning lines are called, in the message's language.
 *
 *  The sheet names each line for what is davened at it, in Hebrew: סליחות on every morning of
 *  the season and שחרית on the first day, which has none (they were said the night before). The
 *  message is written the way the shul writes it, and the shul's own week of ראש השנה message
 *  opens "Week of Rosh Hashana Selichos 6:40...". */
const WK_MORNING_NAMES = {
  [SLICHOS_TEXT.title]: WK_TEXT.selichos,
  [SLICHOS_TEXT.shacharis]: WK_TEXT.shacharis,
};

/** One chart cell as a row of מנינים, each with the room it is in.
 *
 *  The cell carries newlines, since the chart splits a long list over two printed lines, and the
 *  times are read in the order they are written, which is the order the day runs in. */
function wkRow(cell) {
  const times = erevTimes(cell);
  if (!times.length) return '';
  return times.map((t) => t.text + erevWhereMark(t)).join(', ');
}

/** The mornings of the week, as the board's own week block has them.
 *
 *  **The everyday שחרית is not the morning of every week**, and the shul asked why this message
 *  was still saying it was. From the first סליחות to יום כיפור the shul opens earlier and on a
 *  different list, which is on the סליחות sheet; on the week of שבת שובה nobody davens the
 *  everyday 7:00 at all. The message said 7:00 anyway, because it only ever read the one cell
 *  out of Settings.
 *
 *  So it asks `weekdayMornings`, which is the same question the week card and the week's One
 *  sheet ask, and answers with the season's own lines and whether the everyday list is still the
 *  rule on any morning left over. Three views, one answer: the message cannot now say a morning
 *  the card does not.
 *
 *  One line per schedule, each naming its days, which is what the sheet's own bracket
 *  ("6:40 ... (יום ב' וה' 6:35)") means. The days are left off where there is nothing to tell a
 *  line apart from, since "Selichos (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday)" is
 *  the whole week said the long way.
 *
 *  The everyday line goes under them rather than over them. It is the exception on a week like
 *  that, not the rule, and printing it first reads as though the week ran on those times and the
 *  סליחות were the odd morning out.
 *
 *  ר"ח and בה"ב days are deliberately not here, though the card draws them: ROSH CHODESH is its
 *  own message on this page, and no sent weekly message has ever named one. */
function wkMornings(shacharisCell, shabbosSerial, settings) {
  let block = null;
  try {
    block = weekdayMornings(shabbosSerial, settings, shacharisCell, null);
  } catch {
    // A season that will not build is a week this knows nothing special about.
    block = null;
  }
  const season = block?.season || [];
  const lines = [];
  const named = season.length > 1 || (season.length > 0 && block?.everydayStands);
  for (const group of season) {
    const times = wkRow(group.html);
    if (!times) continue;
    const label = WK_MORNING_NAMES[group.name] || WK_TEXT.shacharis;
    lines.push(`${label}${named && group.day ? ` (${group.day})` : ''} ${times}`);
  }
  if (!lines.length || block?.everydayStands !== false) {
    const times = wkRow(shacharisCell);
    if (times) lines.push(`${WK_TEXT.shacharis} ${times}`);
  }
  return lines;
}

/** What the week is called, after "Week of".
 *
 *  A parsha takes the shul's "P'" in front of it and a yom tov does not. */
export function weekName(english, isParsha) {
  const name = String(english ?? '').trim();
  if (!name) return '';
  if (isParsha) return `${WK_TEXT.parsha} ${name}`;
  return WK_TEXT.spelling[name] || name;
}

/** The message for one week.
 *
 *  @param shacharisCell - WEEKDAY_SHACHARIS, the chart's own merged שחרית cell.
 *  @param row - the Weekday chart's row for that week, overrides applied: C is מנחה, B is מעריב.
 *  @param name - "P' Ki Seitzei" or "Sukkos", from weekName.
 *  @param shabbosSerial - the Shabbos the week runs up to, which is what the chart anchors on.
 *  @param settings - for the סליחות season, which is a calendar question.
 *
 *  A line the chart has not got is left out rather than guessed at, and a week with no מנחה and
 *  no מעריב at all is not a week to send a message about, so it answers with nothing. */
export function weekText(shacharisCell, row, name, shabbosSerial, settings) {
  const mincha = wkRow(row?.C);
  const maariv = wkRow(row?.B);
  if (!mincha && !maariv) return '';

  const lines = [`${WK_TEXT.title} ${name}`.trim()];
  lines.push(...wkMornings(shacharisCell, shabbosSerial, settings));
  if (mincha) lines.push(`${WK_TEXT.mincha} ${mincha}`);
  if (maariv) lines.push(`${WK_TEXT.maariv} ${maariv}`);
  if (afterYomKippurInWeek(shabbosSerial, settings)) lines.push(WK_TEXT.afterYomKippur);
  return lines.join('\n');
}
