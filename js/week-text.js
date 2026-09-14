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
//   Shacharis   the שחרית schedule out of Settings, which is what the chart prints in its own
//               merged cell. Not computed: it is the same list every weekday, which is exactly
//               why the chart prints it once rather than day by day.
//   Mincha:     the chart's מנחה column, C.
//   Mariv:      the chart's מעריב column, B.
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

import { erevTimes, erevWhereMark } from './erev-text.js';

/** The wording, as the shul writes it. The colons are theirs: Shacharis has none and the other
 *  two do, in every one of the forty sent messages. */
export const WK_TEXT = {
  title: "Week of P'",
  shacharis: 'Shacharis',
  mincha: 'Mincha:',
  maariv: 'Mariv:',
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

/** The message for one week.
 *
 *  @param shacharisCell - settings.weekdayShacharis, the chart's own merged שחרית cell.
 *  @param row - the Weekday chart's row for that week, overrides applied: C is מנחה, B is מעריב.
 *  @param parshaEnglish - "Ki Seitzei", the same name the Erev Shabbos message uses.
 *
 *  A line the chart has not got is left out rather than guessed at, and a week with no מנחה and
 *  no מעריב at all is not a week to send a message about, so it answers with nothing. */
export function weekText(shacharisCell, row, parshaEnglish) {
  const shacharis = wkRow(shacharisCell);
  const mincha = wkRow(row?.C);
  const maariv = wkRow(row?.B);
  if (!mincha && !maariv) return '';

  const lines = [`${WK_TEXT.title} ${parshaEnglish}`.trim()];
  if (shacharis) lines.push(`${WK_TEXT.shacharis} ${shacharis}`);
  if (mincha) lines.push(`${WK_TEXT.mincha} ${mincha}`);
  if (maariv) lines.push(`${WK_TEXT.maariv} ${maariv}`);
  return lines.join('\n');
}
