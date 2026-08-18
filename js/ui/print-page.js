// Printing one page on its own.
//
// A print button that prints everything is fine when everything is what you want. Usually
// it is not: one week's page for the board outside, or one page of the season chart. Each
// page therefore carries its own button, in a strip above it so it never sits on top of
// anything and never reaches paper.
//
// The isolation is done in CSS rather than by building a separate document: the page is
// marked, the body is told only marked pages print, and both marks come off again when
// the dialog closes. Nothing is moved or cloned, so what prints is the page you were
// looking at.

/** Prints one element, hiding every other page for the duration. */
export function printOnly(pageEl) {
  document.body.classList.add('is-printing-one');
  pageEl.classList.add('is-print-target');
  // The wrapper is marked as well as the page. Hiding only the other pages left their
  // wrappers standing, and an empty wrapper is still a box outside the named page the
  // pages themselves claim, which was enough to put out a blank sheet of the *default*
  // page size next to the one being printed.
  const slot = pageEl.closest('.page-slot');
  slot?.classList.add('is-print-slot');
  const done = () => {
    document.body.classList.remove('is-printing-one');
    pageEl.classList.remove('is-print-target');
    slot?.classList.remove('is-print-slot');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Safari and some mobile browsers never fire afterprint. A timer is a poor signal but a
  // page left hidden would be a real bug, and clearing early costs nothing: print() has
  // already taken its snapshot by then.
  setTimeout(done, 1500);
}

/** Puts a print button above one page. The page keeps its own place in the flow; the
 *  wrapper only adds the strip. */
export function attachPagePrint(pageEl, label = 'Print this page') {
  const slot = document.createElement('div');
  slot.className = 'page-slot';
  const bar = document.createElement('div');
  bar.className = 'page-slot-bar no-print';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'page-print';
  btn.textContent = label;
  btn.addEventListener('click', () => printOnly(pageEl));
  bar.appendChild(btn);
  pageEl.replaceWith(slot);
  slot.append(bar, pageEl);
  return slot;
}

/** Gives every matching page its own button. */
export function attachPagePrintToAll(root, selector, label) {
  root.querySelectorAll(selector).forEach((el) => attachPagePrint(el, label));
}
