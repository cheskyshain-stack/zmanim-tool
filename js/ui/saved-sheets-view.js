const SEASON_LABEL = { kayitz: 'שבת קיץ', choref: 'שבת חורף', weekday: 'Weekday' };
const NEW_FOLDER = '__new__';
const NO_FOLDER = '__none__';

export function renderSavedSheets(container, state, onOpen, onDelete, onChange) {
  // Folders are just a name stored on each sheet — there's no separate folder list, so a
  // folder exists exactly as long as something is in it and disappears when the last
  // sheet leaves. Nothing to create, rename or tidy up separately.
  const folders = [...new Set(state.sheets.map((s) => s.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const inFolder = (name) => state.sheets.filter((s) => (s.folder || '') === name);
  const unfiled = inFolder('');

  const rowsHtml = (sheets) =>
    [...sheets]
      // Newest first — the one you just generated is the one you want. Copied before
      // sorting so the stored order (which nothing else depends on) is left alone.
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(
        (s) => `
        <tr data-id="${s.id}">
          <td data-label="Sheet">${s.locked ? '<span class="lock-mark" title="Locked">🔒</span> ' : ''}${SEASON_LABEL[s.season] || s.season}</td>
          <td data-label="Hebrew year">${s.hebrewYear}</td>
          <td data-label="Weeks">${s.weeks.length}</td>
          <td data-label="Created">${new Date(s.createdAt).toLocaleString()}</td>
          <td data-label="Folder">
            <select class="folder-select" title="Move this sheet to a folder">
              <option value="${NO_FOLDER}" ${!s.folder ? 'selected' : ''}>No folder</option>
              ${folders.map((f) => `<option value="${esc(f)}" ${s.folder === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
              <option value="${NEW_FOLDER}">New folder…</option>
            </select>
          </td>
          <td>
            <button class="open-btn btn-primary">Open</button>
            <button class="lock-btn" title="${s.locked ? 'Allow this sheet to be deleted again' : 'Protect this sheet from being deleted'}">${s.locked ? 'Unlock' : 'Lock'}</button>
            <button class="delete-btn btn-danger" ${s.locked ? 'disabled title="Unlock this sheet before deleting it"' : ''}>Delete</button>
          </td>
        </tr>`
      )
      .join('');

  const tableHtml = (sheets) => `<table class="saved-list"><thead><tr>
      <th>Sheet</th><th>Hebrew year</th><th>Weeks</th><th>Created</th><th>Folder</th><th></th>
    </tr></thead><tbody>${rowsHtml(sheets)}</tbody></table>`;

  container.innerHTML = `
    <h2>Saved sheets</h2>
    <p class="hint">Every sheet you've generated. Open one to edit or print it, lock it so it can't be deleted, or file it into a folder to keep the list tidy. A folder appears as soon as a sheet is put in one and goes away when the last sheet leaves it.</p>
    ${
      state.sheets.length
        ? `
      ${unfiled.length ? tableHtml(unfiled) : ''}
      ${folders
        .map(
          (f) => `
        <details class="panel" open>
          <summary>📁 ${esc(f)} <span class="hint">— ${inFolder(f).length} sheet${inFolder(f).length === 1 ? '' : 's'}</span></summary>
          <div class="panel-body">${tableHtml(inFolder(f))}</div>
        </details>`
        )
        .join('')}`
        : '<p class="hint">No saved sheets yet — use Generate to create one.</p>'
    }
  `;

  const sheetOf = (e) => state.sheets.find((s) => s.id === e.target.closest('tr').dataset.id);

  container.querySelectorAll('.open-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => onOpen(e.target.closest('tr').dataset.id));
  });
  container.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sheet = sheetOf(e);
      sheet.locked = !sheet.locked;
      onChange(); // persists and re-renders, so the row's buttons reflect the new state
    });
  });
  container.querySelectorAll('.folder-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const sheet = sheetOf(e);
      const value = e.target.value;
      if (value === NEW_FOLDER) {
        const name = (prompt('Name for the new folder:') || '').trim();
        if (!name) return onChange(); // cancelled — redraw so the select snaps back
        sheet.folder = name;
      } else {
        sheet.folder = value === NO_FOLDER ? undefined : value;
      }
      onChange();
    });
  });
  container.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sheet = sheetOf(e);
      if (sheet.locked) return; // the button is disabled too; this is the belt-and-braces half
      if (confirm('Delete this saved sheet?')) onDelete(sheet.id);
    });
  });
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
