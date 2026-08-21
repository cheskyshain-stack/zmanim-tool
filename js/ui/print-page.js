// Printing.
//
// One button a screen, which opens the browser's own print dialog and lets the person
// choose there what they want: which pages, which printer, portrait or landscape. Each
// page used to carry its own "Print this page" as well, on top of a "Print all" at the
// top, which was two answers to one question in two places on the same screen.
//
// There was a printWith() here that put a class on the body for the length of a print
// run, so that both week cards could be laid out on one landscape sheet for the printer
// and taken apart again straight after. That sheet is a view you can sit on now (see
// pairView in ui/week-view.js), so there is nothing left that has to be assembled for the
// dialog and pulled down afterwards. Printing is printing what is on the screen.

/** The one print button a screen carries. Plain window.print(): everything on the screen
 *  is what goes to the dialog, and the choosing happens there. */
export function printButtonHtml(id = 'print-btn') {
  return `<button type="button" class="btn-primary print-btn" id="${id}">Print</button>`;
}

export function wirePrintButton(root, id = 'print-btn') {
  root.querySelector(`#${id}`)?.addEventListener('click', () => window.print());
}
