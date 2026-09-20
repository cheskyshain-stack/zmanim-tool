// עירוב תבשילין: when one is made, and the line that says so.
//
// One definition for the three sheets that carry it. It was written out three times, once per
// sheet, and the three had already come apart: ראש השנה put the note over the Friday of יום טוב,
// while סוכות and פסח put it over a block that happens to open with its own ערב. The same note
// named a different day on each sheet.
//
// **When.** Whenever any day of that yom tov is a Friday, first or last. Said by the shul in
// those words: "eiruv tavshilin is when yomtov is on Friday, regardless if its 1st day or 2nd
// day of yom tov". Written the general way even where only one of a pair can ever be the Friday,
// so the next reader is not left working out which of two rules a given line is: 1 תשרי, 15 ניסן
// and 15 תשרי can never be a Friday, so the first days always turn on the second day, and 22
// ניסן can never be one either, so פסח's second pair turn on שביעי.
//
// **Where.** On ערב יום טוב, which is the day it is made on. It is made before יום טוב comes in,
// which is what makes cooking on the Friday for Shabbos allowed; the Friday is the day it is made
// *for*. The shul reported the difference on תשפ"ט, where the note sat over יום ב' של ראש השנה
// and it is made on the Wednesday.
//
// A row of its own on that afternoon, after its מנחה and before its הדלקת נרות, rather than a
// word added to a heading. A heading names a day, and on סוכות and פסח the day it names is the
// yom tov rather than the ערב: "a day's heading gathers the night that opens it" is the shul's
// own shape for those sheets and is not worth breaking to place one note. A row with a label and
// no time is a shape those sheets already print (מכירת עליות, מעריב אחר משנה תורה).

/** The words, in one place. The three sheets' own `*_TEXT.eiruv` read from here, so the label
 *  on the paper and the label the message looks for cannot come apart. */
export const EIRUV_LABEL = 'עירוב תבשילין';

/** Whether an עירוב is made before a yom tov, given the days it runs.
 *
 *  `isFriday` is the sheet's own way of asking, since each counts its days differently; the rule
 *  it is asked with is this one. */
export function eiruvMade(isFriday, ...days) {
  return days.some((d) => isFriday(d));
}

/** The row, or nothing where none is made. Spread into a block's lines.
 *
 *  `calc` names it for the calculations page, the same as every other line on these sheets, and
 *  `wrap` lets the label break where a column is narrow: it is a sentence's worth of words rather
 *  than the name of a מנין. */
export function eiruvRow(made) {
  return made ? [{ label: EIRUV_LABEL, times: [], calc: 'eiruv', wrap: true }] : [];
}

/** Whether a built block carries the row. What the messages ask, so that a message cannot say
 *  ERUV TAVSHILIN on a week the sheet does not print it, or stay silent on one it does. */
export function blockHasEiruv(block) {
  return (block?.lines || []).some((l) => l?.label === EIRUV_LABEL);
}
