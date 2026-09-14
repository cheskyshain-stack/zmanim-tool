// The fast day message.
//
// The shul sends one the night before every תענית, and the three in the history this was built
// from are one shape:
//
//   Shiva Asar B'Tammuz
//   Shacharis 6:40m, 6:45ns, 7:00en, 7:15d, 7:35sh, 8:00m, 8:20en, 8:40d  (see the morning below)
//   Mincha 1:40d, 1:45ns, 1:50m, 5:00d, 5:45d, 6:35d, 7:15d, 7:45m, 7:55ns
//   Mariv 9:05m & ns, 9:20d
//   Have an easy meaningful fast
//
// (Taanis Esther and Asara B'Teves are the same four lines with their own times.) The name of
// the fast, three schedules, and a sign-off. No colons after the three labels, where the weekly
// message has them after two of its three: both are written the way the shul writes them.
//
// **צום גדליה is the only fast with a sheet, and it is the only one with all three lines.**
// `posters/tzomgedalia.js` is the sheet the shul hangs for that day and it carries שחרית, מנחה and
// מעריב, so every time in that message is read straight off it.
//
// The other three public fasts have **the morning and nothing else**: it is the ר"ח / בה"ב / תענית
// schedule out of Settings, which is the second list the wall chart prints and is what those days
// daven, and their sent messages carry it time for time. Their מנחה and מעריב are on no board at
// all. A fast afternoon is not the everyday one, as those sent messages show: תענית אסתר runs
// 4:45, 5:10 and 5:15 after the chart's own list ends, and מעריב is at the end of the fast rather
// than at the shul's usual hours. So those two lines are **left out rather than invented**, which
// is the rule this whole page runs on, and whoever sends it adds them in the box.
// The page carried צום גדליה alone at first, for fear that a message missing two lines is worse
// than none. The shul asked for the rest: one fast on the page under a switch called Taanis is a
// switch for one message a year, and the morning is the part they have to look up. When a fast
// gets a sheet of its own, its message reads the other two lines off it the way צום גדליה does.
//
// **יום כפור and תשעה באב are not here.** Neither runs that schedule, both have arrangements of
// their own, and the calendar leaves them out of the same list for the same reason (see
// specialDaysInWeek in hebrew-calendar.js).

import { erevTimes, erevWhereMark } from './erev-text.js';
import { hasTaanis } from './hebrew-calendar.js';

/** The wording, as the shul writes it.
 *
 *  The name is the shul's own spelling rather than the calendar's ("Fast of Gedalyah"), the same
 *  way ROSH CHODESH says Menachem Av and Mar Cheshvon. The sign-off is the words two of the three
 *  sent messages end on. */
export const TN_TEXT = {
  title: 'Tzom Gedalia',
  /* What the morning is called on the three fasts that have no sheet. Their own sent messages all
     say Shacharis, and there the chart's schedule is what is being read: the סליחות wording
     belongs to צום גדליה, whose own sheet heads that block with it. */
  shacharis: 'Shacharis',
  mincha: 'Mincha',
  /* שקיעה, which the shul writes "Shkia" in English: their own Shabbos message of 1 August 2025
     reads "Shkia 8:09". The word is theirs, the time is the sheet's. */
  shkia: 'Shkia',
  maariv: 'Mariv',
  signoff: 'Have an easy meaningful fast!',
};

/** **The morning is called what the sheet calls it**, which is סליחות: on a fast the shul opens
 *  earlier and says them, and the sheet is named for what is davened at it rather than for the
 *  תפילה the סליחות are added to. The congregation's own "what is on next" card reads that same
 *  block and says סליחות, and the shul asked for this to say it too.
 *
 *  So the label is taken off the block rather than typed here, and these are the two names that
 *  block can carry, in the message's language. Written out rather than translated, because the
 *  sheet is in Hebrew and the message is in English; anything else the sheet might one day head
 *  it with falls back to Shacharis, which is what a morning is when nothing else is said of it.
 *
 *  The three sent fast messages all say "Shacharis" here. That is the one place this does not
 *  follow them, asked for: they are for the three fasts with no sheet, and on the day this one is
 *  about the board, the phone and the message now say the same word. */
const TN_MORNING_NAMES = { 'סליחות': 'Selichos', 'שחרית': 'Shacharis' };
const TN_MORNING_FALLBACK = 'Shacharis';

/** The three fasts that daven the chart's own ר"ח / בה"ב / תענית schedule, and what the shul calls
 *  them: their own spelling in their own sent messages, rather than the calendar's ("Fast of
 *  Esther", "Tenth of Teves"), the same way ROSH CHODESH says Menachem Av.
 *
 *  Matched on the calendar's English name, asked for in English whatever the boards are set in, so
 *  one spelling of one name is all that has to agree. */
export const TN_FASTS = [
  { calendar: 'Seventeenth of Tammuz', title: "Shiva Asar B'Tammuz" },
  { calendar: 'Tenth of Teves', title: "Asara B'Teves" },
  { calendar: 'Fast of Esther', title: 'Taanis Esther' },
];

/** Every fast in a stretch of days, as the day and what to call it.
 *
 *  Walked a day at a time rather than reckoned, the same as ROSH CHODESH: the calendar already
 *  knows which day a fast falls on and which way it is put off when that day is Shabbos, and a
 *  second answer to that question is a second thing to get wrong. */
export function fastsBetween(from, to, settings) {
  const out = [];
  for (let serial = from; serial <= to; serial += 1) {
    const name = hasTaanis(serial, { ...settings, english: true });
    if (!name) continue;
    const fast = TN_FASTS.find((f) => f.calendar === name);
    if (fast) out.push({ serial, title: fast.title });
  }
  return out;
}

/** A fast whose morning is all the boards have: the chart's own second schedule, read the way
 *  ROSH CHODESH reads it, with the room letters off that cell's own marks.
 *
 *  Nothing at all where the chart has no second schedule to print, since a message that is a
 *  title and a sign-off says nothing anybody needs. */
export function chartFastText(title, shacharisCell) {
  const times = erevTimes(shacharisCell);
  if (!times.length) return '';
  const list = times.map((t) => t.text + erevWhereMark(t)).join(', ');
  return [title, `${TN_TEXT.shacharis} ${list}`, TN_TEXT.signoff].join('\n');
}

/** A list of the sheet's times, each with the room it is in: underlined is d, one star en, two
 *  sh, unmarked m. The one definition every message on this page uses. */
const tnList = (times) => (times || []).map((t) => t.text + erevWhereMark(t)).join(', ');

/** One block of the sheet, found by the rule behind it rather than by its heading, so rewording a
 *  heading cannot quietly empty a line of the message. */
const tnBlock = (poster, calc) => (poster?.sets || []).find((s) => s.calc === calc) || null;
const tnLine = (poster, calc) => tnList((tnBlock(poster, calc)?.lines || [])[0]);
const tnMorningLabel = (poster) => {
  const head = String(tnBlock(poster, 'shacharis')?.head || '').trim();
  return TN_MORNING_NAMES[head] || TN_MORNING_FALLBACK;
};

/** The שקיעה the sheet prints, which is a זמן rather than a block of מנינים: on the sheet it is a
 *  note standing on its own between מנחה and מעריב, the name and the time together. Read out of the
 *  same block, so the paper and the message cannot name two different minutes.
 *
 *  It carries no room letter, for the reason no letter is written beside חצות or הדלקת נרות: a
 *  letter says which בית מדרש a מנין is in, and this is not one. */
const tnShkia = (poster) => String(tnBlock(poster, 'shkia')?.note?.text || '').trim();

/** The message, off the צום גדליה sheet.
 *
 *  Four lines and a sign-off: the morning, מנחה, שקיעה and מעריב, in the order the sheet sets them.
 *  **שקיעה is on it because the shul asked for it on every fast message**, and it is the one line
 *  here none of the three sent fast messages carries. It belongs: the end of the fast is reckoned
 *  from it, and whoever is looking at the message wants to know when to daven מנחה by.
 *
 *  A line the sheet has not got is left out rather than invented, and a sheet with none of them is
 *  not a message. */
export function tzomGedaliaText(poster) {
  if (!poster) return '';
  const rows = [
    [tnMorningLabel(poster), tnLine(poster, 'shacharis')],
    [TN_TEXT.mincha, tnLine(poster, 'mincha')],
    [TN_TEXT.shkia, tnShkia(poster)],
    [TN_TEXT.maariv, tnLine(poster, 'maariv')],
  ].filter(([, times]) => times);
  if (!rows.length) return '';
  return [TN_TEXT.title, ...rows.map(([label, times]) => `${label} ${times}`), TN_TEXT.signoff].join('\n');
}
