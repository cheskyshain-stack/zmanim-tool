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
import { buildSlichosPoster } from './slichos.js';
import { buildTzomGedaliaPoster } from './tzomgedalia.js';

/** One key at the foot of a paired sheet rather than each half's own, so a mark is explained
 *  once. Merged on the text, since the halves word their lines identically. */
function pairLegend(...posters) {
  const legend = [];
  for (const line of posters.flatMap((p) => p?.legend || [])) {
    if (!legend.some((l) => l.text === line.text)) legend.push(line);
  }
  return legend;
}

/** Both posters for one Hebrew year, and the key to the marks either of them uses. */
export function buildPairPoster(year, settings) {
  if (!year) return null;
  const rh = buildRoshHashanaPoster(year, settings);
  const yk = buildYomKippurPoster(year, settings);
  if (!rh || !yk) return null;

  return {
    hebrewYear: year,
    // ערב ר"ה at one end and the morning after יו"כ at the other.
    span: {
      from: Math.min(rh.span.from, yk.span.from),
      to: Math.max(rh.span.to, yk.span.to),
    },
    rh,
    yk,
    legend: pairLegend(rh, yk),
  };
}

/** סליחות and צום גדליה on one sheet, the other pair.
 *
 *  The same shape as the one above and, again, no new arithmetic: each half is built by its
 *  own module. These two sit together because they are the two small sheets of the season,
 *  the run up to ר"ה and the fast three days after it, and between them they do not fill a
 *  page apiece. */
export function buildSlichosTzomPoster(year, settings) {
  if (!year) return null;
  const slichos = buildSlichosPoster(year);
  const tzom = buildTzomGedaliaPoster(year, settings);
  if (!slichos || !tzom) return null;
  return {
    hebrewYear: year,
    // First סליחות morning at one end and the fast at the other.
    span: {
      from: Math.min(slichos.span.from, tzom.span.from),
      to: Math.max(slichos.span.to, tzom.span.to),
    },
    slichos,
    tzom,
    legend: pairLegend(slichos, tzom),
  };
}
