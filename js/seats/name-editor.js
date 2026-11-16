import { escAttr, escText } from '../util.js';
import { seatsNormalizeNameFile } from './name-files.js';

const draftKey = id => 'lakewood-commons-seats-name-draft-v1-' + id;
export function seatsCreateNameEditor({ dialog, request, show, isOpen, back, notify }) {
  let file = null, generation = 0, saving = false;
  const fields = () => [dialog.querySelector('#name-file-title'), dialog.querySelector('#name-file-names')];
  function remember() {
    if (!file || !isOpen()) return;
    const [title, names] = fields();
    if (!title || !names) return;
    if (file.name !== title.value || file.text !== names.value) {
      file.name = title.value; file.text = names.value; file.operationId = null;
    }
    try { localStorage.setItem(draftKey(file.id), JSON.stringify(file)); }
    catch { dialog.querySelector('#name-file-draft').textContent = 'This browser could not keep the draft. Copy your text before closing.'; }
  }
  async function open(id, latest = false) {
    if (saving) { notify('Wait for the name file to finish saving before editing another file.'); return; }
    const ticket = ++generation;
    const info = await request('/api/info');
    if (!info.editNameFiles) throw new Error('Editing name files needs an update to the shared-file service.');
    const saved = await request('/api/name-lists/' + encodeURIComponent(id));
    if (ticket !== generation) return;
    file = { id, revision: saved.revision || 1, name: saved.name, text: saved.names.join('\n'), operationId: null };
    if (!latest) {
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
        if (draft?.id === id && Number.isSafeInteger(draft.revision) && draft.revision >= 1 && typeof draft.name === 'string' && draft.name.length <= 80 && typeof draft.text === 'string' && draft.text.length <= 400000) file = { ...file, ...draft };
      } catch { /* The saved website file still opens if a local draft is unreadable. */ }
    }
    show(`<h2 id="sharing-title">Edit name file</h2><p>Save updates this shared list for everyone. Charts keep their own names and assignments.</p><form id="name-file-editor"><fieldset><label for="name-file-title">File name</label><input id="name-file-title" value="${escAttr(file.name)}" maxlength="80" required><label for="name-file-names">Names, one per line</label><textarea id="name-file-names" rows="12" maxlength="400000" required spellcheck="false">${escText(file.text)}</textarea><p id="name-file-draft">Your draft is kept on this device until you save.</p><p class="sharing-error" role="alert"></p><button type="button" data-sharing="reload-name-file" ${file.revision === (saved.revision || 1) ? 'hidden' : ''}>Load latest version</button><div class="dialog-actions"><button type="button" data-sharing="name-files">Back to name files</button><button class="primary" type="submit">Save changes</button></div></fieldset></form>`);
    return true;
  }
  async function save() {
    if (saving || !file) return;
    remember();
    const draft = file;
    const errorNode = dialog.querySelector('.sharing-error');
    errorNode.textContent = '';
    let contents;
    try { contents = seatsNormalizeNameFile({ name: draft.name, names: draft.text.split(/\r\n?|\n/).filter(name => name.trim()) }); }
    catch (error) { errorNode.textContent = error.message; return; }
    draft.operationId ||= crypto.randomUUID(); remember();
    const ticket = generation, fieldset = dialog.querySelector('fieldset');
    fieldset.disabled = true; saving = true;
    try {
      await request('/api/name-lists/' + encodeURIComponent(draft.id), { method: 'POST', body: JSON.stringify({ ...contents, revision: draft.revision, operationId: draft.operationId }) });
      try { const stored = JSON.parse(localStorage.getItem(draftKey(draft.id)) || 'null'); if (stored?.operationId === draft.operationId) localStorage.removeItem(draftKey(draft.id)); } catch { /* The shared file was saved even if draft storage is unavailable. */ }
      if (ticket === generation && isOpen()) { file = null; back(); }
      notify('Name file saved on the website.');
    } catch (error) {
      if (ticket === generation && isOpen()) {
        errorNode.textContent = error.message;
        dialog.querySelector('[data-sharing=reload-name-file]').hidden = error.status !== 409;
      } else notify('The name file could not be saved. Your draft is kept on this device.');
    } finally { saving = false; fieldset.disabled = false; }
  }
  async function reload() {
    if (!file || !window.confirm('Replace your draft with the latest saved version of this file?')) return;
    const id = file.id;
    if (!await open(id, true)) return;
    try { localStorage.removeItem(draftKey(id)); } catch { /* The newly loaded fields remain usable. */ }
  }
  return { open, save, reload, remember, cancel: () => { generation++; } };
}
