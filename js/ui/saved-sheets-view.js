import { getPublishToken, fetchPublished, publishToSite, buildPublishedPayload } from '../publish.js';
import { SEASON_LABELS } from '../settings.js';

const NEW_FOLDER = '__new__';
const NO_FOLDER = '__none__';

/** Pairs each Shabbos sheet with the Weekday chart generated alongside it.
 *
 *  They're two sheets because they're two printed charts with different columns, but
 *  nobody ever wants one without the other: they're generated together, they print
 *  interleaved, and each has a button to the other. Listing them as two rows just made
 *  the list twice as long and invited locking one while deleting the other. One row per
 *  pair, and lock / folder / delete act on both.
 *
 *  A Weekday chart whose partner was deleted (or that came from an older version with no
 *  link recorded) still gets its own row rather than vanishing from the list. */
function groupSheets(sheets) {
  const byId = new Map(sheets.map((s) => [s.id, s]));
  const companionOf = new Map();
  for (const s of sheets) {
    if (s.season === 'weekday' && byId.has(s.linkedSheetId)) companionOf.set(s.linkedSheetId, s);
  }
  const paired = new Set([...companionOf.values()].map((s) => s.id));
  return sheets.filter((s) => !paired.has(s.id)).map((s) => ({ primary: s, companion: companionOf.get(s.id) || null }));
}

export function renderSavedSheets(container, state, onOpen, onDelete, onChange, onOpenPublish = null) {
  const groups = groupSheets(state.sheets);
  // Folders are just a name stored on each sheet - there's no separate folder list, so a
  // folder exists exactly as long as something is in it and disappears when the last
  // sheet leaves. Nothing to create, rename or tidy up separately. A pair is filed by
  // its Shabbos sheet; the Weekday chart follows it.
  const folders = [...new Set(groups.map((g) => g.primary.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const inFolder = (name) => groups.filter((g) => (g.primary.folder || '') === name);
  const unfiled = inFolder('');

  const rowsHtml = (list) =>
    [...list]
      // Newest first - the one you just generated is the one you want. Copied before
      // sorting so the stored order (which nothing else depends on) is left alone.
      .sort((a, b) => String(b.primary.createdAt).localeCompare(String(a.primary.createdAt)))
      .map(
        ({ primary: s, companion }) => `
        <tr data-id="${s.id}">
          <td data-label="Sheet">${s.locked ? '<span class="lock-mark" title="Locked">🔒</span> ' : ''}${SEASON_LABELS[s.season] || s.season}${
            companion ? ' <span class="pair-chip" title="Generated together; opening one gets you to the other">+ Weekday</span>' : ''
          }<span class="live-chip" data-live-for="${s.id}" hidden>Live</span></td>
          <td data-label="Hebrew year">${s.hebrewYear}</td>
          <td data-label="Weeks">${s.weeks.length}${companion ? ` <span class="hint">+ ${companion.weeks.length}</span>` : ''}</td>
          <td data-label="Created">${created(s.createdAt)}</td>
          <td data-label="Folder">
            <select class="folder-select" title="Move this sheet to a folder">
              <option value="${NO_FOLDER}" ${!s.folder ? 'selected' : ''}>No folder</option>
              ${folders.map((f) => `<option value="${esc(f)}" ${s.folder === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
              <option value="${NEW_FOLDER}">New folder…</option>
            </select>
          </td>
          <td>
            <button class="open-btn btn-primary">Open</button>
            ${
              s.season !== 'weekday' && getPublishToken()
                ? `<button class="publish-btn" title="Put this season on the congregation's page. Any other published season stays where it is.">Publish</button>`
                : ''
            }
            <button class="lock-btn" title="${s.locked ? 'Allow this sheet to be deleted again' : 'Protect this sheet from being deleted'}">${s.locked ? 'Unlock' : 'Lock'}</button>
            <button class="delete-btn btn-danger" ${s.locked ? 'disabled title="Unlock this sheet before deleting it"' : ''}>Delete</button>
          </td>
        </tr>`
      )
      .join('');

  const tableHtml = (list) => `<table class="saved-list"><thead><tr>
      <th>Sheet</th><th>Hebrew year</th><th>Weeks</th><th>Created</th><th>Folder</th><th></th>
    </tr></thead><tbody>${rowsHtml(list)}</tbody></table>`;

  container.innerHTML = `
    <h2>Saved sheets</h2>
    <p class="hint">Every sheet you've generated. Open one to edit or print it, lock it so it can't be deleted, or file it into a folder to keep the list tidy. A folder appears as soon as a sheet is put in one and goes away when the last sheet leaves it. A Shabbos sheet and the Weekday chart made with it count as one entry. Open either from the same row, and locking, filing or deleting covers both.</p>
    ${
      // The row's own Publish button puts one season up and nothing else. This goes to the
      // publishing panel, which is the place that shows what the congregation is looking
      // at right now and can take a season back down - and the place that tells you about
      // the token when there is no token, which is why it shows either way.
      onOpenPublish
        ? `<div class="actions"><button type="button" id="saved-publishing">Publishing${getPublishToken() ? '' : ' (no token set)'}</button></div>`
        : ''
    }
    ${
      state.sheets.length
        ? `
      ${unfiled.length ? tableHtml(unfiled) : ''}
      ${folders
        .map(
          (f) => `
        <details class="panel" open>
          <summary>📁 ${esc(f)} <span class="hint">(${inFolder(f).length} sheet${inFolder(f).length === 1 ? '' : 's'})</span></summary>
          <div class="panel-body">${tableHtml(inFolder(f))}</div>
        </details>`
        )
        .join('')}`
        : '<p class="hint">No saved sheets yet. Use Generate to create one.</p>'
    }
  `;

  // Which of these the congregation is actually looking at. Asked of the repository
  // rather than assumed, because a sheet can be published from another browser and a
  // stale badge on the wrong row is worse than no badge. Silent on failure: this is a
  // nice-to-know, not a reason to break the list.
  const refreshLive = async () => {
    if (!getPublishToken()) return;
    try {
      const { data } = await fetchPublished(getPublishToken());
      const live = data?.sheets || [];
      container.querySelectorAll('[data-live-for]').forEach((chip) => {
        const sheet = state.sheets.find((x) => x.id === chip.dataset.liveFor);
        if (!sheet) return;
        const seasonLive = live.some((p) => p.season === sheet.season && p.hebrewYear === sheet.hebrewYear);
        const thisOneLive = live.some((p) => p.id === sheet.id);
        chip.hidden = !seasonLive;
        chip.classList.toggle('is-superseded', seasonLive && !thisOneLive);
        chip.title = thisOneLive
          ? "This exact sheet is on the congregation's page"
          : 'This season is published, but from a different sheet than this one';
      });
    } catch {
      /* no badge rather than an error: the list itself is fine */
    }
  };
  refreshLive();

  // A row is a pair, so every action here works on the sheets in it, not just the one
  // the row is keyed by.
  const groupOf = (e) => groups.find((g) => g.primary.id === e.target.closest('tr').dataset.id);
  const sheetsOf = (e) => [groupOf(e).primary, groupOf(e).companion].filter(Boolean);

  container.querySelectorAll('.open-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => onOpen(e.target.closest('tr').dataset.id));
  });
  // Publishing from the list, so any saved season can go up without first paging This
  // week around to a date inside it. One season per press, but pressing it on a second
  // season leaves the first alone: the published file holds them all.
  container.querySelectorAll('.publish-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const { primary, companion } = groupOf(e);
      const label = `${SEASON_LABELS[primary.season] || primary.season} ${primary.hebrewYear}`;
      if (!confirm(`Put ${label} on the congregation's page?`)) return;
      const was = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Publishing…';
      try {
        await publishToSite(buildPublishedPayload(state, [primary, companion].filter(Boolean)), getPublishToken());
        btn.textContent = 'Published';
        await refreshLive();
      } catch (err) {
        alert(err.message);
        btn.textContent = was;
      } finally {
        btn.disabled = false;
        setTimeout(() => (btn.textContent = was), 4000);
      }
    });
  });
  container.querySelector('#saved-publishing')?.addEventListener('click', () => onOpenPublish());
  container.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const locked = !groupOf(e).primary.locked;
      sheetsOf(e).forEach((s) => (s.locked = locked));
      onChange(); // persists and re-renders, so the row's buttons reflect the new state
    });
  });
  container.querySelectorAll('.folder-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const value = e.target.value;
      let folder;
      if (value === NEW_FOLDER) {
        folder = (prompt('Name for the new folder:') || '').trim();
        if (!folder) return onChange(); // cancelled - redraw so the select snaps back
      } else {
        folder = value === NO_FOLDER ? undefined : value;
      }
      sheetsOf(e).forEach((s) => (s.folder = folder));
      onChange();
    });
  });
  container.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const { primary, companion } = groupOf(e);
      if (primary.locked) return; // the button is disabled too; this is the belt-and-braces half
      const what = companion ? 'this sheet and its Weekday chart' : 'this saved sheet';
      if (confirm(`Delete ${what}?`)) onDelete(sheetsOf(e).map((s) => s.id));
    });
  });
}

/** "12 Aug 2026, 12:34 AM". toLocaleString() gives "8/12/2026, 12:34:30 AM", which is
 *  wide enough to wrap mid-date, and the seconds are noise: two sheets generated in the
 *  same minute are the pair from one run. */
function created(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
