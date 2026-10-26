import { escAttr, escText } from '../util.js';
import { seatsSharedApply, seatsSharedDiff, seatsSharedPlan, seatsSharedReverse } from './shared-model.js';

const SEATS_SHARING_KEY = 'lakewood-commons-seats-shared-v1';
const SEATS_SHARING_SESSION = 'lakewood-commons-seats-online-session';

export function seatsCreateSharing({ getState, updatePlan, recoverPlan, notify, onStatus, isBusy, activatePage, restoreBackup }) {
  const clientId = crypto.randomUUID(), entries = new Map();
  const dialog = document.createElement('dialog'); dialog.className = 'seats-dialog sharing-dialog no-print'; dialog.setAttribute('aria-labelledby', 'sharing-title'); document.body.appendChild(dialog);
  let endpoint = '', session = null, socket = null, ready = false, retry = null, heartbeat = null, retryCount = 0;
  let peers = [], activeSeat = null, pendingMessages = [], profile = '', dialogMode = '', lastMessage = 0;
  let intent = 'pages', listRequest = 0;
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
    if (!entry) return 'Saved on this device';
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
  function showDialog(contents) {
    dialog.classList.toggle('saved-pages-dialog', dialogMode === 'pages');
    dialog.innerHTML = contents;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function showLogin(error = '') {
    dialogMode = 'login';
    const title = pendingPage ? 'Open a shared page' : intent === 'save' ? 'Save this page to the site' : intent === 'share' ? 'Share / work together' : 'Open pages saved on the site';
    showDialog(`<h2 id="sharing-title">${title}</h2><p>Enter your name and the same Seats PIN you used to open this tool. Your name lets the other organizer see who is editing.</p><form id="sharing-login"><label for="sharing-name">Your name</label><input id="sharing-name" name="name" value="${escAttr(profile)}" maxlength="60" autocomplete="given-name" required><label for="sharing-pin">Seats PIN</label><input id="sharing-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required><p class="sharing-error" role="alert">${escText(error)}</p><div class="dialog-actions"><button type="button" data-sharing="pages">Back to saved pages</button><button class="primary" type="submit">Sign in</button></div></form>`);
  }
  function pageCard(plan, site = false) {
    const detail = site ? 'Updated by ' + plan.updatedBy + ' · ' + new Date(plan.updatedAt).toLocaleString()
      : (plan.id === current().id ? 'Current page · ' : '') + (entries.has(plan.id) ? 'Device copy of a site page' : 'Saved on this device');
    return `<div class="sharing-plan ${site ? 'sharing-site-plan' : 'sharing-local-plan'}"><button type="button" class="saved-page-card" data-sharing="${site ? 'open' : 'local'}" data-id="${escAttr(plan.id)}" aria-label="Open ${escAttr(plan.name)}"><svg class="saved-page-icon" viewBox="0 0 64 76" fill="none" aria-hidden="true" focusable="false"><path d="M9 3h33l13 13v57H9Z" fill="#fff" stroke="currentColor" stroke-width="1.5"/><path d="M42 3v13h13M17 24h30" stroke="currentColor" stroke-width="1.5"/><g fill="#eaf0f5" stroke="currentColor" stroke-width=".8"><path d="M17 31h11v5H17zM36 31h11v5H36zM17 42h11v5H17zM36 42h11v5H36zM17 53h11v5H17zM36 53h11v5H36z"/></g></svg><strong><bdi>${escText(plan.name)}</bdi></strong><small>${escText(detail)}</small><span class="saved-page-open">Open page</span></button></div>`;
  }
  function showPlans(error = '') {
    dialogMode = 'pages';
    listRequest++;
    const devicePages = getState().plans.map(plan => pageCard(plan)).join('');
    showDialog(`<h2 id="sharing-title" class="saved-pages-heading"><svg class="page-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><path d="M3 7V5h7l2 2h9v13H3Z"/><path d="M3 10h18"/></svg>Saved pages</h2><p>Choose a page in this folder to open it. Your other pages stay saved.</p><section class="saved-pages-section"><h3>Saved on the site</h3><p>Available on other devices and to both organizers.</p><div id="sharing-plans" class="saved-pages-grid" aria-live="polite">${endpoint ? session ? '<p>Loading saved pages…</p>' : '<p>Sign in to see pages saved on the site.</p><button type="button" class="primary" data-sharing="signin">Sign in to view site pages</button>' : '<p>Connect to the site to see pages saved online. You can open device pages below.</p>'}</div></section><section class="saved-pages-section"><h3>On this device</h3><div class="saved-pages-grid">${devicePages}</div><button type="button" class="text-button" data-sharing="restore">Restore a downloaded backup</button></section><p class="sharing-error" role="alert">${escText(error)}</p><div class="dialog-actions">${session ? '<button type="button" data-sharing="signout">Sign out</button>' : ''}<button type="button" data-sharing="close">Close</button></div>`);
    if (endpoint && session) refreshSitePages();
  }
  async function refreshSitePages() {
    const generation = ++listRequest;
    try {
      const result = await request('/api/plans');
      if (!dialog.open || dialogMode !== 'pages' || generation !== listRequest) return;
      dialog.querySelector('#sharing-plans').innerHTML = result.plans.length ? result.plans.map(plan => pageCard(plan, true)).join('') : '<p>No pages saved on the site yet. Close this window and choose Save to site for your current page.</p>';
    } catch (error) {
      if (!dialog.open || dialogMode !== 'pages' || generation !== listRequest) return;
      dialog.querySelector('#sharing-plans').innerHTML = `<p>${escText(error.message)}</p>${!session ? '<button type="button" data-sharing="signin">Sign in to view site pages</button>' : '<button type="button" data-sharing="refresh">Try again</button>'}`;
    }
  }
  function showSave(saved = false) {
    dialogMode = 'save';
    const linked = entries.has(current().id);
    showDialog(`<h2 id="sharing-title">${linked ? saved ? 'Page saved to the site' : 'This page is saved to the site' : 'Save this page to the site'}</h2><p class="sharing-page-name"><bdi>${escText(current().name)}</bdi></p><p>${linked ? 'Later changes save automatically when connected. You can reopen this page from Saved pages on any device.' : 'Save the layout, names and seat assignments so you can reopen this page on another device or work on it together. Later changes save automatically.'}</p>${linked ? `<p><strong>Save status:</strong> <span data-sharing-status>${escText(label())}</span></p><button class="primary" type="button" data-sharing="share">Share / work together</button><button type="button" data-sharing="pages">Saved pages</button>` : '<button class="primary" type="button" data-sharing="publish">Save this page to the site</button>'}<p class="sharing-error" role="alert"></p><div class="dialog-actions"><button type="button" data-sharing="close">${linked ? 'Done' : 'Cancel'}</button></div>`);
  }
  function showShare() {
    dialogMode = 'share';
    const entry = entries.get(current().id), url = new URL(location.pathname, location.origin);
    if (entry) url.searchParams.set('page', entry.remoteId);
    showDialog(`<h2 id="sharing-title">Share / work together</h2><p class="sharing-page-name"><bdi>${escText(current().name)}</bdi></p>${entry ? `<ol class="sharing-steps"><li>Copy this page link and send it to the other organizer.</li><li>They open it and enter their own name and the same Seats PIN.</li><li>Both of you edit this page. Changes save automatically and appear for each other.</li></ol><label for="sharing-link">Link to this seating page</label><input id="sharing-link" type="text" readonly value="${escAttr(url.href)}"><button class="primary" type="button" data-sharing="copy">Copy page link</button><p id="sharing-copy-status" role="status" aria-live="polite"></p><p>They can also use Saved pages, sign in, and choose this page under Saved on the site.</p>` : '<p>Save this page to the site first. Then you’ll get a link so both organizers can open and edit the same page.</p><button class="primary" type="button" data-sharing="publish">Save to site and get a link</button>'}<p class="sharing-error" role="alert"></p><div class="dialog-actions"><button type="button" data-sharing="close">Close</button></div>`);
  }
  async function copyLink(button) {
    const input = dialog.querySelector('#sharing-link');
    let copied = false;
    try { await navigator.clipboard.writeText(input.value); copied = true; } catch { /* Select the visible link when clipboard access is refused. */ }
    if (!dialog.open || dialogMode !== 'share' || !input.isConnected) return;
    if (!copied) {
      input.focus({ preventScroll: true }); input.select(); input.setSelectionRange(0, input.value.length);
      try { copied = document.execCommand('copy'); } catch { /* The selected link can still be copied by hand. */ }
    }
    if (!dialog.open || dialogMode !== 'share') return;
    dialog.querySelector('#sharing-copy-status').textContent = copied ? 'Link copied. Send it to the other organizer and give them the Seats PIN separately.' : 'The link is selected. Copy it and send it to the other organizer.';
    if (copied) button.focus({ preventScroll: true });
  }
  async function publish() {
    const plan = clean(current()), remoteId = crypto.randomUUID();
    const record = await request('/api/plans', { method: 'POST', body: JSON.stringify({ id: remoteId, plan }) });
    const entry = { localId: plan.id, remoteId, base: record, observed: clean(record.plan), queue: [], undo: [], redo: [], ready: false, error: '' };
    entries.set(plan.id, entry); persist();
    connect(); watch(); presence(); changed();
    notify('Page saved to the site. Later changes save automatically.');
    if (intent === 'share') showShare(); else showSave(true);
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
    if (pendingPage === id) clearPageLink();
  }
  async function continueIntent() {
    if (pendingPage) {
      try { await openPlan(pendingPage); }
      catch (error) { if (!session) showLogin(error.message); else showPlans(error.message); }
    } else if (intent === 'share') showShare();
    else if (intent === 'save') showSave();
    else showPlans();
  }
  async function open(mode = 'pages') {
    intent = mode;
    if (mode === 'pages') { showPlans(); return; }
    if (!endpoint) { showPlans(); return; }
    if (!session || session.expires <= Date.now()) showLogin(); else { connect(); await continueIntent(); }
  }
  dialog.addEventListener('submit', async event => {
    event.preventDefault(); const button = dialog.querySelector('[type=submit]'); if (button) button.disabled = true;
    try {
      profile = dialog.querySelector('#sharing-name').value.trim();
      const result = await request('/api/session', { method: 'POST', body: JSON.stringify({ name: profile, pin: dialog.querySelector('#sharing-pin').value }) });
      session = { ...result, endpoint }; sessionStorage.setItem(SEATS_SHARING_SESSION, JSON.stringify(session)); persist(); connect(); await continueIntent(); changed();
    } catch (error) { showLogin(error.message); }
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-sharing]'); if (!button) return;
    const action = button.dataset.sharing;
    if (action === 'close') { clearPageLink(); dialog.close(); return; }
    if (action === 'pages') { clearPageLink(); intent = 'pages'; showPlans(); return; }
    if (action === 'signin') { intent = 'pages'; showLogin(); return; }
    if (action === 'refresh') { refreshSitePages(); return; }
    if (action === 'share') { intent = 'share'; showShare(); return; }
    if (action === 'copy') { copyLink(button); return; }
    if (action === 'local') { if (activatePage(button.dataset.id) !== false) { dialog.close(); presence(); } return; }
    if (action === 'restore') { dialog.close(); restoreBackup(); return; }
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
      if (pendingPage) {
        if (!session || session.expires <= Date.now()) showLogin(); else await continueIntent();
      }
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
