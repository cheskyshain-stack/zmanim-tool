import { escAttr, escText } from '../util.js';
import { seatsSharedApply, seatsSharedDiff, seatsSharedPlan, seatsSharedReverse } from './shared-model.js';

const SEATS_SHARING_KEY = 'lakewood-commons-seats-shared-v1';
const SEATS_SHARING_SESSION = 'lakewood-commons-seats-online-session';

export function seatsCreateSharing({ getState, updatePlan, recoverPlan, notify, onStatus, isBusy }) {
  const clientId = crypto.randomUUID(), entries = new Map();
  const dialog = document.createElement('dialog'); dialog.className = 'seats-dialog sharing-dialog no-print'; document.body.appendChild(dialog);
  let endpoint = '', session = null, socket = null, ready = false, retry = null, heartbeat = null, retryCount = 0;
  let peers = [], activeSeat = null, pendingMessages = [], profile = '', dialogMode = '', lastMessage = 0;
  const current = () => getState().plans.find(plan => plan.id === getState().activeId);
  const local = id => getState().plans.find(plan => plan.id === id);
  const entryForRemote = id => [...entries.values()].find(entry => entry.remoteId === id);
  const clean = (plan, id = plan.id) => seatsSharedPlan({ ...plan, id });
  const changed = () => onStatus();
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
      if (response.status === 401) { session = null; sessionStorage.removeItem(SEATS_SHARING_SESSION); }
      throw new Error(result.error || 'The shared plan could not be opened.');
    }
    return result;
  }
  function send(message) { if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function watch() { send({ type: 'watch', ids: [...new Set([...entries.values()].map(entry => entry.remoteId))] }); }
  function presence() { send({ type: 'presence', planId: entries.get(current()?.id)?.remoteId || null, seat: activeSeat }); }
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
    const base = { plan: clean(message.plan, entry.remoteId), revision: message.revision, updatedAt: message.updatedAt, updatedBy: message.updatedBy };
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
    if (isBusy() && ['snapshot', 'conflict'].includes(message.type)) { pendingMessages.push(message); return; }
    if (message.type === 'ready') {
      ready = true; retryCount = 0;
      for (const entry of entries.values()) { entry.ready = false; for (const operation of entry.queue) delete operation.sent; }
      watch(); presence(); changed(); return;
    }
    if (message.type === 'snapshot' || message.type === 'conflict') {
      const entry = entryForRemote(message.plan?.id);
      if (entry) applySnapshot(entry, message);
    } else if (message.type === 'presence') { peers = message.peers || []; changed(); }
    else if (message.type === 'busy') notify(message.name + ' is editing that seat. Choose another seat while they finish.');
    else if (message.type === 'error') notify(message.error || 'That shared update could not be saved.');
    else if (message.type === 'plans-changed' && dialog.open && dialogMode === 'plans') showPlans();
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
    entry.queue.push({ id: crypto.randomUUID(), changes });
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
    if (!entry) return 'Saved in this browser';
    if (entry.error) return entry.error;
    if (!session || session.expires <= Date.now()) return 'Local copy saved · Sign in to sync';
    if (!ready || !entry.ready) return 'Local copy saved · Reconnecting';
    return entry.queue.length ? 'Saving online…' : 'Saved online';
  }
  function peersHere() { const id = entries.get(current()?.id)?.remoteId; return id ? peers.filter(peer => peer.clientId !== clientId && peer.planId === id) : []; }
  function markup() {
    const entry = entries.get(current()?.id); if (!entry) return '';
    const others = peersHere(), text = others.map(peer => peer.name + (peer.seat ? ' editing ' + peer.seat.replace(':', ' · Seat ').replace(/Seat (\d+)$/, (_, index) => 'Seat ' + (Number(index) + 1)) : ' is viewing this plan')).join(' · ');
    return `<span class="sharing-state${ready ? ' connected' : ''}">${escText(label())}</span>${text ? `<span class="sharing-peers">${escText(text)}</span>` : ''}`;
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
  function showLogin(error = '') {
    dialogMode = 'login';
    dialog.innerHTML = `<h2>Work together</h2><p>Both organizers can open the same shared plan. Changes save online and appear for the other person.</p><form id="sharing-login"><label for="sharing-name">Your name</label><input id="sharing-name" name="name" value="${escAttr(profile)}" maxlength="60" autocomplete="given-name" required><label for="sharing-pin">Seats PIN</label><input id="sharing-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required><p class="sharing-error" role="alert">${escText(error)}</p><div class="dialog-actions"><button type="button" data-sharing="close">Cancel</button><button class="primary" type="submit">Open shared plans</button></div></form>`;
    if (!dialog.open) dialog.showModal();
  }
  async function showPlans(error = '') {
    dialogMode = 'plans';
    const linked = entries.has(current().id);
    dialog.innerHTML = `<h2>Shared plans</h2><p>Signed in as ${escText(session.name)}. Both organizers should open the same plan below.</p>${linked ? '<p>This plan is shared. Changes save automatically.</p>' : '<button class="primary" type="button" data-sharing="publish">Save this plan to the site</button>'}<p class="sharing-error" role="alert">${escText(error)}</p><div id="sharing-plans">Loading saved plans…</div><div class="dialog-actions"><button type="button" data-sharing="signout">Sign out</button><button type="button" data-sharing="close">Close</button></div>`;
    if (!dialog.open) dialog.showModal();
    try {
      const result = await request('/api/plans');
      if (!dialog.open || dialogMode !== 'plans') return;
      dialog.querySelector('#sharing-plans').innerHTML = result.plans.length ? result.plans.map(plan => `<div class="sharing-plan"><div><strong><bdi>${escText(plan.name)}</bdi></strong><small>Updated by ${escText(plan.updatedBy)} · ${escText(new Date(plan.updatedAt).toLocaleString())}</small></div><button type="button" data-sharing="open" data-id="${escAttr(plan.id)}">Open</button></div>`).join('') : '<p>No shared plans yet. Save this plan to get started.</p>';
    } catch (error) {
      if (!session) showLogin(error.message); else dialog.querySelector('.sharing-error').textContent = error.message;
    }
  }
  async function publish() {
    const plan = clean(current()), remoteId = crypto.randomUUID();
    const record = await request('/api/plans', { method: 'POST', body: JSON.stringify({ id: remoteId, plan }) });
    const entry = { localId: plan.id, remoteId, base: record, observed: clean(record.plan), queue: [], undo: [], redo: [], ready: false, error: '' };
    entries.set(plan.id, entry); persist();
    connect(); watch(); presence(); dialog.close(); changed();
    notify('Saved to the site. The other organizer can open this plan from Shared plans.');
  }
  async function openPlan(id) {
    const record = await request('/api/plans/' + encodeURIComponent(id));
    const existing = entryForRemote(id), localId = existing?.localId || crypto.randomUUID();
    if (!existing && getState().plans.length >= 30) throw new Error('There are already 30 plans on this device.');
    const entry = existing || { localId, remoteId: id, base: record, observed: clean(record.plan), queue: [], undo: [], redo: [], ready: false, error: '' };
    entries.set(localId, entry);
    applySnapshot(entry, { ...record, type: 'snapshot' });
    updatePlan(localId, clean(entry.observed, localId), true); persist();
    dialog.close(); connect(); watch(); presence(); changed();
  }
  async function open() {
    if (!endpoint) return;
    if (!session || session.expires <= Date.now()) showLogin(); else { connect(); await showPlans(); }
  }
  dialog.addEventListener('submit', async event => {
    event.preventDefault(); const button = dialog.querySelector('[type=submit]'); if (button) button.disabled = true;
    try {
      profile = dialog.querySelector('#sharing-name').value.trim();
      const result = await request('/api/session', { method: 'POST', body: JSON.stringify({ name: profile, pin: dialog.querySelector('#sharing-pin').value }) });
      session = { ...result, endpoint }; sessionStorage.setItem(SEATS_SHARING_SESSION, JSON.stringify(session)); persist(); connect(); await showPlans(); changed();
    } catch (error) { showLogin(error.message); }
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-sharing]'); if (!button) return;
    const action = button.dataset.sharing;
    if (action === 'close') { dialog.close(); return; }
    if (action === 'signout') {
      if ([...entries.values()].some(entry => entry.queue.length) && !window.confirm('Some changes are waiting to sync. Sign out and keep them on this device?')) return;
      session = null; sessionStorage.removeItem(SEATS_SHARING_SESSION); socket?.close(); dialog.close(); changed(); return;
    }
    button.disabled = true;
    try { if (action === 'publish') await publish(); else if (action === 'open') await openPlan(button.dataset.id); }
    catch (error) { if (!session) showLogin(error.message); else if (dialog.open) { dialog.querySelector('.sharing-error').textContent = error.message; button.disabled = false; } }
  });
  async function start() {
    try {
      const config = await (await fetch('/data/seats-sync.json', { cache: 'no-store' })).json();
      if (!config.endpoint) return;
      const url = new URL(config.endpoint);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return;
      endpoint = url.origin; load();
      try { const saved = JSON.parse(sessionStorage.getItem(SEATS_SHARING_SESSION) || 'null'); if (saved?.endpoint === endpoint && saved.expires > Date.now()) session = saved; } catch { /* Ask for the PIN again. */ }
      for (const entry of entries.values()) {
        const plan = local(entry.localId); if (!plan) continue;
        const desired = clean(plan, entry.remoteId), changes = seatsSharedDiff(entry.observed, desired);
        if (changes.length) { entry.observed = desired; queueChanges(entry, changes); }
      }
      changed(); connect();
    } catch { /* Local plans keep working when the shared service is unavailable. */ }
  }
  window.addEventListener('online', connect);
  window.addEventListener('offline', () => socket?.close());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });
  return {
    start, open, localChanged, label, markup, decorate, canEdit,
    get enabled() { return Boolean(endpoint); },
    linked: id => entries.has(id),
    canUndo: () => Boolean(entries.get(current()?.id)?.undo.length), canRedo: () => Boolean(entries.get(current()?.id)?.redo.length),
    undo: () => undo(), redo: () => undo(true),
    activity: value => { activeSeat = value ? value.tableId + ':' + value.index : null; presence(); },
    flush: () => { if (!isBusy()) { const messages = pendingMessages; pendingMessages = []; messages.forEach(receive); } },
  };
}
