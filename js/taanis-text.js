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
// **Only צום גדליה is built, because it is the only fast this program has a sheet for.**
// `posters/tzomgedalia.js` is the sheet the shul hangs for that day and it carries all three
// schedules, so every time in the message is read straight off it. The other three public fasts
// have no sheet: their morning is on the wall chart, the ר"ח / בה"ב / תענית list out of Settings,
// but their מנחה and מעריב are on no board at all. A fast afternoon is not the everyday one, as
// those sent messages show: תענית אסתר runs 4:45, 5:10 and 5:15 after the chart's own list ends,
// and מעריב is at the end of the fast rather than at the shul's usual hours. Writing a message
// with two of its three lines missing, or with times this program made up, are both worse than
// not writing one: the person sending it would have to notice. When the shul hangs a sheet for
// one of the other fasts, its message reads off that sheet the way this one does.

import { erevWhereMark } from './erev-text.js';

/** The wording, as the shul writes it.
 *
 *  The name is the shul's own spelling rather than the calendar's ("Fast of Gedalyah"), the same
 *  way ROSH CHODESH says Menachem Av and Mar Cheshvon. The sign-off is the words two of the three
 *  sent messages end on. */
export const TN_TEXT = {
  title: 'Tzom Gedalia',
  mincha: 'Mincha',
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

/** The message, off the צום גדליה sheet.
 *
 *  שקיעה is on the sheet, between מנחה and מעריב, and is not in the message: none of the three
 *  sent fast messages carries it. A line the sheet has not got is left out rather than invented,
 *  and a sheet with none of the three is not a message. */
export function tzomGedaliaText(poster) {
  if (!poster) return '';
  const rows = [
    [tnMorningLabel(poster), tnLine(poster, 'shacharis')],
    [TN_TEXT.mincha, tnLine(poster, 'mincha')],
    [TN_TEXT.maariv, tnLine(poster, 'maariv')],
  ].filter(([, times]) => times);
  if (!rows.length) return '';
  return [TN_TEXT.title, ...rows.map(([label, times]) => `${label} ${times}`), TN_TEXT.signoff].join('\n');
}
