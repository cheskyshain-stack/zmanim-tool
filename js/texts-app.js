// The entry for /texts/, the messages page.
//
// A second, much smaller program than the admin: it loads the same state, the same settings and
// the same calendar tables, and then draws one screen. No tabs, no routing, and above all no way
// back into the admin or out to the congregation's site, because the address is meant to be
// handed to whoever sends the messages and to nobody else's job.
//
// The PIN comes first, exactly as it does on the admin and for the same reason: this is a page
// on a public site and anybody who guesses the address lands on it. Ahead of loading anything,
// so nothing is fetched for a visitor who is not getting in. What the four digits are worth is
// written at the top of ui/lock.js and is not changed by there being two doors now.

import { loadState } from './storage.js';
import { resolveSettings } from './settings.js';
import { loadTables } from './data-loader.js';
import { isOpen, renderLock } from './ui/lock.js';
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

if (isOpen()) start();
else renderLock(main, start);
