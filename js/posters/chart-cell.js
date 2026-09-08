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
