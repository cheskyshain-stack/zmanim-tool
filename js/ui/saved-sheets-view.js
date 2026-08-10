export function renderSavedSheets(container, state, onOpen, onDelete) {
  container.innerHTML = `
    <h2>Saved sheets</h2>
    ${
      state.sheets.length
        ? `<table class="saved-list"><thead><tr><th>Sheet</th><th>Hebrew year</th><th>Weeks</th><th>Created</th><th></th></tr></thead><tbody>
      ${state.sheets
        .map(
          (s) => `
        <tr data-id="${s.id}">
          <td>${s.season === 'kayitz' ? 'שבת קיץ' : 'שבת חורף'}</td>
          <td>${s.hebrewYear}</td>
          <td>${s.weeks.length}</td>
          <td>${new Date(s.createdAt).toLocaleString()}</td>
          <td><button class="open-btn">Open</button> <button class="delete-btn">Delete</button></td>
        </tr>`
        )
        .join('')}
      </tbody></table>`
        : '<p class="hint">No saved sheets yet — use Generate to create one.</p>'
    }
  `;
  container.querySelectorAll('.open-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => onOpen(e.target.closest('tr').dataset.id));
  });
  container.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('tr').dataset.id;
      if (confirm('Delete this saved sheet?')) onDelete(id);
    });
  });
}
