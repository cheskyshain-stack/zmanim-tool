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
import { loadTables } from './data-loader.js';
import { renderTexts } from './ui/texts-view.js';

const main = document.getElementById('main');

function start() {
  loadTables()
    .then((tables) => {
      const state = loadState();
      renderTexts(main, state, resolveSettings(state.settings), tables);
    })
    .catch((err) => {
      main.innerHTML = `<p class="error">Failed to load Hebrew-calendar data files: ${err.message}.
        Make sure this is being served over http:// rather than opened as a file, so the
        data/*.json files can load.</p>`;
    });
}

start();
