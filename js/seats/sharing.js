import { escAttr, escText } from '../util.js';
import { seatsSharedApply, seatsSharedDiff, seatsSharedPlan, seatsSharedReverse } from './shared-model.js';
import { seatsDescribeChanges, seatsRecordMetadata } from './activity.js';
import { seatsNormalizeNameFile } from './name-files.js';
import { seatsChartName } from './chart-names.js';

export const SEATS_SHARING_KEY = 'lakewood-commons-seats-shared-v1';
const SEATS_SHARING_SESSION = 'lakewood-commons-seats-online-session';
const SEATS_NAME_UPLOADS = 'lakewood-commons-seats-name-uploads-v1';

export function seatsCreateSharing({ getState, getLocalPlans = () => getState().plans, canPublish = () => true, isViewingChart = () => true, updatePlan, recoverPlan, notify, onStatus, onDialogChange = () => {}, isBusy, activatePage, copyChart, restoreBackup, getRecord, newChart, initialPin, initialName, onSignInRequired, onSignOut, pickNamesFile, useNames, removeLocal, keepDeletedCopy }) {
  const clientId = crypto.randomUUID(), entries = new Map();
  const dialog = document.createElement('dialog'); dialog.className = 'seats-dialog sharing-dialog no-print'; dialog.setAttribute('aria-labelledby', 'sharing-title'); document.body.appendChild(dialog);
  dialog.addEventListener('close', () => onDialogChange());
  let endpoint = '', session = null, socket = null, ready = false, retry = null, heartbeat = null, retryCount = 0;
  let peers = [], activeSeat = null, pendingMessages = [], profile = initialName || '', dialogMode = '', lastMessage = 0;
  let intent = 'pages', listRequest = 0, historyRequest = 0, openRequest = 0, publishing = false, copyingChart = false, entryPin = initialPin, pendingPublish = null;
  let nameUploads = [], nameFiles = [], sitePlans = [], namesRequest = 0, uploadingNames = false, namesError = '', namesRetry = null, namesRetries = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(SEATS_NAME_UPLOADS) || '[]');
    if (Array.isArray(saved)) nameUploads = saved.slice(0, 20).map(file => ({ id: file.id, ...seatsNormalizeNameFile(file), remove: file.remove === true })).filter(file => /^[A-Za-z0-9_-]{8,100}$/.test(file.id || ''));
  } catch { /* Names already added to charts remain in the regular browser backup. */ }
  const requestedPage = new URL(location.href).searchParams.get('page');
  let pendingPage = /^[A-Za-z0-9_-]{8,100}$/.test(requestedPage || '') ? requestedPage : null;
  const current = () => getState().plans.find(plan => plan.id === getState().activeId);
  const local = id => getState().plans.find(plan => plan.id === id);
  const entryForRemote = id => [...entries.values()].find(entry => entry.remoteId === id);
  const clean = (plan, id = plan.id) => seatsSharedPlan({ ...plan, id });
  const changed = () => {
    onStatus();
    const saved = dialog.querySelector('[data-sharing-status]'); if (saved) saved.textContent = label();
  };
  function clearPageLink() {
    pendingPage = null;
    const url = new URL(location.href);
    if (url.searchParams.has('page')) { url.searchParams.delete('page'); history.replaceState(history.state, '', url); }
  }
  function persist() {
    try {
      localStorage.setItem(SEATS_SHARING_KEY, JSON.stringify({ version: 1, profile, entries: [...entries.values()].map(({ localId, remoteId, base, queue }) => ({ localId, remoteId, base, queue })) }));
    } catch { notify('Shared changes are still in memory. Download a backup before closing this page.'); }
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SEATS_SHARING_KEY) || 'null');
      if (saved?.version !== 1 || !Array.isArray(saved.entries)) return;
      profile = typeof saved.profile === 'string' ? saved.profile.slice(0, 60) : '';
      for (const value of saved.entries.slice(0, 30)) {
        const plan = local(value.localId);
        if (!plan || typeof value.remoteId !== 'string' || !value.base) continue;
        const base = { ...value.base, plan: clean(value.base.plan, value.remoteId) }, queue = Array.isArray(value.queue) ? value.queue : [];
        let observed = base.plan;
        for (const operation of queue) observed = seatsSharedApply(observed, operation.changes);
        entries.set(value.localId, { localId: value.localId, remoteId: value.remoteId, base, queue, observed, undo: [], redo: [], ready: false, error: '' });
      }
    } catch { notify('A saved shared connection could not be reopened. Your local seating plans are kept.'); }
  }
  async function request(path, options = {}) {
    const response = await fetch(endpoint + path, { ...options, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}), ...options.headers }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { session = null; entryPin = null; sessionStorage.removeItem(SEATS_SHARING_SESSION); }
      const error = new Error(result.error || 'The shared file could not be opened.'); error.status = response.status; throw error;
    }
    return result;
  }
  function persistNameUploads() {
    try { localStorage.setItem(SEATS_NAME_UPLOADS, JSON.stringify(nameUploads)); }
    catch { notify('The names are saved in your chart. Keep this page open until the name file finishes saving to the website.'); }
  }
  async function uploadNameFile(name, names) {
    const file = { id: crypto.randomUUID(), ...seatsNormalizeNameFile({ name, names }) };
    if (nameUploads.length >= 20) throw new Error('There are 20 name files waiting to save. Sign in and let them finish before uploading another.');
    nameUploads.push(file); persistNameUploads(); changed();
    if (!endpoint) return;
    intent = 'names';
    if (!session || session.expires <= Date.now()) showLogin();
    else { await drainNameUploads(); if (dialog.open && dialogMode === 'names') refreshNameFiles(); }
  }
  async function drainNameUploads() {
    if (uploadingNames || !endpoint || !session || session.expires <= Date.now() || !nameUploads.length) return;
    clearTimeout(namesRetry);
    uploadingNames = true; namesError = ''; changed();
    let saved = 0;
    try {
      while (nameUploads.length) {
        const file = nameUploads[0];
        try {
          if (!file.remove) await request('/api/name-lists', { method: 'POST', body: JSON.stringify(file) });
          if (file.remove) await request('/api/name-lists/' + encodeURIComponent(file.id), { method: 'DELETE' }); else saved++;
        } catch (error) { if (error.status !== 410 && !(file.remove && error.status === 404)) throw error; }
        nameUploads = nameUploads.filter(item => item.id !== file.id); persistNameUploads();
      }
      namesRetries = 0;
      notify(saved ? 'Name file saved on the website. Anyone signed in can choose it with Add names.' : 'Name file removed. Names already added to charts were kept.');
    } catch (error) { namesError = error.message; if (!error.status || error.status >= 500) namesRetry = setTimeout(drainNameUploads, Math.min(30000, 3000 * 2 ** namesRetries++)); }
    finally { uploadingNames = false; changed(); if (dialog.open && dialogMode === 'names') refreshNameFiles(); }
  }
  function showNameFiles() {
    dialogMode = 'names';
    showDialog(`<h2 id="sharing-title">Name files</h2><p>Upload a list once to save it on the website. Anyone signed in can choose a file and add its names to their chart.</p><button class="primary" type="button" data-sharing="upload-names">Upload names</button><div id="name-upload-status" role="status"></div><div id="sharing-name-files" class="saved-pages-grid" aria-live="polite"></div><p class="sharing-error" role="alert"></p><div class="dialog-actions"><button type="button" data-sharing="close">Close</button></div>`);
    refreshNameFiles();
  }
  function renderPendingNames() {
    const status = dialog.querySelector('#name-upload-status');
    if (status) status.innerHTML = nameUploads.length ? nameUploads.map(file => `<div class="pending-name-file"><span>${escText(file.name)} · ${file.remove ? 'Waiting to delete' : uploadingNames ? 'Saving to the website…' : 'Waiting to save'}</span>${file.remove ? '' : `<button type="button" data-sharing="cancel-name-upload" data-id="${escAttr(file.id)}">Delete</button>`}</div>`).join('') + (!uploadingNames && session ? '<button type="button" data-sharing="retry-names">Try saving again</button>' : '') : '';
  }
  async function refreshNameFiles() {
    if (!dialog.open || dialogMode !== 'names') return;
    const generation = ++namesRequest; renderPendingNames();
    const container = dialog.querySelector('#sharing-name-files');
    if (!endpoint || !session) { container.innerHTML = `<p>Sign in on the website to open saved name files. Uploads are kept on this device while waiting.</p>${endpoint ? '<button class="primary" type="button" data-sharing="signin-names">Sign in to open name files</button>' : ''}`; return; }
    try {
      const result = await request('/api/name-lists');
      if (!dialog.open || dialogMode !== 'names' || generation !== namesRequest) return;
      nameFiles = result.files;
      container.innerHTML = nameFiles.length ? nameFiles.map(file => `<div class="sharing-name-file"><button class="saved-page-card" type="button" data-sharing="use-names" data-id="${escAttr(file.id)}" aria-label="Use ${escAttr(file.name)}"><svg class="saved-page-icon" viewBox="0 0 64 76" fill="none" stroke="currentColor" aria-hidden="true" focusable="false"><path d="M9 3h33l13 13v57H9Z" fill="#fff" stroke-width="1.5"/><path d="M42 3v13h13M18 30h28M18 40h28M18 50h28M18 60h20" stroke-width="1.5"/></svg><strong><bdi>${escText(file.name)}</bdi></strong><small>${file.count} names</small><small>Uploaded ${escText(formatDate(file.createdAt))}<br>By ${escText(file.createdBy)}</small><span class="saved-page-open">Use list</span></button><button type="button" class="saved-file-delete danger" data-sharing="delete-names" data-id="${escAttr(file.id)}">Delete</button></div>`).join('') : '<p>No name files yet. Upload a list to save it here for everyone.</p>';
      dialog.querySelector('.sharing-error').textContent = namesError;
    } catch (error) {
      if (!dialog.open || dialogMode !== 'names' || generation !== namesRequest) return;
      if (!session) { intent = 'names'; showLogin(error.message); return; }
      dialog.querySelector('.sharing-error').textContent = error.message;
    }
  }
  async function chooseNameFile(id) {
    const file = await request('/api/name-lists/' + encodeURIComponent(id));
    useNames(file.names, file.name); dialog.close();
  }
  async function deleteNameFile(id) {
    const file = nameFiles.find(file => file.id === id);
    if (!file || !window.confirm('Delete “' + file.name + '” from the website? Names already added to charts will stay on those charts.')) return;
    await request('/api/name-lists/' + encodeURIComponent(id), { method: 'DELETE' });
    if (dialog.open && dialogMode === 'names') await refreshNameFiles();
  }
  function detachDeleted(remoteId) {
    const entry = entryForRemote(remoteId); if (!entry) return;
    entries.delete(entry.localId); persist();
    const metadata = seatsRecordMetadata(entry.base), localHistory = [];
    let previous = entry.base.plan;
    for (const operation of entry.queue) {
      const next = seatsSharedApply(previous, operation.changes);
      localHistory.push({ id: operation.id, at: operation.at || new Date().toISOString(), by: operation.by || session?.name || profile || 'This device', details: seatsDescribeChanges(previous, next, operation.changes) });
      previous = next;
    }
    if (localHistory.length) { metadata.updatedAt = localHistory.at(-1).at; metadata.updatedBy = localHistory.at(-1).by; metadata.history = localHistory; }
    keepDeletedCopy(entry.localId, metadata);
    presence(); changed(); notify('Chart deleted from the website. Its copy on this device was kept.');
  }
  async function deleteChartFile(id, deviceOnly = false) {
    const plan = deviceOnly ? local(id) : sitePlans.find(plan => plan.id === id);
    if (!plan || !window.confirm('Delete “' + plan.name + '” from ' + (deviceOnly ? 'this device?' : 'the website for everyone? Copies on devices will stay available.'))) return;
    if (deviceOnly) { entries.delete(id); persist(); changed(); removeLocal(id); watch(); presence(); changed(); }
    else { await request('/api/plans/' + encodeURIComponent(id), { method: 'DELETE' }); detachDeleted(id); }
    if (dialog.open && dialogMode === 'pages') showPlans();
  }
  function send(message) { if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function watch() { send({ type: 'watch', ids: [...new Set([...entries.values()].map(entry => entry.remoteId))] }); }
  function presence() { send({ type: 'presence', planId: isViewingChart() ? entries.get(current()?.id)?.remoteId || null : null, seat: activeSeat }); }
  function transmit(entry) {
    if (!entry.ready || !entry.queue.length || !ready) return;
    const first = entry.queue[0];
    if (first.sent) return;
    first.sent = true;
    send({ type: 'patch', planId: entry.remoteId, operationId: first.id, changes: first.changes });
  }
  function applySnapshot(entry, message) {
    if (message.revision < entry.base.revision) return;
    const oldLocal = local(entry.localId), accepted = entry.queue.findIndex(operation => operation.id === message.operationId);
    if (accepted >= 0) entry.queue.splice(accepted, 1);
    const base = { plan: clean(message.plan, entry.remoteId), revision: message.revision, ...seatsRecordMetadata(message) };
    let visible = base.plan;
    try {
      if (message.type === 'conflict') throw new Error(message.error || 'Another organizer updated the same seat.');
      for (const operation of entry.queue) visible = seatsSharedApply(visible, operation.changes);
      entry.error = '';
    } catch (error) {
      if (oldLocal) recoverPlan(oldLocal, error.message);
      entry.queue = []; entry.undo = []; entry.redo = []; entry.error = 'Your unsynced changes were kept in a separate local copy.';
      visible = base.plan;
    }
    entry.base = base; entry.observed = visible; entry.ready = true;
    persist();
    if (oldLocal && JSON.stringify(clean(oldLocal, entry.remoteId)) !== JSON.stringify(visible)) updatePlan(entry.localId, clean(visible, entry.localId));
    transmit(entry); changed();
  }
  function receive(message) {
    if (isBusy() && ['snapshot', 'conflict', 'plan-deleted'].includes(message.type)) { pendingMessages.push(message); return; }
    if (message.type === 'ready') {
      ready = true; retryCount = 0;
      for (const entry of entries.values()) { entry.ready = false; for (const operation of entry.queue) delete operation.sent; }
      watch(); presence(); changed(); drainNameUploads();
      if (dialog.open && dialogMode === 'names') refreshNameFiles();
      else if (dialog.open && dialogMode === 'pages') refreshSitePages();
      return;
    }
    if (message.type === 'snapshot' || message.type === 'conflict') {
      const entry = entryForRemote(message.plan?.id);
      if (entry) applySnapshot(entry, message);
    } else if (message.type === 'plan-deleted') detachDeleted(message.id);
    else if (message.type === 'name-lists-changed' && dialog.open && dialogMode === 'names') refreshNameFiles();
    else if (message.type === 'presence') { peers = message.peers || []; changed(); }
    else if (message.type === 'busy') notify(message.name + ' is editing that seat. Choose another seat while they finish.');
    else if (message.type === 'error') notify(message.error || 'That shared update could not be saved.');
    else if (message.type === 'plans-changed' && dialog.open && dialogMode === 'pages') refreshSitePages();
  }
  function connect() {
    if (!endpoint || !session || session.expires <= Date.now() || socket && socket.readyState < WebSocket.CLOSING) return;
    clearTimeout(retry); clearInterval(heartbeat); ready = false;
    const url = new URL('/api/live', endpoint); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    const connection = socket;
    connection.onopen = () => {
      lastMessage = Date.now(); connection.send(JSON.stringify({ type: 'auth', token: session.token, clientId }));
      heartbeat = setInterval(() => {
        if (Date.now() - lastMessage > 90000) connection.close();
        else send({ type: 'ping' });
      }, 30000);
    };
    connection.onmessage = event => {
      lastMessage = Date.now();
      try { receive(JSON.parse(event.data)); } catch { notify('A shared update could not be read. Your local plan is kept.'); connection.close(); }
    };
    connection.onclose = event => {
      if (socket !== connection) return;
      ready = false; peers = []; clearInterval(heartbeat);
      for (const entry of entries.values()) { entry.ready = false; for (const operation of entry.queue) delete operation.sent; }
      if (event.code === 1008) { session = null; sessionStorage.removeItem(SEATS_SHARING_SESSION); }
      if (session && session.expires > Date.now()) retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** retryCount++));
      changed();
    };
    connection.onerror = () => { /* close schedules reconnection without discarding queued changes. */ };
  }
  function queueChanges(entry, changes, recordUndo = true) {
    if (!changes.length) return;
    entry.queue.push({ id: crypto.randomUUID(), changes, at: new Date().toISOString(), by: session?.name || profile || 'This device' });
    if (recordUndo) { entry.undo.push(changes); entry.undo = entry.undo.slice(-25); entry.redo = []; }
    entry.error = ''; persist(); transmit(entry); changed();
  }
  function localChanged() {
    for (const entry of entries.values()) {
      const plan = local(entry.localId); if (!plan) continue;
      const desired = clean(plan, entry.remoteId), changes = seatsSharedDiff(entry.observed, desired);
      if (changes.length) { entry.observed = desired; queueChanges(entry, changes); }
    }
    presence();
  }
  function undo(redo = false) {
    const entry = entries.get(current().id), source = redo ? entry?.redo : entry?.undo;
    if (!source?.length) return;
    const original = source.at(-1), changes = redo ? original : seatsSharedReverse(original);
    try {
      const next = seatsSharedApply(entry.observed, changes);
      source.pop(); (redo ? entry.undo : entry.redo).push(original);
      entry.observed = next; queueChanges(entry, changes, false);
      updatePlan(entry.localId, clean(next, entry.localId));
    } catch { notify('That item changed after your edit. Undo will not replace the other organizer’s work.'); }
  }
  function label() {
    const entry = entries.get(current()?.id);
    if (!entry) return 'Saved on this device';
    if (entry.error) return entry.error;
    if (!session || session.expires <= Date.now()) return 'Local copy saved · Sign in to sync';
    if (!ready || !entry.ready) return 'Saved on this device · Reconnecting';
    return entry.queue.length ? 'Saving to website…' : 'Saved to website';
  }
  function peersHere() { const id = entries.get(current()?.id)?.remoteId; return id ? peers.filter(peer => peer.clientId !== clientId && peer.planId === id) : []; }
  function markup() {
    const entry = entries.get(current()?.id); if (!entry) return '';
    const others = peersHere(), text = others.map(peer => peer.name + (peer.seat ? ' editing ' + peer.seat.replace(':', ' · Seat ').replace(/Seat (\d+)$/, (_, index) => 'Seat ' + (Number(index) + 1)) : ' is viewing this plan')).join(' · ');
    return `<span class="sharing-state${ready ? ' connected' : ''}">${escText(label())}</span>${entry.base.updatedBy ? `<span class="sharing-audit">Last edited by ${escText(entry.base.updatedBy)} · ${escText(formatDate(entry.base.updatedAt))}</span>` : ''}${text ? `<span class="sharing-peers">${escText(text)}</span>` : ''}`;
  }
  function decorate(root) {
    root.querySelectorAll('.is-remote').forEach(node => { node.classList.remove('is-remote'); node.removeAttribute('data-organizer'); });
    for (const peer of peersHere()) {
      if (!peer.seat) continue;
      const separator = peer.seat.lastIndexOf(':'), id = peer.seat.slice(0, separator), index = peer.seat.slice(separator + 1);
      const node = root.querySelector('.room-stage [data-table="' + CSS.escape(id) + '"][data-seat="' + CSS.escape(index) + '"]');
      if (node) { node.classList.add('is-remote'); node.dataset.organizer = peer.name; }
    }
  }
  function canEdit(tableId, index) {
    const busy = peersHere().find(peer => peer.seat === tableId + ':' + index);
    if (busy) { notify(busy.name + ' is editing that seat. Choose another seat while they finish.'); return false; }
    return true;
  }
  function showDialog(contents) {
    dialog.classList.toggle('saved-pages-dialog', ['pages', 'names'].includes(dialogMode));
    dialog.innerHTML = contents;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    onDialogChange();
  }
  function showLogin(error = '') {
    if (onSignInRequired) { dialog.close(); onSignInRequired(error); return; }
    dialogMode = 'login';
    const title = pendingPage ? 'Open a saved chart' : intent === 'save' ? 'Save chart to the website' : intent === 'history' ? 'Chart change history' : intent === 'names' ? 'Open name files' : 'Open saved charts';
    const pinField = entryPin ? '' : '<label for="sharing-pin">Seats PIN</label><input id="sharing-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required>';
    showDialog(`<h2 id="sharing-title">${title}</h2><p>Enter your name so the chart history can show who made each change.${entryPin ? '' : ' Use the same Seats PIN.'}</p><form id="sharing-login"><label for="sharing-name">Your name</label><input id="sharing-name" name="name" value="${escAttr(profile)}" maxlength="60" autocomplete="given-name" required>${pinField}<p class="sharing-error" role="alert">${escText(error)}</p><div class="dialog-actions"><button type="button" data-sharing="close">Cancel</button><button class="primary" type="submit">${intent === 'save' ? 'Save chart' : 'Sign in'}</button></div></form>`);
  }
  function formatDate(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded'; }
  function chartMetadata(id) { const entry = entries.get(id); return entry ? seatsRecordMetadata(entry.base) : getRecord(id); }
  function dateDetails(record) {
    return `<span>Created: ${escText(formatDate(record.createdAt))}</span><span>Last edited: ${escText(formatDate(record.updatedAt))}</span>${record.updatedBy ? `<span>Edited by: ${escText(record.updatedBy)}</span>` : ''}`;
  }
  function pageCard(plan, site = false) {
    const metadata = site ? seatsRecordMetadata(plan) : chartMetadata(plan.id);
    const name = seatsChartName(plan.name, metadata);
    const location = site ? 'On the website' : (plan.id === current().id ? 'Current page · ' : '') + (entries.has(plan.id) ? 'Device copy of a site page' : 'Saved on this device');
    return `<li class="sharing-plan saved-chart-row ${site ? 'sharing-site-plan' : 'sharing-local-plan'}"><button type="button" class="saved-page-card" data-sharing="${site ? 'open' : 'local'}" data-id="${escAttr(plan.id)}" aria-label="Open ${escAttr(name)}"><strong><bdi>${escText(name)}</bdi></strong><small class="saved-page-dates">${dateDetails(metadata)}</small><small>${escText(location)}</small><span class="saved-page-open">Open chart →</span></button><div class="saved-chart-actions"><button type="button" data-sharing="${site ? 'copy-chart' : 'copy-local'}" data-id="${escAttr(plan.id)}">Copy chart</button><button type="button" class="saved-file-delete danger" data-sharing="${site ? 'delete-chart' : 'delete-local'}" data-id="${escAttr(plan.id)}">Delete</button></div></li>`;
  }
  function showPlans(error = '') {
    dialogMode = 'pages';
    listRequest++;
    const devicePages = getLocalPlans().map(plan => pageCard(plan)).join('') || '<li>No charts saved on this device yet.</li>';
    showDialog(`<h2 id="sharing-title" class="saved-pages-heading"><svg class="page-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M3 7V5h7l2 2h9v13H3Z"/><path d="M3 10h18"/></svg>Saved charts</h2><p class="sharing-page-name">7:30 minyan</p><button type="button" data-sharing="new">New chart</button><p>Open a saved setup, or copy one to make changes while keeping the original. Website charts save changes automatically.</p><section class="saved-pages-section"><h3>On the website</h3><p>Available on other devices and to both organizers.</p><ul id="sharing-plans" class="saved-charts-list" aria-live="polite">${endpoint ? session ? '<li>Loading saved charts…</li>' : '<li>Sign in to see charts saved on the website. <button type="button" class="primary" data-sharing="signin">Sign in to open saved charts</button></li>' : '<li>Connect to the site to see pages saved online. You can open device pages below.</li>'}</ul></section><section class="saved-pages-section"><h3>On this device</h3><ul class="saved-charts-list">${devicePages}</ul><button type="button" class="text-button" data-sharing="restore">Restore a downloaded backup</button></section><p class="sharing-error" role="alert">${escText(error)}</p><div class="dialog-actions">${session ? '<button type="button" data-sharing="signout">Log out</button>' : ''}<button type="button" data-sharing="close">Close</button></div>`);
    if (endpoint && session) refreshSitePages();
  }
  async function refreshSitePages() {
    const generation = ++listRequest;
    try {
      const result = await request('/api/plans');
      if (!dialog.open || dialogMode !== 'pages' || generation !== listRequest) return;
      sitePlans = result.plans;
      dialog.querySelector('#sharing-plans').innerHTML = result.plans.length ? result.plans.map(plan => pageCard(plan, true)).join('') : '<li>No charts saved on the website yet. Add names or customize a chart, then press Save to put it here.</li>';
    } catch (error) {
      if (!dialog.open || dialogMode !== 'pages' || generation !== listRequest) return;
      dialog.querySelector('#sharing-plans').innerHTML = `<li>${escText(error.message)} ${!session ? '<button type="button" data-sharing="signin">Sign in to open saved charts</button>' : '<button type="button" data-sharing="refresh">Try again</button>'}</li>`;
    }
  }
  function historyRows(rows) {
    return rows.map(row => `<li><div class="change-history-heading"><strong>${escText(row.by || 'Organizer')}</strong><time datetime="${escAttr(row.at || '')}">${escText(formatDate(row.at))}</time></div><ul>${(row.details || []).map(detail => `<li>${escText(detail)}</li>`).join('')}</ul></li>`).join('');
  }
  function showHistory() {
    dialogMode = 'history';
    showDialog(`<h2 id="sharing-title">Chart change history</h2><p class="sharing-page-name"><bdi>${escText(current().name)}</bdi></p><div class="chart-date-details">${dateDetails(chartMetadata(current().id))}</div><p>See who changed this chart, when, and what they changed.</p><p class="sharing-error" role="alert"></p><ol id="chart-history-list" class="change-history"></ol><p id="chart-history-message" role="status">Loading changes…</p><button type="button" data-sharing="history-load" hidden>Load earlier changes</button><div class="dialog-actions"><button type="button" data-sharing="history-refresh">Refresh history</button><button type="button" data-sharing="close">Close</button></div>`);
    loadHistory();
  }
  async function loadHistory(before = null) {
    const generation = ++historyRequest, id = current().id, entry = entries.get(id), load = dialog.querySelector('[data-sharing=history-load]');
    const top = load.getBoundingClientRect().top; load.disabled = true;
    try {
      const result = entry ? await request('/api/plans/' + encodeURIComponent(entry.remoteId) + '/history' + (before ? '?before=' + before : ''))
        : { entries: [...getRecord(id).history].reverse(), nextBefore: null };
      if (!dialog.open || dialogMode !== 'history' || id !== current().id || generation !== historyRequest) return;
      const list = dialog.querySelector('#chart-history-list');
      if (before) list.insertAdjacentHTML('beforeend', historyRows(result.entries)); else list.innerHTML = historyRows(result.entries);
      dialog.querySelector('#chart-history-message').textContent = !result.entries.length && !before ? 'No changes have been recorded for this chart yet.' : entry ? '' : 'Local history keeps the 200 most recent changes on this device.';
      load.hidden = !result.nextBefore; load.dataset.before = result.nextBefore || ''; load.disabled = false;
      if (before && !load.hidden) { dialog.scrollTop += load.getBoundingClientRect().top - top; load.focus({ preventScroll: true }); }
    } catch (error) {
      if (!dialog.open || dialogMode !== 'history' || generation !== historyRequest) return;
      if (!session && entry) { showLogin(error.message); return; }
      dialog.querySelector('#chart-history-message').textContent = '';
      dialog.querySelector('.sharing-error').textContent = error.message; load.hidden = true;
    }
  }
  async function publish() {
    if (publishing) return;
    if (!canPublish()) { dialog.close(); notify('Add names or change the setup before saving this chart to the website.'); return; }
    publishing = true; changed();
    let plan, remoteId, record;
    try {
      plan = clean(current()); remoteId = pendingPublish?.localId === plan.id ? pendingPublish.remoteId : crypto.randomUUID();
      pendingPublish = { localId: plan.id, remoteId };
      record = await request('/api/plans', { method: 'POST', body: JSON.stringify({ id: remoteId, plan }) });
    } finally { publishing = false; changed(); }
    const entry = { localId: plan.id, remoteId, base: record, observed: clean(record.plan), queue: [], undo: [], redo: [], ready: false, error: '' };
    entries.set(plan.id, entry); pendingPublish = null; persist(); localChanged();
    connect(); watch(); presence(); changed();
    dialog.close(); notify('Chart saved in Saved charts on the website. Later changes save automatically.');
  }
  async function copyChartFile(id, site) {
    if (copyingChart) return;
    if (publishing) throw new Error('Wait for the current chart to finish saving before making a copy.');
    copyingChart = true;
    const panel = dialog.querySelector('#sharing-plans');
    const buttons = dialog.querySelectorAll('[data-sharing=copy-chart],[data-sharing=copy-local]');
    for (const button of buttons) button.disabled = true;
    try {
      let source = local(id);
      if (site) {
        const record = await request('/api/plans/' + encodeURIComponent(id)), entry = entryForRemote(id);
        source = entry?.queue.length ? local(entry.localId) : record.plan;
        source = { ...source, name: seatsChartName(source.name, seatsRecordMetadata(record)) };
      }
      if (!dialog.open || dialogMode !== 'pages' || panel !== dialog.querySelector('#sharing-plans')) return;
      if (!source) throw new Error('This chart is no longer available. Refresh Saved charts and try again.');
      if (!copyChart(source, sitePlans.map(plan => seatsChartName(plan.name, seatsRecordMetadata(plan))))) return;
      dialog.close(); presence();
      if (site) {
        try { await publish(); }
        catch (error) { notify('Your copy is saved on this device. Press Save to put it on the website. ' + error.message); }
      }
    } finally {
      copyingChart = false;
      for (const button of buttons) if (button.isConnected) button.disabled = false;
    }
  }
  async function openPlan(id) {
    const generation = ++openRequest;
    let record;
    try { record = await request('/api/plans/' + encodeURIComponent(id)); }
    catch (error) { if (generation !== openRequest) return; throw error; }
    if (generation !== openRequest) return;
    const existing = entryForRemote(id), localId = existing?.localId || crypto.randomUUID();
    if (!existing && getLocalPlans().length >= 30) throw new Error('There are already 30 plans on this device.');
    const entry = existing || { localId, remoteId: id, base: record, observed: clean(record.plan), queue: [], undo: [], redo: [], ready: false, error: '' };
    entries.set(localId, entry);
    applySnapshot(entry, { ...record, type: 'snapshot' });
    updatePlan(localId, clean(entry.observed, localId), true); persist();
    dialog.close(); connect(); watch(); presence(); changed();
    if (pendingPage === id) clearPageLink();
  }
  async function continueIntent() {
    await drainNameUploads();
    if (!session) { showLogin(namesError); return; }
    if (pendingPage) {
      try { await openPlan(pendingPage); }
      catch (error) { if (!session) showLogin(error.message); else showPlans(error.message); }
    } else if (intent === 'save') {
      if (entries.has(current().id)) { dialog.close(); notify(label() + '. Changes save to the website automatically when connected.'); }
      else await publish();
    }
    else if (intent === 'history') showHistory();
    else if (intent === 'names') showNameFiles();
    else showPlans();
  }
  async function open(mode = 'pages') {
    intent = mode;
    if (mode === 'save' && !entries.has(current().id) && !canPublish()) { notify('Add names or change the setup before saving this chart to the website.'); return; }
    if (mode === 'history' && !entries.has(current().id)) { showHistory(); return; }
    if (mode === 'names' && !endpoint) { showNameFiles(); return; }
    if (mode === 'pages') { showPlans(); return; }
    if (!endpoint) { showPlans(); return; }
    if (!session || session.expires <= Date.now()) showLogin(); else {
      connect();
      try { await continueIntent(); } catch (error) { if (!session) showLogin(error.message); else notify(error.message); }
    }
  }
  dialog.addEventListener('submit', async event => {
    event.preventDefault(); const button = dialog.querySelector('[type=submit]'); if (button) button.disabled = true;
    try {
      profile = dialog.querySelector('#sharing-name').value.trim();
      const result = await request('/api/session', { method: 'POST', body: JSON.stringify({ name: profile, pin: entryPin || dialog.querySelector('#sharing-pin').value }) });
      entryPin = null; session = { ...result, endpoint }; sessionStorage.setItem(SEATS_SHARING_SESSION, JSON.stringify(session)); persist(); connect(); await continueIntent(); changed();
    } catch (error) { if (session) { dialog.close(); notify(error.message); } else showLogin(error.message); }
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-sharing]'); if (!button) return;
    const action = button.dataset.sharing;
    if (action === 'close') { clearPageLink(); dialog.close(); return; }
    if (action === 'pages') { clearPageLink(); intent = 'pages'; showPlans(); return; }
    if (action === 'signin') { intent = 'pages'; showLogin(); return; }
    if (action === 'signin-names') { intent = 'names'; showLogin(); return; }
    if (action === 'refresh') { refreshSitePages(); return; }
    if (action === 'new') { dialog.close(); newChart(); return; }
    if (action === 'upload-names') { pickNamesFile(); return; }
    if (action === 'retry-names') { drainNameUploads(); return; }
    if (action === 'cancel-name-upload') { const file = nameUploads.find(file => file.id === button.dataset.id); if (file && window.confirm('Delete “' + file.name + '” from name files? Names on charts will stay.')) { file.remove = true; persistNameUploads(); renderPendingNames(); drainNameUploads(); } return; }
    if (action === 'history-load') { loadHistory(button.dataset.before); return; }
    if (action === 'history-refresh') { showHistory(); return; }
    if (action === 'local') { if (activatePage(button.dataset.id) !== false) { dialog.close(); presence(); } return; }
    if (action === 'restore') { dialog.close(); restoreBackup(); return; }
    if (action === 'signout') {
      if ([...entries.values()].some(entry => entry.queue.length) && !window.confirm('Some changes are waiting to sync. Sign out and keep them on this device?')) return;
      session = null; sessionStorage.removeItem(SEATS_SHARING_SESSION); socket?.close(); dialog.close(); changed(); onSignOut?.(); return;
    }
    button.disabled = true;
    try {
      if (action === 'publish') await publish();
      else if (action === 'open') await openPlan(button.dataset.id);
      else if (action === 'copy-chart' || action === 'copy-local') await copyChartFile(button.dataset.id, action === 'copy-chart');
      else if (action === 'use-names') await chooseNameFile(button.dataset.id);
      else if (action === 'delete-names') await deleteNameFile(button.dataset.id);
      else if (action === 'delete-chart' || action === 'delete-local') await deleteChartFile(button.dataset.id, action === 'delete-local');
      if (button.isConnected) button.disabled = false;
    }
    catch (error) { if (!session) showLogin(error.message); else if (dialog.open) { dialog.querySelector('.sharing-error').textContent = error.message; button.disabled = false; } }
  });
  async function start() {
    try {
      const config = await (await fetch('/data/seats-sync.json', { cache: 'no-store' })).json();
      if (!config.endpoint) return;
      const url = new URL(config.endpoint);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return;
      endpoint = url.origin; load(); if (initialName) profile = initialName;
      try { const saved = JSON.parse(sessionStorage.getItem(SEATS_SHARING_SESSION) || 'null'); if (saved?.endpoint === endpoint && saved.expires > Date.now()) session = saved; } catch { /* Ask for the PIN again. */ }
      for (const entry of entries.values()) {
        const plan = local(entry.localId); if (!plan) continue;
        const desired = clean(plan, entry.remoteId), changes = seatsSharedDiff(entry.observed, desired);
        if (changes.length) { entry.observed = desired; queueChanges(entry, changes); }
      }
      changed(); connect();
      if (pendingPage) {
        if (!session || session.expires <= Date.now()) showLogin(); else await continueIntent();
      } else if (nameUploads.length) { intent = 'names'; if (!session || session.expires <= Date.now()) showLogin(); else await drainNameUploads(); }
      else if (dialog.open && dialogMode === 'names') { intent = 'names'; if (!session) showLogin(); else refreshNameFiles(); }
      else if (dialog.open && dialogMode === 'pages') showPlans();
    } catch { /* Local plans keep working when the shared service is unavailable. */ }
  }
  window.addEventListener('online', () => { if (!endpoint) { start(); return; } connect(); drainNameUploads(); });
  window.addEventListener('offline', () => socket?.close());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!endpoint) { start(); return; } connect(); drainNameUploads(); } });
  return {
    close: () => { openRequest++; clearPageLink(); dialog.close(); },
    get dialogMode() { return dialog.open ? dialogMode : null; },
    start, open, localChanged, label, markup, decorate, canEdit, uploadNameFile, viewChanged: presence, leavePageLink: clearPageLink,
    metadata: id => entries.has(id) ? seatsRecordMetadata(entries.get(id).base) : null,
    get editorName() { return session?.name || profile; },
    get saving() { return publishing; },
    get nameFilesLabel() { return nameUploads.length ? 'Add names (' + nameUploads.length + (uploadingNames ? ' saving)' : ' waiting)') : 'Add names'; },
    get enabled() { return Boolean(endpoint); },
    linked: id => entries.has(id),
    canUndo: () => Boolean(entries.get(current()?.id)?.undo.length), canRedo: () => Boolean(entries.get(current()?.id)?.redo.length),
    undo: () => undo(), redo: () => undo(true),
    activity: value => { activeSeat = value ? value.tableId + ':' + value.index : null; presence(); },
    flush: () => { if (!isBusy()) { const messages = pendingMessages; pendingMessages = []; messages.forEach(receive); } },
  };
}
