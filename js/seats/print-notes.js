import { seatsPrintGeometry } from './print.js';

export const SEATS_PRINT_NOTE_DEFAULTS = {
  printHeader: 'First Draft',
  printFooter: 'Anyone who would like a seat should speak to the Gabbaim.',
};
export const SEATS_PRINT_NOTE_LIMITS = { printHeader: 80, printFooter: 240 };

export function seatsPrintNotes(plan) {
  return Object.fromEntries(Object.entries(SEATS_PRINT_NOTE_DEFAULTS).map(([key, fallback]) =>
    [key, typeof plan[key] === 'string' ? plan[key] : fallback]));
}

export function seatsNormalizePrintNotes(plan) {
  const notes = {};
  for (const [key, limit] of Object.entries(SEATS_PRINT_NOTE_LIMITS)) {
    // Missing values keep the starting wording; an empty string deliberately hides it.
    if (plan[key] == null) continue;
    if (typeof plan[key] !== 'string' || plan[key].length > limit) throw new Error('Use up to ' + limit + ' characters for the ' + (key === 'printHeader' ? 'header' : 'footer') + '.');
    notes[key] = plan[key].replace(/\s+/gu, ' ').trim();
  }
  return notes;
}

export function seatsWrapPrintNote(text, width, measure) {
  const lines = []; let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && measure(line + ' ' + word) <= width) { line += ' ' + word; continue; }
    if (line) lines.push(line);
    line = '';
    for (const letter of word) {
      if (line && measure(line + letter) > width) { lines.push(line); line = ''; }
      line += letter;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function seatsPrintLayout(plan) {
  const notes = seatsPrintNotes(plan), base = seatsPrintGeometry(plan.paper);
  const canvas = document.createElement('canvas').getContext('2d');
  let headerFont = 10, headerLines;
  do {
    canvas.font = 'bold ' + headerFont + 'px Arial';
    headerLines = seatsWrapPrintNote(notes.printHeader, base.contentWidth * 72 * .30, text => canvas.measureText(text).width);
    if (headerLines.length <= 2 || headerFont <= 5) break;
    headerFont -= .5;
  } while (true);
  canvas.font = '9px Arial';
  const footerLines = seatsWrapPrintNote(notes.printFooter, base.contentWidth * 72, text => canvas.measureText(text).width);
  const footer = footerLines.length ? (footerLines.length * 11 + 5) / 72 : 0;
  return { notes, headerFont, headerLines, footerLines, geometry: seatsPrintGeometry(plan.paper, footer) };
}
