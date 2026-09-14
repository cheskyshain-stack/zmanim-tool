// The שחרית panel's schedule, set in columns instead of as centred lines.
//
// The panel is the one cell on the Weekday chart that is a block of times rather than a single
// row of them, and it was centred line by line: every line was its own width, so the times sat at
// a different place on each and the slashes between them wandered. The shul asked for the columns
// to line up, which on a board people read a time off is worth having.
//
// What comes in is whatever the schedule is written as (WEEKDAY_SHACHARIS in settings.js, or a
// cell typed by hand), so this reads it rather than being told it:
//
//   <span class="big">7:00 / 7:20*
//   <u>7:35</u> / 8:00
//   8:20* / <u>8:40</u></span>
//
// and the ר"ח block underneath it, with a heading between. The separators have been commas, plain
// spaces and slashes on the shul's own browsers over the years (see the LEGACY_ lists in
// settings.js), the line breaks are newlines or the <br> and <div> the editor writes, and the only
// markup that has ever been in it is <u> and <span class="big">.
//
// **Anything else and this does nothing at all.** A line that is not a row of times, or markup
// this does not recognise, and the whole block is handed back exactly as it came in and prints the
// way it printed yesterday. A wall chart is not the place to be clever with somebody's typing.
//
// Three kinds of row come out:
//
//   A row of times, laid on the grid: each time in its own column, each slash in a narrow one
//   between them, and **each asterisk in a narrow column of its own** so that a 8:20* does not
//   push its slash half a character to the right of the slash above it.
//   A line that is not a full row of times (the ר"ח ובה"ב heading, or a last line carrying one
//   time) spans the whole width and is centred, which is where the hand-made boards put it.
//   A blank line is a gap of its own, so the two blocks stay apart.
//
// The underlines are the board's own meaning (בבית מדרש למטה) and are carried through onto the
// time itself. The asterisks are not underlined, which is how the schedule is written.

/** A time and whatever asterisks are stuck to it. The same shape the message builders read
 *  (erevTimes in erev-text.js, parseTimes in posters/slichos.js), written again here because this
 *  reads a DOM rather than a string: the underline is an element around the digits, not a tag in
 *  the text. */
const SH_TIME = /(\d{1,2}:\d{2})(\*{0,2})/g;
/** What may sit between two times without the line stopping being a row of times. */
const SH_BETWEEN = /^[\s /,]*$/;
/** The most times this will set in columns. Three is already a line no board here prints; past
 *  that it is somebody using the cell for something else and the plain lines are safer. */
const SH_MAX = 4;

const shEsc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** The markup this understands, and nothing else.
 *
 *  U and SPAN.big are the two the editor writes, BR and DIV are how it breaks a line, and B and I
 *  are here because the toolbar can write them and they carry no meaning this needs to keep track
 *  of: a line is still a line inside one. Anything else (a table, a font tag, a pasted colour)
 *  means the block is not what this was written for. */
const shKnown = (el) => {
  const tag = el.tagName;
  if (tag === 'U' || tag === 'BR' || tag === 'DIV' || tag === 'P' || tag === 'B' || tag === 'I') return true;
  return tag === 'SPAN' && (el.className === '' || el.className === 'big');
};

/** The block read as lines, each a run of pieces that know whether they are underlined.
 *
 *  Null where anything unrecognised turns up, which is the signal to leave the block alone.
 *  A newline inside a text node breaks a line as much as a <br> does: the panel is set with
 *  white-space: pre-line, so that is what those newlines have always meant on the screen. */
function shReadLines(root) {
  const lines = [[]];
  let ok = true;
  const walk = (node, underlined, big) => {
    if (!ok) return;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = String(child.nodeValue).split('\n');
        parts.forEach((text, i) => {
          if (i) lines.push([]);
          if (text) lines[lines.length - 1].push({ text, underlined, big });
        });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (!shKnown(child)) { ok = false; return; }
      if (child.tagName === 'BR') { lines.push([]); continue; }
      const block = child.tagName === 'DIV' || child.tagName === 'P';
      // A block starts a line of its own, unless the line it would start is already empty.
      if (block && lines[lines.length - 1].length) lines.push([]);
      walk(child, underlined || child.tagName === 'U', big || child.classList?.contains('big'));
      if (block) lines.push([]);
    }
  };
  walk(root, false, false);
  return ok ? lines : null;
}

/** One line read as its times and whether they are slash separated, or null when it is not a row
 *  of times.
 *
 *  The asterisks that follow a time can be written outside the underline and even in the piece
 *  after it, which is how one of the shul's own browsers holds it ("<u>7:15,7:35</u>**"), so a
 *  piece that is nothing but asterisks is given to the time in front of it. */
function shReadTimes(line) {
  const times = [];
  let ok = true;
  /* Whether the schedule separates its times with a slash. **The board draws the separator the
     schedule uses**: the shul writes "7:00 / 7:20*" on one and "7:00 7:20* 7:35" on another, and a
     slash this code put in would be a mark on the paper nobody typed. Either way the times keep
     their columns, which is the whole of what this file is for. */
  let slashed = false;
  for (const piece of line) {
    let last = 0;
    SH_TIME.lastIndex = 0;
    let m = SH_TIME.exec(piece.text);
    while (m) {
      const between = piece.text.slice(last, m.index);
      if (between.includes('/')) slashed = true;
      if (!SH_BETWEEN.test(between)) {
        // Stars belonging to the time before this one, and nothing else.
        if (/^\*{1,2}$/.test(between.trim()) && times.length) times[times.length - 1].mark += between.trim();
        else ok = false;
      }
      times.push({ text: m[1], mark: m[2], underlined: piece.underlined, big: piece.big });
      last = m.index + m[0].length;
      m = SH_TIME.exec(piece.text);
    }
    const tail = piece.text.slice(last);
    /* The slash can sit at the end of a piece as easily as inside one: "8:20* / " and then a
       separate <u>8:40</u>, which is how the shipped schedule holds its third line. Asked of the
       tail as well as of what falls between two times in a piece, or that line came out with no
       slash on a board whose other two had one. */
    if (tail.includes('/')) slashed = true;
    if (/^\s*\*{1,2}\s*$/.test(tail) && times.length) times[times.length - 1].mark += tail.trim();
    else if (!SH_BETWEEN.test(tail)) ok = false;
  }
  return ok && times.length ? { times, slashed } : null;
}

/** A line that is not a row of times, written back out with its underlines kept. */
const shPlainHtml = (line) => line
  .map((p) => (p.underlined ? `<u>${shEsc(p.text)}</u>` : shEsc(p.text)))
  .join('');

/** The schedule as a grid, or null to leave it exactly as it came in.
 *
 *  @param html - the Settings value, both blocks and the heading between them.
 *  @param doc - the document to parse with, so this can be tested without one being global. */
export function shacharisGridHtml(html, doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return null;
  const box = doc.createElement('div');
  box.innerHTML = String(html ?? '');
  const lines = shReadLines(box);
  if (!lines) return null;

  const read = lines.map((line) => {
    const got = line.length ? shReadTimes(line) : null;
    return { line, times: got?.times || null, slashed: Boolean(got?.slashed) };
  });
  const most = Math.max(0, ...read.map((r) => (r.times ? r.times.length : 0)));
  if (most < 2 || most > SH_MAX) return null; // one time a line has nothing to line up

  /* **Each paired row is its own five column grid**: time, asterisk, slash, time, asterisk.
     One grid over the whole block was the first cut and it could not hold both: a column is one
     width for every row in it, the everyday block is set larger than the ר"ח one, and a column
     sized by the larger digits leaves the smaller ones standing off their own asterisk. A row that
     is its own grid is measured in its own em, so nothing has to stretch to fit a neighbour, and
     every row of a block still comes out the same width and lines up with the rest of it.
     The asterisk columns are always there, whether or not there is an asterisk to put in them, and
     that is the whole point of them: 8:20* and 8:00 leave the slash after them in exactly the same
     place. The slash column is narrow and the gaps are zero, so the slash sits against its pair.
     What keeps it the same distance from the time on either side is the column after it: it is one
     asterisk wider than a time needs and the time in it is set to the right, so the width the
     asterisk column takes up in front of the slash is given back behind it. Nothing here is spaced
     with typed spaces. */
  /* **An asterisk column is as wide as the widest mark in that position, and no wider.** Two
     asterisks are twice the ink of one, measured at 1.0em against 0.5em in the boards' serif, so a
     column cut for one had 7:35** hanging half a character out of it and out of its row. Cutting
     every column for two instead would push the whole pair apart to pay for a mark that is on one
     line of the board. Asked per position: the שחרית block has single asterisks in front of its
     slash and a double behind it, so only the last column is the wider one and the gap around the
     slash stays narrow. A position with no mark at all still gets the narrow column, which is what
     keeps the times under each other. */
  const gridFor = (cols, slashed) => {
    /* **A column is reserved for an asterisk only where a row of this shape actually has one.**
       Held open everywhere, it is a character of air between two times that never carry a mark,
       and the shul saw that as too much space. Held open nowhere, a starred row pushes its
       neighbours out of line with the row above, which is what this file exists to stop. Asked per
       position, both are true at once: the שחרית block's stars are all in the same place on every
       line, so the only reserved column is the one they are in and the block prints exactly as
       though it were plain text with one space between the words. */
    const widest = Array.from({ length: cols }, (_, i) => {
      const marks = read.filter((r) => r.times && r.times.length === cols)
        .map((r) => (r.times[i]?.mark || '').length);
      if (marks.some((n) => n > 1)) return 'var(--sh-star2)';
      return marks.some((n) => n > 0) ? 'var(--sh-star)' : '0px';
    });
    /* **A row with no slashes is narrower, and has to be.** The column after a slash is one
       asterisk wider than a time needs, which is what gives the slash the same air on both sides;
       with no slash there is nothing to centre, and that width is a fifth of the row spent on
       nothing. Measured on the shul's own no-slash layout: 184px a row against the 156px there is
       room for inside the panel, and 141px once the mirror comes off. So a slashed row keeps it
       and an unslashed one puts a plain space between the times instead. */
    const between = slashed
      ? (i) => ['var(--sh-slash)', `calc(var(--sh-t) + ${widest[i]})`, widest[i + 1]]
      : (i) => ['var(--sh-space)', 'var(--sh-t)', widest[i + 1]];
    return {
      template: ['var(--sh-t)', widest[0],
        ...Array.from({ length: cols - 1 }, (_, i) => between(i)).flat()].join(' '),
      /* A slashed row is padded on the left by its last asterisk column, which puts the middle
         slash of a row at the middle of the row's own box. Every row is centred in the panel, so
         that is what puts the slash of the smaller ר"ח block under the slash of the larger
         everyday one. With no slash there is nothing to line up between the blocks and nothing to
         pay for it with. */
      pad: slashed ? widest[cols - 1] : '0',
    };
  };

  /* A line that is a row of times is a grid; anything else (the ר"ח ובה"ב heading, a last line
     carrying one time, the blank line between the blocks) is a line of its own, centred under
     them, which is where the boards the shul hangs put it.
     is-big carries the size the everyday block is set in. It wraps the whole block rather than
     any one line, so it is read off the pieces and put back on the row, and the row's own em is
     what every width in its grid is then measured in. */
  const rows = [];
  for (const { line, times, slashed } of read) {
    if (!line.length) { rows.push('<div class="sh-gap"></div>'); continue; }
    const big = line.every((p) => p.big) ? ' is-big' : '';
    if (!times || times.length < 2) {
      rows.push(`<div class="sh-wide${big}">${shPlainHtml(line)}</div>`);
      continue;
    }
    const { template, pad } = gridFor(times.length, slashed);
    const cells = [];
    times.forEach((t, i) => {
      // The separator the schedule itself uses: a slash, or nothing but the column it would sit in.
      if (i) cells.push(`<div class="sh-slash">${slashed ? '/' : ''}</div>`);
      const time = t.underlined ? `<u>${shEsc(t.text)}</u>` : shEsc(t.text);
      cells.push(`<div class="sh-time">${time}</div>`);
      cells.push(`<div class="sh-mark">${shEsc(t.mark)}</div>`);
    });
    rows.push(`<div class="sh-row is-times${big}" style="grid-template-columns: ${template}; padding-left: ${pad}">${cells.join('')}</div>`);
  }
  return `<div class="sh-sched">${rows.join('')}</div>`;
}
