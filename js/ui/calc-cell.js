// One cell of a chart, opened up: each time in it, and what made that time.
//
// The shul asked for this shape in place of the paragraphs that used to be here. Somebody
// checking a calculation wants to see the structure, not read for it: this is a fixed time,
// this one is forty five minutes before שקיעה and rounded up, this one is on the board only
// when שקיעה is late enough. So the answer is a short stack of steps under each time, in the
// order the arithmetic happened, each showing what it left behind.
//
// Nothing here calculates. It reads the steps a traced time recorded while the board was
// being built (zmanim/trace.js), which is the same pass that produced the printed cell, so
// this page cannot describe a time the board did not print.

import { UL_START, UL_END } from '../format.js';

/* cellEsc and cellTimeHtml rather than esc and timeHtml: week-sheet.js and posters-view.js
   already have those, and build-offline.py flattens every module into one scope where two
   of a name is a hard error. It caught both. */
const cellEsc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Hebrew inside an otherwise English sentence, isolated so the digits beside it do not join
 *  its run and reverse the line. The Weekday footer cost four rounds over exactly this. */
const HEBREW = /[֐-׿]+(?:[ ֐-׿׳״"'“”]*[֐-׿]+)*/g;
const withHebrew = (s) => cellEsc(s).replace(HEBREW, (run) => `<bdi>${run}</bdi>`);

const minutes = (n) => `${Math.abs(n)} minute${Math.abs(n) === 1 ? '' : 's'}`;

/** One step as a line of English. The value it left behind is shown beside it, so the
 *  arithmetic can be followed down the list rather than taken on trust at the end. */
function stepHtml(s) {
  const because = s.because ? ` <span class="calc-because">${withHebrew(s.because)}</span>` : '';
  const at = s.at ? `<span class="calc-at">${cellEsc(s.at)}</span>` : '';
  const line = (body) => `<li><span class="calc-step-body">${body}${because}</span>${at}</li>`;

  switch (s.kind) {
    case 'base':
      return line(`Starts from <strong>${withHebrew(s.name)}</strong>${s.note ? `, ${withHebrew(s.note)}` : ''}`);
    case 'fixed':
      /* "Nothing about it is worked out" was the old wording and the shul said it reads
         oddly, which it does: it says what the time is not. This says what it is. */
      return line(s.label
        ? `<strong>Set by the shul:</strong> ${withHebrew(s.label)}`
        : '<strong>Set by the shul</strong>, not worked out from the sun');
    case 'offset':
      return line(`${s.minutes < 0 ? 'Take off' : 'Add'} <strong>${minutes(s.minutes)}</strong>`);
    case 'round': {
      const every = s.every ? `the nearest ${s.every} minutes` : 'the whole minute';
      const way = s.way === 'up' ? 'up to' : s.way === 'down' ? 'down to' : 'to';
      return line(`Round <strong>${way} ${every}</strong>`);
    }
    case 'pick': {
      const took = s.took === 'other' ? 'that one wins' : 'this one wins';
      const a = s.against || {};
      /* Named, not just numbered. A reader who sees "the later of this and 1:22" cannot tell
         that 1:22 is מנחה גדולה and so walks through the season with חצות. */
      const other = a.name
        ? `<strong>${withHebrew(a.name)}</strong> (${cellEsc(a.text)})`
        : `<strong>${cellEsc(a.text)}</strong>`;
      const what = a.note ? `<span class="calc-because">${withHebrew(a.note)}</span>` : '';
      return line(`Take the <strong>${s.how}</strong> of this and ${other}, so ${took}${what ? `. ${what}` : ''}`);
    }
    case 'condition':
      return line(s.held
        ? `<strong>On the board this week.</strong> ${withHebrew(s.when)}`
        : `<strong>Not on the board this week.</strong> ${withHebrew(s.when)}`);
    case 'stepped': {
      if (!s.moved) {
        return line(`Stands at this time: it already clears ${withHebrew(s.until || 'its limit')}`);
      }
      const way = s.backwards ? 'earlier' : 'later';
      const target = s.untilAt ? ` (<strong>${cellEsc(s.untilAt)}</strong>)` : '';
      return line(`Moved <strong>${way}</strong> from <strong>${cellEsc(s.from)}</strong>, ${s.by} minutes at a
        time, until it is ${withHebrew(s.until || '')}${target}`);
    }
    case 'underline':
      return line(`Underlined, so this ${withHebrew('מנין')} is <strong>${withHebrew('בבית מדרש למטה')}</strong>`);
    case 'mark':
      return line(`Marked <strong>${cellEsc(s.chars)}</strong>, which says which room it is in`);
    default:
      return '';
  }
}

/** One time and its working. */
function cellTimeHtml(time) {
  const printed = time.plain();
  const dropped = time.held === false;
  /* A dropped time is headed by where it started, not where it ended. On the Weekday chart
     three מנינים can all be pushed onto the same minute and then dropped for crowding, and
     headed by that minute they read as the same entry three times over. What the reader is
     looking for is the standing 6:35 that is not on the board this week. */
  const head = dropped ? (time.steps[0]?.at ?? printed) : printed;
  return `
    <li class="calc-time${dropped ? ' is-dropped' : ''}">
      <div class="calc-time-head">
        <span class="calc-time-value">${cellEsc(head)}</span>
        ${dropped ? '<span class="calc-time-note">not printed this week</span>' : ''}
      </div>
      <ol class="calc-steps">${time.steps.map(stepHtml).join('')}</ol>
    </li>`;
}

/** The cell as the board prints it, underline sentinels turned into a real underline.
 *
 *  Escaped first. The sentinels are private use characters, so escaping cannot touch them and
 *  swapping them for tags afterwards cannot let anything else through. */
export function printedCellHtml(text) {
  if (!text) return '<span class="calc-blank">blank that week</span>';
  return cellEsc(text)
    .split(UL_START).join('<u>')
    .split(UL_END).join('</u>')
    .replace(/\n/g, '<br>');
}

/** A cell that holds no times at all.
 *
 *  The shul asked for this by name: even the parsha should say that it comes from the date.
 *  It has no זמן, no offset and no rounding, so a stack of steps would be the wrong shape.
 *  What it has is a short chain of facts, each derived from the one above it, which is the
 *  same idea said in the form this kind of cell actually takes. */
function factHtml(f) {
  return `
    <li class="calc-fact">
      <div class="calc-fact-head">
        <span class="calc-fact-label">${withHebrew(f.label)}</span>
        <span class="calc-fact-value"><bdi>${withHebrew(f.value)}</bdi></span>
      </div>
      ${f.note ? `<p class="calc-fact-note">${withHebrew(f.note)}</p>` : ''}
    </li>`;
}

/** Everything the opened view shows for one cell.
 *
 *  A cell with no traces still opens and says so in as many words. A page that quietly
 *  skipped one would look complete while being silent about it, which is the failure this
 *  page has always been written to avoid. */
export function cellDetailHtml({ header, key, chartName, printed, times, note, dropped, fallback, facts }) {
  const all = [...(times || []), ...(dropped || [])];
  /* A column whose times are not traced yet falls back to the written rule it has always
     had. The structure is replacing that prose column by column, and a column part way
     through the change must not go quiet: a page that silently dropped an explanation would
     look complete while saying less than it did before. */
  /* A cell with a note and nothing to trace is not an unconverted cell: it is a cell with
     no working to show, and the note is the whole answer. Saying "still described in words"
     over it would be false. */
  const body = facts?.length
    ? `<ol class="calc-facts">${facts.map(factHtml).join('')}</ol>`
    : all.length
    ? `<ol class="calc-times">${all.map(cellTimeHtml).join('')}</ol>`
    : note
      ? ''
      : fallback
      ? `<div class="calc-fallback"><p class="calc-fallback-why">This column is still described in words rather than
          step by step. The rule is the same one the board is built from.</p><p>${withHebrew(fallback)}</p></div>`
      : `<p class="calc-nothing">This cell is not written up yet, so there is nothing to open. That is worth
        reporting rather than working around: every other cell on this chart can say how it was made.</p>`;
  return `
    <div class="calc-open-head">
      <div>
        <bdi class="calc-open-name">${cellEsc(String(header).replace(/\n/g, ' '))}</bdi>
        <span class="calc-open-where">${cellEsc(chartName)}${key ? `, column ${cellEsc(key)}` : ''}</span>
      </div>
      <button type="button" class="calc-close" aria-label="Close">&times;</button>
    </div>
    <div class="calc-open-printed">${printedCellHtml(printed)}</div>
    ${note ? `<p class="calc-open-note">${withHebrew(note)}</p>` : ''}
    ${body}`;
}
