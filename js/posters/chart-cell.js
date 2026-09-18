// A wall chart's cell, read back as a poster's own times.
//
// The chart writes a cell as one string: times joined with SLASH, a line break where the
// formula splits them in two, and a private-use character each side of a time that is למטה
// (UL_START, UL_END in format.js). This turns that back into the { text, underlined, mark }
// pieces every row on a poster is made of, so a Shabbos on a yom tov sheet can be the chart's
// own answer rather than a second implementation of it that drifts.
//
// Here rather than in either sheet that reads one. The סוכות sheet had it for שבת חול המועד and
// שבת בראשית, and the פסח sheet needs the very same thing for its own שבת חול המועד. Two copies
// of a reader is two things to keep the same, and the offline build flattens every module into
// one scope, where two functions of one name is a hard error: that is how the pair was found.
import { UL_START } from '../format.js';
import { SLASH } from '../util.js';

export function chartTimes(cell) {
  return String(cell ?? '')
    .split('\n').join(SLASH)
    .split(SLASH)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const bare = part.replace(/[ ]/g, '').trim();
      /* A star stuck to the digits is בעזרת נשים, the same notation the charts and the other
         posters read. None of the columns used today carries one; taken off rather than left in
         the text so a column that grows one does not print "5:41*" as a time. */
      const stars = (bare.match(/\*+$/) || [''])[0];
      return {
        text: bare.slice(0, bare.length - stars.length),
        underlined: part.startsWith(UL_START),
        mark: stars,
      };
    });
}

/** The same, with each time carrying the chart's own trace for it.
 *
 *  The chart already worked these out and wrote down how (sheets/choref.js hands its traces
 *  back beside its columns), so a Shabbos on a yom tov sheet says exactly what the board says
 *  about the same minute. Working it out a second time here is the shape this project keeps
 *  getting hurt by.
 *
 *  Paired by the printed minute rather than by position: a column that splits its times over
 *  two lines or orders them differently would otherwise put one time's working under another,
 *  and a wrong explanation is worse than none. Anything that does not pair is left without a
 *  trace, which the calculations page says in as many words. */
export function chartLine(cell, traces) {
  const pool = [...(traces || [])];
  return chartTimes(cell).map((t) => {
    const i = pool.findIndex((tr) => tr && tr.plain() === t.text);
    return { ...t, trace: i === -1 ? null : pool.splice(i, 1)[0] };
  });
}
