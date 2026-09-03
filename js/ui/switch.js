// A setting with two answers, as a switch.
//
// Lived in ui/week-view.js while This week was the only screen with one. The Posters bar
// wants the same control now, so it moved here rather than being written twice: two
// switches that look alike and behave differently is worse than either of them.
//
// The classes are still .week-switch-*, which is where they were first written and where
// their CSS still lives in app.css. Renaming them would touch the congregation site's
// overrides as well, for nothing a reader of either file would gain.

/** A setting with two answers, as a switch: both sides on the screen, the chosen one
 *  filled in and the fill sliding across when the other is pressed.
 *
 *  A dropdown hides one of two answers behind a tap, and on a phone opening it throws the
 *  system picker up over the page; a button that toggles hides the other answer behind its
 *  own label, so you have to work out what it will become from what it currently says. A
 *  switch shows both and the state at the same time.
 *
 *  Real radio buttons under the labels, not two <button>s keeping track between them. That
 *  is what a browser already understands as "one of these": the arrow keys move between the
 *  two, a screen reader says "1 of 2", and the checked one is the browser's own state
 *  rather than a class this code has to remember to take off the other one.
 *
 *  Each side is one word where it can be. The label carries the question and the sides
 *  answer it, so the two read as one sentence: writing the whole thing out on both sides
 *  ("שבת, then weekday") is what the dropdown did, and side by side that is the same words
 *  twice. Hebrew goes in a <bdi>: it sits in an otherwise-LTR line and would otherwise be
 *  reordered against what is around it.
 *
 *  `name` is the radio group's name and the stem of every id, so two switches on one page
 *  cannot capture each other's presses. */
export function switchHtml(name, question, sides) {
  const side = ({ value, label, on }) => `
    <input type="radio" name="${name}" id="${name}-${value}" value="${value}"
      class="week-switch-radio"${on ? ' checked' : ''}>
    <label class="week-switch-side" for="${name}-${value}">${label}</label>`;
  // The question and the switch are siblings rather than the switch being wrapped in a row
  // of its own, so that switches stacked in a panel can share one grid and line their
  // tracks up with each other. aria-labelledby does not care how they are nested.
  return `<span class="week-switch-label" id="${name}-label">${question}</span>
    <div class="week-switch" role="radiogroup" aria-labelledby="${name}-label">
      ${sides.map(side).join('')}
      <span class="week-switch-thumb" aria-hidden="true"></span>
    </div>`;
}

/** Listen to one switch inside `root`, by the name it was built with.
 *
 *  On the group rather than on each radio, so a redraw that rebuilds the sides does not
 *  leave a listener behind on a node nobody can see any more. */
export function wireSwitch(root, name, apply) {
  root.querySelector(`.week-switch[aria-labelledby="${name}-label"]`)
    ?.addEventListener('change', (e) => {
      if (!e.target.matches('.week-switch-radio')) return;
      apply(e.target.value);
    });
}
