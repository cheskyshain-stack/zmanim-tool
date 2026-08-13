// Entry point for the congregation's page, which is the site's front door: everything a
// congregant needs and nothing else. The admin app lives at /admin.
//
// It reads the published season from /data/published.json rather than localStorage,
// because a visitor's browser has none of this app's data. Until something is published
// there is nothing to show, which the page says plainly rather than looking broken.
import { loadPublished } from './publish.js';
import { renderWeek } from './ui/week-view.js';

const main = document.getElementById('main');

(async () => {
  const published = await loadPublished();
  if (!published) {
    main.innerHTML = '<p class="hint">Nothing has been published yet.</p>';
    return;
  }
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  let serial = null;
  const draw = () => renderWeek(main, state, (s) => { serial = s; draw(); }, serial, { luach: true });
  draw();
})();
