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
import { VS_TEXT } from './posters/vasikin.js';
import { YK_TEXT } from './posters/yomkippur.js';
import { parseTimes } from './posters/slichos.js';
import { excelWeekday } from './hebrew-calendar.js';

/** The room the ותיקין מנין davens in, said the way the message says it.
 *
 *  The sheet is where this lives: VS_TEXT.where, the line under whose מנין it is. The message
 *  does not carry its own copy of the address, because then moving the מנין would mean changing
 *  it in two places and whichever was forgotten would keep sending people to the old room.
 *
 *  Hebrew on the sheet, English in the message, so the two are held together here. If the sheet
 *  ever says something this does not know the English for, the מנין has moved and nobody can
 *  invent the wording for it: the Hebrew goes into the message as it stands, which reads oddly
 *  in an English sentence and is meant to. That is the sender seeing it has changed and writing
 *  the line themselves, rather than a message that quietly names the wrong room. The box on the
 *  messages page can be typed into for exactly that. */
const NETZ_WHERE = {
  'באולם השמחות': 'in the Simcha Hall of the main B"M',
};
const netzWhere = () => NETZ_WHERE[VS_TEXT.where] || VS_TEXT.where;

/** The ותיקין announcement, off the ותיקין sheet.
 *
 *  What the shul sends for ראש השנה:
 *
 *    There will be a Netz Minyan in the Simcha Hall of the main B"M BOTH days of Yom Tov.
 *    Shacharis 5:44/5:45 Hamelech 6:14/6:15
 *
 *  Two times to a line, slash separated, one per day of yom tov, in the order the sheet prints
 *  them. ראש השנה is always two days, so "BOTH days" is a fixed phrase there and not something
 *  worked out. יום כיפור is always one, so it gets a line of its own wording and one time in
 *  each place rather than a pair.
 *
 *  No d or m on these. The message says where the מנין is in words, in the sentence itself, and
 *  it is neither of the two rooms the letters stand for.
 *
 *  @param poster - straight from buildVasikinPoster, so this reads the sheet rather than
 *    working the times out a second time beside it. */
export function netzMinyanText(poster, which = 'rh') {
  const days = poster?.days || [];
  if (!days.length) return '';
  const at = (calc) => days.map((d) => d.lines?.find((l) => l.calc === calc)?.text).filter(Boolean);
  const shacharis = at('shacharis');
  const hamelech = at('hamelech');
  if (!shacharis.length || !hamelech.length) return '';
  const when = which === 'yk' ? 'on Yom Kippur' : 'BOTH days of Yom Tov';
  return `There will be a Netz Minyan ${netzWhere()} ${when}. `
    + `Shacharis ${shacharis.join('/')} Hamelech ${hamelech.join('/')}`;
}

/** The closing line. The only words in the message that are not read off the sheet. */
const YT_SIGN_OFF_RH = 'KESIVA VACHASIMA TOVA!';

/** Where this מנין davens, said the way the messages say it.
 *
 *  The sheets mark a room and the messages name it with a letter, and these are the same four
 *  things: underlined is בית מדרש למטה, one star is the עזרת נשים, two is אולם השמחות, and
 *  anything unmarked is the main בית מדרש. Read off the shul's own ערב יום כיפור message, whose
 *  "Selichos 7:00m, 7:20en, 7:35d, 8:00sh, 8:20m" is YK_TEXT.erevShacharis mark for mark. */
const ytWhere = (t) => {
  if (t.mark === '**') return 'sh';
  if (t.mark === '*') return 'en';
  return t.underlined ? 'd' : 'm';
};

/** Whether this yom tov wants an עירוב תבשילין line.
 *
 *  **When any day of yom tov is a Friday**, first day or second, because that is the day Shabbos
 *  gets cooked for. Corrected by the shul: this asked whether the *last* day was a Friday, which
 *  is the same answer whenever yom tov runs Thursday into Friday, and the wrong one for a yom tov
 *  that runs Friday into Shabbos. There the Friday is the first day, the last day is Shabbos, and
 *  the עירוב is needed just as much.
 *
 *  ראש השנה happens not to show the difference, since it can fall on a Monday, Tuesday, Thursday
 *  or Saturday and never on a Friday, so its Friday is always the second day. פסח and שבועות do
 *  show it, which is why this is written the general way now rather than when those messages get
 *  built.
 *
 *  The days are handed in rather than taken off the sheet's span, because a span is not a list of
 *  yom tov days: פסח's runs from bedikas chometz to the last day and has חול המועד in the middle,
 *  and a Friday in חול המועד is an ordinary Friday. Each message names its own days, which is the
 *  one place that knows them.
 *
 *  יום כיפור never falls on a Friday, so it does not ask. */
const ytEruv = (daySerials) => (daySerials || []).some((s) => excelWeekday(s) === 6);
const YT_ERUV_LINE = 'ERUV TAVSHILIN';

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

  // ראש השנה is its two days, which are the day before the sheet's last and that last day.
  if (ytEruv([poster?.span?.to - 1, poster?.span?.to])) lines.push(YT_ERUV_LINE);

  const candles = timeFor('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const nightMincha = timeFor('nightMincha');
  if (nightMincha) lines.push(`Mincha ${nightMincha.text}${ytWhere(nightMincha)}`);

  lines.push(YT_SIGN_OFF_RH);
  return lines.join('\n');
}

/** The closing line of the ערב יום כיפור message, as the shul writes it. */
const YT_SIGN_OFF_YK =
  "May HKBH answer everyone's Tefilos Litova & grant us all a Gmar Chasima Tova";

/** The ערב יום כיפור message.
 *
 *  The shul's own, for reference:
 *
 *    Erev Yom Kippur
 *    Selichos 7:00m, 7:20en, 7:35d, 8:00sh, 8:20m
 *    Mincha 1:30m, 2:00m, 2:30m, 3:00m, 3:30m, 4:00m
 *    Hadlakas Neiros 6:21
 *    Kol Nidrei 6:25
 *    Ravs Drasha 7:20
 *    May HKBH answer everyone's Tefilos Litova & grant us all a Gmar Chasima Tova
 *
 *  Its own builder rather than a variant of the ראש השנה one, because it is a different message
 *  wearing the same shape: its own Selichos set, an afternoon of six מנחות rather than four, and
 *  כל נדרי where the others have the evening מנחה. Folding it into one function with three
 *  conditionals would hide that rather than express it.
 *
 *  No עירוב תבשילין line ever: יום כיפור cannot fall on a Friday.
 *
 *  @param poster - straight from buildYomKippurPoster. */
export function erevYomKippurText(poster) {
  const timeFor = (calc) => poster?.dayLines?.find((l) => l.calc === calc)?.times?.[0];

  const lines = ['Erev Yom Kippur'];

  const selichos = parseTimes(YK_TEXT.erevShacharis.times);
  if (selichos.length) lines.push(`Selichos ${ytList(selichos)}`);

  const mincha = parseTimes(YK_TEXT.erevMincha.times);
  if (mincha.length) lines.push(`Mincha ${ytList(mincha)}`);

  const candles = timeFor('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const kolNidrei = timeFor('kolNidrei');
  if (kolNidrei) lines.push(`Kol Nidrei ${kolNidrei.text}`);

  const drasha = timeFor('nightDrasha');
  if (drasha) lines.push(`Ravs Drasha ${drasha.text}`);

  lines.push(YT_SIGN_OFF_YK);
  return lines.join('\n');
}

