// The Erev Yom Tov message, as a block of text somebody can paste into a chat.
//
// The same idea as the Erev Shabbos message in erev-text.js, and for the same reason:
// somebody types this out by hand every year off a sheet that already has every time on it,
// so it is read off that sheet instead and there is one place the times come from.
//
// What the shul sends for ערב ראש השנה, and the shape this builds:
//
//   Erev Rosh Hashana
//   Selichos 6:30m, 7:10d
//   Chatzos 12:53
//   Mincha 1:35d, 1:50m, 2:15m, 3:00m
//   Hadlakas Neiros 6:54
//   Mincha 6:57m
//   KESIVA VACHASIMA TOVA!
//
// Where each piece comes from, all of it out of buildRoshHashanaPoster:
//
//   Selichos      RH_TEXT.slichos.times, the סליחות מנין on ערב ר"ה.
//   Chatzos       the poster's own חצות, cut to the minute rather than rounded, because no
//                 printed זמן should say חצות is a minute later than it is.
//   Mincha        RH_TEXT.erevMincha.times, the afternoon menu.
//   Hadlakas      the first day's block, its candles line: שקיעה less the shul's candle
//                 lighting minutes.
//   Mincha        the same block's nightMincha: שקיעה less fifteen. It is after candle
//                 lighting and that is not a mistake, it is how the evening runs.
//
//   d / m         the same convention the Erev Shabbos message uses: underlined on the sheet
//                 means בית מדרש למטה, so d, and anything else is the main בית מדרש, so m.
//                 See the note in erev-text.js.
//
// חצות and הדלקת נרות carry no room letter, because neither is a מנין.
//
// Names here are prefixed rather than shared with erev-text.js on purpose: the offline build
// flattens every module into one scope, where a second const of the same name is a hard error.

import { RH_TEXT } from './posters/roshhashana.js';
import { parseTimes } from './posters/slichos.js';

/** The closing line. The only words in the message that are not read off the sheet. */
const YT_SIGN_OFF_RH = 'KESIVA VACHASIMA TOVA!';

/** d or m: where this מנין davens, said the way the message says it. */
const ytWhere = (t) => (t.underlined ? 'd' : 'm');

/** A row of מנינים, each with the room it is in. */
const ytList = (times) => times.map((t) => t.text + ytWhere(t)).join(', ');

/** The ערב ראש השנה message.
 *
 *  @param poster - straight from buildRoshHashanaPoster, so this reads exactly what the
 *    printed sheet reads and cannot drift from it.
 *
 *  Every line is skipped rather than guessed at when the sheet has not got it. A message
 *  missing a line is one somebody can see is short; a message carrying a time nobody
 *  computed is one they cannot. */
export function erevRoshHashanaText(poster) {
  const first = poster?.blocks?.[0];
  const timeFor = (calc) => first?.lines?.find((l) => l.calc === calc)?.times?.[0];

  const lines = ['Erev Rosh Hashana'];

  const slichos = parseTimes(RH_TEXT.slichos.times);
  if (slichos.length) lines.push(`Selichos ${ytList(slichos)}`);

  if (poster?.chatzos) lines.push(`Chatzos ${poster.chatzos}`);

  const mincha = parseTimes(RH_TEXT.erevMincha.times);
  if (mincha.length) lines.push(`Mincha ${ytList(mincha)}`);

  const candles = timeFor('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const nightMincha = timeFor('nightMincha');
  if (nightMincha) lines.push(`Mincha ${nightMincha.text}${ytWhere(nightMincha)}`);

  lines.push(YT_SIGN_OFF_RH);
  return lines.join('\n');
}
