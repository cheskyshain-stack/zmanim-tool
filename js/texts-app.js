// The entry for /texts/, the messages page.
//
// A second, much smaller program than the admin: it loads the same state, the same settings and
// the same calendar tables, and then draws one screen. No tabs, no routing, and above all no way
// back into the admin or out to the congregation's site, because the address is meant to be
// handed to whoever sends the messages and to nobody else's job.
//
// **No PIN here, deliberately, and not by omission.** The admin asks for four digits because
// somebody wandering into the generator can change the shul's boards. Nothing on this page
// changes anything: it reads the same state and prints messages that are about to be sent to
// the whole congregation anyway. Putting a gate in front of it would only mean the person it
// was built for has to be given the admin's PIN, which is the opposite of the point. See
// ui/lock.js for what those four digits are and are not worth.

import { loadState } from './storage.js';
import { resolveSettings } from './settings.js';
import { loadTables, showDataError } from './data-loader.js';
import { renderTexts } from './ui/texts-view.js';

const main = document.getElementById('main');


function start() {
  /* Two catches, not one, and that is the point of the shape.
     They were one, and it said the data files had failed to load whatever had actually gone
     wrong. A mistake inside the drawing then reported itself as a fetch problem, on a page that
     had fetched everything perfectly well, and the real message ("built is not iterable") was
     only visible by reading the sentence to the end. A screen that names the wrong cause is
     worse than one that says nothing, because it sends whoever is looking somewhere else. */
  loadTables()
    .catch((err) => {
      /* This is the page that got the bad message: somebody opening it on a phone was told
         "Unexpected token '<'" and nothing else. Set as text, not as markup, since what it
         quotes came off the network. See dataErrorMessage. */
      showDataError(main, err);
      throw err;
    })
    .then((tables) => {
      const state = loadState();
      renderTexts(main, state, resolveSettings(state.settings), tables);
    })
    .catch((err) => {
      if (main.querySelector('.error')) return; // the loader already said its piece
      console.error('messages page', err);
      main.innerHTML = `<p class="error">Could not build the messages: ${err.message}</p>`;
    });
}

start();
