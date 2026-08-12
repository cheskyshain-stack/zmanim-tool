import { exportSheetToFile } from '../storage.js';

const SEASON_LABEL = { kayitz: 'שבת קיץ', choref: 'שבת חורף', weekday: 'Weekday' };

export function renderSavedSheets(container, state, onOpen, onDelete, onChange) {
  container.innerHTML = `
    <h2>Saved sheets</h2>
    <p class="hint">Every sheet you've generated. Open one to edit or print it. Lock a sheet to protect it from being deleted, or save a copy as a file you can keep anywhere — that file can be brought back in from Settings → Backup.</p>
    ${
      state.sheets.length
        ? `<table class="saved-list"><thead><tr><th>Sheet</th><th>Hebrew year</th><th>Weeks</th><th>Created</th><th></th></tr></thead><tbody>
      ${[...state.sheets]
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
          <td>
            <button class="open-btn">Open</button>
            <button class="copy-btn" title="Download this sheet as a file you can store anywhere">Save a copy</button>
            <button class="lock-btn" title="${s.locked ? 'Allow this sheet to be deleted again' : 'Protect this sheet from being deleted'}">${s.locked ? 'Unlock' : 'Lock'}</button>
            <button class="delete-btn btn-danger" ${s.locked ? 'disabled title="Unlock this sheet before deleting it"' : ''}>Delete</button>
          </td>
        </tr>`
        )
        .join('')}
      </tbody></table>`
        : '<p class="hint">No saved sheets yet — use Generate to create one.</p>'
    }
  `;
  const sheetOf = (e) => state.sheets.find((s) => s.id === e.target.closest('tr').dataset.id);

  container.querySelectorAll('.open-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => onOpen(e.target.closest('tr').dataset.id));
  });
  container.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => exportSheetToFile(sheetOf(e)));
  });
  container.querySelectorAll('.lock-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const sheet = sheetOf(e);
      sheet.locked = !sheet.locked;
      onChange(); // persists and re-renders, so the row's buttons reflect the new state
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
