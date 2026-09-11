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
import { PS_TEXT } from './posters/pesach.js';
import { SK_TEXT } from './posters/sukkos.js';
import { parseTimes } from './posters/slichos.js';
import { excelWeekday, dateFromHebrew } from './hebrew-calendar.js';

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

/** The first line on a sheet carrying a given calc, blocks read in the order they print.
 *
 *  The sheets that run over several days carry the same calc more than once: פסח and סוכות both
 *  open every night of yom tov with a הדלקת נרות and a מנחה three minutes after it. The ערב block
 *  is the first of them, so the first of each is the one these messages are about, and a later
 *  night's candle lighting cannot get into a message sent before the first. */
const ytFirst = (poster, calc) => {
  for (const b of poster?.blocks || []) {
    const l = (b.lines || []).find((x) => x.calc === calc);
    if (l) return l;
  }
  return null;
};

/** One named block of a sheet, and a line off it.
 *
 *  For the message that is not about the sheet's first night: ערב שמיני עצרת is the evening of
 *  הושענא רבה, five blocks into the סוכות sheet, and every one of those blocks before it carries
 *  the same three calcs. Matched on the heading the block prints, which is the sheet's own name
 *  for the day, rather than on a block number that a sheet gaining a block would quietly shift. A
 *  heading can have שבת or עירוב תבשילין joined onto it, so this matches the front of it. */
const ytBlock = (poster, name) =>
  (poster?.blocks || []).find((b) => String(b.heading || '').startsWith(name)) || null;
const ytLine = (block, calc) => (block?.lines || []).find((l) => l.calc === calc) || null;

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


/** The closing line of the ערב פסח message, as the shul writes it.
 *  Spelled the way that message spells it, which is not the way ערב סוכות spells the same two
 *  words. Both are the shul's own and neither is being tidied into the other. */
const YT_SIGN_OFF_PESACH = "Chag Kosher V'Sameach";

/** The ערב פסח message.
 *
 *  The shul's own, for reference:
 *
 *    Erev Pesach
 *    Sof Zeman Achila 10:30
 *    Sof Zeman Biur 11:46
 *    Mincha 1:35d, 1:50m, 2:15m, 3:00m
 *    ERUV TAVSHILIN
 *    Hadlakas Neiros 7:03
 *    Mincha 7:06m
 *    Chag Kosher V'Sameach
 *
 *  Every line off buildPesachPoster: סוף זמן אכילה is four שעות זמניות after עלות and ביעור five,
 *  the afternoon is PS_TEXT.erevMincha4, and the מנחה is three minutes after candle lighting,
 *  which is the sheet's own rule and matches the 7:03 and 7:06 the shul sent.
 *
 *  The lines are found by their calc rather than by position, and the first of each is taken.
 *  The ערב block comes before the day blocks, so the first candle lighting on the sheet is the
 *  one on ערב פסח rather than one of the later nights.
 *
 *  The עירוב is asked about the first days only, 15 and 16 ניסן. Those are what this message
 *  announces. שביעי and אחרון running into Shabbos is a second עירוב and a different message,
 *  sent a week later, and putting it on this one would be a week early.
 *
 *  @param poster - straight from buildPesachPoster. */
export function erevPesachText(poster) {
  const timeOf = (calc) => ytFirst(poster, calc)?.times?.[0];

  const lines = ['Erev Pesach'];

  const achila = timeOf('achila');
  if (achila) lines.push(`Sof Zeman Achila ${achila.text}`);

  const biur = timeOf('biur');
  if (biur) lines.push(`Sof Zeman Biur ${biur.text}`);

  /* Absent in a year where ערב פסח is Shabbos: that afternoon is Shabbos's own and is on the
     board rather than on this sheet, so the sheet does not carry the line and neither does this. */
  const mincha = ytFirst(poster, 'erevMincha')?.times;
  if (mincha?.length) lines.push(`Mincha ${ytList(mincha)}`);

  const year = poster?.hebrewYear;
  if (year && ytEruv([dateFromHebrew(15, 1, year), dateFromHebrew(16, 1, year)])) {
    lines.push(YT_ERUV_LINE);
  }

  const candles = timeOf('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const nightMincha = timeOf('candlesMincha');
  if (nightMincha) lines.push(`Mincha ${nightMincha.text}${ytWhere(nightMincha)}`);

  lines.push(YT_SIGN_OFF_PESACH);
  return lines.join('\n');
}


/** The opening and closing lines of the ערב סוכות message, as the shul writes them.
 *
 *  The sign-off is the same two words פסח's is and is spelled differently, "Sameiach" against
 *  "Sameach". Both are copied off the shul's own sent messages and neither is being tidied into
 *  the other: this file's job is to write what the shul writes. */
const YT_TITLE_SUKKOS = 'Erev Sukkos-Chag Simchaseinu';
const YT_SIGN_OFF_SUKKOS = "Chag Kosher V'Sameiach";

/** The ערב סוכות message.
 *
 *  The shul's own, for reference:
 *
 *    Erev Sukkos-Chag Simchaseinu
 *    Mincha 1:15d, 1:35d, 1:50m, 2:15m, 3:00m
 *    Hadlakas Neiros 6:13
 *    Mincha 6:16
 *    Chag Kosher V'Sameiach
 *
 *  The shortest of them: no סליחות, no חצות, no סוף זמן. The afternoon is sukkosErevMincha, which
 *  is where the 1:15 that moves to 1:20 or drops out altogether is decided, so a year whose מנחה
 *  גדולה is late sends four times rather than five and this does not have to know why.
 *
 *  The evening מנחה carries its room letter where the sent message left it off. The letters are
 *  the sheet's marks everywhere else in this file, and that מנין is in the main בית מדרש, so the
 *  line reads "6:16m". One character, and it is the one that makes every message on the page say
 *  the room the same way.
 *
 *  The עירוב is asked of 15 and 16 תשרי. 15 תשרי is never a Friday, since ראש השנה never is and
 *  they are the same weekday, so in practice this is asking about יום ב'. That is the same day the
 *  sheet puts its own עירוב תבשילין note over, which is the check that these two agree.
 *
 *  @param poster - straight from buildSukkosPoster. */
export function erevSukkosText(poster) {
  const timeOf = (calc) => ytFirst(poster, calc)?.times?.[0];

  const lines = [YT_TITLE_SUKKOS];

  const mincha = ytFirst(poster, 'erevMincha')?.times;
  if (mincha?.length) lines.push(`Mincha ${ytList(mincha)}`);

  const year = poster?.hebrewYear;
  if (year && ytEruv([dateFromHebrew(15, 7, year), dateFromHebrew(16, 7, year)])) {
    lines.push(YT_ERUV_LINE);
  }

  const candles = timeOf('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const nightMincha = timeOf('candlesMincha');
  if (nightMincha) lines.push(`Mincha ${nightMincha.text}${ytWhere(nightMincha)}`);

  lines.push(YT_SIGN_OFF_SUKKOS);
  return lines.join('\n');
}


/** The ערב שמיני עצרת message.
 *
 *  The shul's own, for reference:
 *
 *    Erev Shemini Atzeres
 *    Mincha 1:15d, 1:35d, 1:50m, 2:15m, 3:00m
 *    Hadlakas Neiros 6:02
 *    Mincha 6:05m
 *
 *  **No sign-off, and that is what the sent message does.** Every other one of these ends on a
 *  fixed line and this one simply stops after the מנחה. Written the way it was sent rather than
 *  given a "Chag Kosher V'Sameiach" of its own to match its neighbours.
 *
 *  Off the שמיני עצרת block rather than the first block on the sheet: this evening is הושענא
 *  רבה's, five blocks in, and every block before it carries the same three calcs.
 *
 *  **The afternoon is the sheet's and it disagrees with the message that was sent.** The sheet
 *  prints the whole run למטה, because the shul asked for it: the main בית מדרש is being set up
 *  for the night and there is nowhere upstairs to daven (see sukkosErevMincha's allDown). The
 *  October 2025 message says 1:50m, 2:15m and 3:00m, which is the old arrangement. The sheet is
 *  what gets printed and hung, so the sheet is what this reads, which is the whole point of these
 *  messages being read off it. If the shul says the message was right and the sheet is wrong, the
 *  fix belongs in sukkosErevMincha and both move together.
 *
 *  The עירוב is asked of 22 and 23 תשרי, שמיני עצרת and שמחת תורה, which is the same question
 *  the sheet asks over its own heading (eiruvShmini).
 *
 *  @param poster - straight from buildSukkosPoster. */
export function erevShminiAtzeresText(poster) {
  const block = ytBlock(poster, SK_TEXT.shmini);
  if (!block) return '';
  const timeOf = (calc) => ytLine(block, calc)?.times?.[0];

  const lines = ['Erev Shemini Atzeres'];

  const mincha = ytLine(block, 'erevMincha')?.times;
  if (mincha?.length) lines.push(`Mincha ${ytList(mincha)}`);

  const year = poster?.hebrewYear;
  if (year && ytEruv([dateFromHebrew(22, 7, year), dateFromHebrew(23, 7, year)])) {
    lines.push(YT_ERUV_LINE);
  }

  const candles = timeOf('candles');
  if (candles) lines.push(`Hadlakas Neiros ${candles.text}`);

  const nightMincha = timeOf('candlesMincha');
  if (nightMincha) lines.push(`Mincha ${nightMincha.text}${ytWhere(nightMincha)}`);

  return lines.join('\n');
}
