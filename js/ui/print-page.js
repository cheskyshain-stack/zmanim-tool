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

/* --- Which way up the paper goes ------------------------------------------------------
   The wall charts are landscape and everything else here (week cards, the two-card sheet,
   the posters) is portrait, so the document needs two page sizes. CSS has an answer for
   that, named pages: `@page poster { size: letter portrait }` plus `page: poster` on the
   box. That is what this used to do, and for one sheet on a screen it works.

   It does not survive a run. Printing every poster at once came out as ten sheets of which
   only four had anything on them, and the cause turned out to be the named pages
   themselves: with any `page:` in the document Chrome mispaginates the run, whatever the
   named page says. Measured by counting interior ink page by page in the PDF, over a
   six sheet run:

     named pages, as shipped ............ 10 pages, 4 with content
     `page: auto` on the sheets only .... 16 pages, every sheet split across two
     bare `@page portrait` only .......... 8 pages, every one whole

   So there are no named pages left. There is one bare `@page`, and the view on the screen
   says what it should be, from here, before anything can be printed. A screen only ever
   holds one kind of sheet, so one page size is all a document ever needs.

   Written as a style element rather than a stylesheet rule because the size is not known
   until the view is built, and appended to the head so it comes after css/print.css and
   wins the cascade against the landscape default there. That default is what a browser
   with no JavaScript gets, and it is the charts' orientation because the charts are the
   thing this site is for. */
export function setPrintPage(size) {
  let el = document.getElementById('print-page-size');
  if (!el) {
    el = document.createElement('style');
    el.id = 'print-page-size';
    document.head.appendChild(el);
  }
  const css = `@page { size: ${size}; margin: 0; }`;
  // Only when it changes: rewriting a style element invalidates styles for the whole
  // document, and these render functions run on every arrow press.
  if (el.textContent !== css) el.textContent = css;
}
