// ראש השנה and יום כיפור on one sheet.
//
// No new arithmetic: it is the two posters the shul already has, built by their own
// modules and set side by side, so a time can never say one thing on the pair and another
// on the single sheet. All this module does is put the two together and work out what the
// combined sheet covers and which marks it has to explain.
//
// The sheet can be printed either way up, which is the caller's choice rather than this
// module's: see the orientation picker on the Posters tab.
import { buildRoshHashanaPoster } from './roshhashana.js';
import { buildYomKippurPoster } from './yomkippur.js';

/** Both posters for one Hebrew year, and the key to the marks either of them uses. */
export function buildPairPoster(year, settings) {
  if (!year) return null;
  const rh = buildRoshHashanaPoster(year, settings);
  const yk = buildYomKippurPoster(year, settings);
  if (!rh || !yk) return null;

  // One key at the foot of the sheet rather than each half's own, so a mark is explained
  // once. Merged on the text, since the two halves word their lines identically.
  const legend = [];
  for (const line of [...(rh.legend || []), ...(yk.legend || [])]) {
    if (!legend.some((l) => l.text === line.text)) legend.push(line);
  }

  return {
    hebrewYear: year,
    // ערב ר"ה at one end and the morning after יו"כ at the other.
    span: {
      from: Math.min(rh.span.from, yk.span.from),
      to: Math.max(rh.span.to, yk.span.to),
    },
    rh,
    yk,
    legend,
  };
}
