// Time-formatting helpers ported from the workbook's TEXT(...,"h:mm"), ROUNDUP/ROUNDDOWN/
// CEILING(...,1/1440) minute-rounding idioms, and the UNDERLINE_TIME function (which
// marks an "alternate" time on the printed sheet by underlining it).
const EPS = 1e-7; // guards against floating point noise landing just the wrong side of a minute

export function ceilToMinute(dayFraction) {
  return Math.ceil(dayFraction * 1440 - EPS) / 1440;
}
export function floorToMinute(dayFraction) {
  return Math.floor(dayFraction * 1440 + EPS) / 1440;
}
export function roundToMinute(dayFraction) {
  return Math.round(dayFraction * 1440) / 1440;
}

/** TEXT(time,"h:mm") - 12-hour clock, no AM/PM, hour 0 displayed as 12. */
export function formatTime(dayFraction) {
  const frac = ((dayFraction % 1) + 1) % 1;
  const totalMinutes = Math.round(frac * 1440) % 1440;
  const h24 = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

// Sentinel markers wrapping "this should render underlined" spans (Private Use Area
// code points, so they can never collide with real content). Kept as plain characters
// through all the string-building/TEXTJOIN-style formula ports, then converted to real
// <u> elements at render time in ui/sheet-view.js. This keeps this module free of any
// HTML concerns.
export const UL_START = '';
export const UL_END = '';

/** UNDERLINE_TIME: accepts either a raw day-fraction or an already-formatted "h:mm"
 *  string (both forms appear in the workbook's formulas) and marks it to render
 *  underlined - the printed sheet's way of flagging an "alternate" time. */
export function underlineTime(value) {
  const text = typeof value === 'number' ? formatTime(value) : value;
  return UL_START + ' ' + text + UL_END;
}

/** "1220" -> "12:20", "130" -> "1:30", "8" -> "8:00". Returns null for anything that
 *  isn't a plausible time on a 12-hour board (hour outside 1-12, minutes past 59), so
 *  the caller can leave those digits untouched rather than mangle them. */
function expandTimeDigits(digits) {
  let hour, minute;
  if (digits.length <= 2) {
    hour = Number(digits);
    minute = '00';
  } else {
    const split = digits.length === 3 ? 1 : 2;
    hour = Number(digits.slice(0, split));
    minute = digits.slice(split);
  }
  if (hour < 1 || hour > 12 || Number(minute) > 59) return null;
  return `${hour}:${minute}`;
}

/** Expands bare digit runs into times so a schedule can be typed as "1220 130" instead
 *  of "12:20/1:30". The lookarounds skip any digits already sitting next to a colon -
 *  without them the "7" of an existing "7:15" would itself be expanded to "7:00". */
export function normalizeTimeShorthand(text) {
  return text.replace(/(?<![\d:])\d{1,4}(?![\d:])/g, (m) => expandTimeDigits(m) ?? m);
}

/** normalizeTimeShorthand, with the spacing between times tidied to a single space.
 *
 *  It used to join them with "/", matching how the computed columns are written, but a
 *  typed מנחה or מעריב is a plain list of times and the slashes only made it noisier. Runs
 *  of whitespace *between two times* collapse to one space; whitespace anywhere else
 *  (inside a Hebrew word, say) is deliberately left alone. */
export function normalizeTimeList(text) {
  return normalizeTimeShorthand(text)
    .trim()
    .replace(/(\d{1,2}:\d{2}\*{0,3})\s+(?=\d{1,2}:\d{2})/g, '$1 ');
}

/** Light contenteditable HTML cleanup, shared by every rich-text field in the app
 *  (sheet cells in ui/sheet-view.js, the shacharis schedule editor in
 *  ui/settings-view.js) so a trivial click-in/click-out does not register as a change:
 *  trims a trailing <br> (left behind by pressing Enter at the end) and normalizes
 *  &nbsp; to a plain space. */
export function normalizeRichText(html) {
  return html
    .replace(/(<br\s*\/?>)+\s*$/i, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
