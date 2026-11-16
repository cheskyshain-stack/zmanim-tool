import { escAttr, escText } from '../util.js';
import { keepPosition } from '../ui/keep-position.js';
import { seatsCreateLocalTrash, seatsTrashExpiry } from './trash.js';

export function seatsCreateTrash({ dialog, request, connected, restoreLocal, refreshLists, notify, getName }) {
  const local = seatsCreateLocalTrash();
  let generation = 0, siteFiles = [];
  const isOpen = () => dialog.open && dialog.querySelector('#seats-trash')?.open;
  const date = value => new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  const row = (file, device) => `<li class="saved-chart-row trash-row"><div class="trash-file"><strong><bdi>${escText(device ? file.plan.name : file.name)}</bdi></strong><small>${device || file.type === 'chart' ? 'Chart' : 'Name file'} · Deleted ${escText(date(file.deletedAt))}${file.deletedBy ? ' · ' + escText(file.deletedBy) : ''}</small><small>Restore until ${escText(date(file.expiresAt || seatsTrashExpiry(file)))}</small></div><div class="saved-chart-actions"><button type="button" data-sharing="${device ? 'restore-local-trash' : 'restore-site-trash'}" data-id="${escAttr(file.id)}"${device ? '' : ` data-type="${file.type}"`}>Restore</button></div></li>`;
  function markup() {
    return `<details id="seats-trash" class="saved-pages-section seats-trash"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>Trash</summary><p>Deleted charts and name files can be restored for 60 days.</p><h4>On the website</h4><ul id="site-trash" class="saved-charts-list" aria-live="polite"><li>Loading Trash…</li></ul><h4>On this device</h4><ul id="local-trash" class="saved-charts-list" aria-live="polite"></ul><p class="field-note">Device recovery copies stay in this browser. Clearing browser data removes them.</p><p id="trash-status" role="status"></p></details>`;
  }
  function draw(selector, contents) {
    if (!isOpen()) return;
    const top = dialog.scrollTop;
    keepPosition(dialog, () => { dialog.querySelector(selector).innerHTML = contents; dialog.scrollTop = top; });
  }
  async function refresh() {
    if (!isOpen()) return;
    const ticket = ++generation;
    try { const files = local.list(); draw('#local-trash', files.length ? files.map(file => row(file, true)).join('') : '<li>No deleted charts on this device.</li>'); }
    catch (error) { draw('#local-trash', '<li>' + escText(error.message) + '</li>'); }
    if (!connected()) { draw('#site-trash', '<li>Connect and sign in to see deleted website files.</li>'); return; }
    try {
      const result = await request('/api/trash');
      if (!isOpen() || ticket !== generation) return;
      siteFiles = result.files;
      draw('#site-trash', siteFiles.length ? siteFiles.map(file => row(file, false)).join('') : '<li>No deleted website files in the last 60 days.</li>');
    } catch (error) {
      if (!isOpen() || ticket !== generation) return;
      draw('#site-trash', '<li>' + escText(error.status === 404 ? 'Website recovery needs an update to the shared-file service. Your files are kept.' : error.message) + ' <button type="button" data-sharing="refresh-trash">Try again</button></li>');
    }
  }
  async function requireService() {
    const info = await request('/api/info');
    if (!info.trash60Days) throw new Error('Website Trash needs a service update. Nothing was deleted.');
  }
  async function restore(button) {
    const device = button.dataset.sharing === 'restore-local-trash';
    if (device) {
      const file = local.list().find(file => file.id === button.dataset.id);
      if (!file) throw new Error('That chart is no longer in Trash. Its 60-day recovery period may have ended.');
      if (restoreLocal(file) === false) throw new Error('The restored chart could not be saved on this device. Its recovery copy is still in Trash.');
      local.remove(file.id);
    } else {
      const file = siteFiles.find(file => file.id === button.dataset.id && file.type === button.dataset.type);
      if (!file) throw new Error('Refresh Trash before restoring this file.');
      await request('/api/' + (file.type === 'chart' ? 'plans' : 'name-lists') + '/' + encodeURIComponent(file.id) + '/restore', { method: 'POST', body: JSON.stringify({ deletedAt: file.deletedAt }) });
    }
    notify(device ? 'Chart restored on this device.' : 'File restored to the website for everyone.');
    await refreshLists(); await refresh();
    if (isOpen()) { dialog.querySelector('#trash-status').textContent = 'Restored. You can open it from the saved list above.'; dialog.querySelector('#seats-trash>summary').focus({ preventScroll: true }); }
  }
  dialog.addEventListener('toggle', event => { if (event.target.id === 'seats-trash' && event.target.open) refresh(); }, true);
  return { markup, refresh, restore, requireService, archive: (plan, metadata) => local.add(plan, metadata, getName()) };
}
