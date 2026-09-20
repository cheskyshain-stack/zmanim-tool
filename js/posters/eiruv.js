// Eiruv reminders appear in the first relevant holiday or Erev heading.
// The calendar rule and message detection are shared by all special schedules.

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
  return (block?.heading || '').includes(EIRUV_LABEL) || (block?.erevHeading || '').includes(EIRUV_LABEL) || (block?.lines || []).some((l) => l?.label === EIRUV_LABEL);
}
