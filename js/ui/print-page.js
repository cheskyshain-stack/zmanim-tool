// Printing.
//
// One button a screen, which opens the browser's own print dialog and lets the person
// choose there what they want: which pages, which printer, portrait or landscape. Each
// page used to carry its own "Print this page" as well, on top of a "Print all" at the
// top, which was two answers to one question in two places on the same screen.
//
// printWith stays because one thing genuinely cannot be asked for in that dialog: both
// week cards side by side on one landscape sheet. @page fixes a card at letter portrait,
// so the dialog's own landscape setting changes nothing at all, and it has to be the app
// that sets the paper up. See is-print-pair in print.css.

/** Prints with a class on the body, for a layout that only applies to paper (see
 *  is-print-pair in print.css). The class comes off again when the dialog closes. */
export function printWith(bodyClass) {
  document.body.classList.add(bodyClass);
  const done = () => {
    document.body.classList.remove(bodyClass);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Safari and some mobile browsers never fire afterprint. A timer is a poor signal but a
  // body left classed would be a real bug, and clearing early costs nothing: print() has
  // already taken its snapshot by then.
  setTimeout(done, 1500);
}

/** The one print button a screen carries. Plain window.print(): everything on the screen
 *  is what goes to the dialog, and the choosing happens there. */
export function printButtonHtml(id = 'print-btn') {
  return `<button type="button" class="btn-primary print-btn" id="${id}">Print</button>`;
}

export function wirePrintButton(root, id = 'print-btn') {
  root.querySelector(`#${id}`)?.addEventListener('click', () => window.print());
}
