import { calendarRequest } from '../calendar/api.js';
import { calendarAnnouncementText } from '../calendar/announcement-model.js';
import { escText, escAttr } from '../util.js';

export function createCalendarAnnouncements({ dialog, timeZone, onSessionExpired }) {
  let actor = null, timer = null, button = null, active = null;
  let total = 0, readCount = 0, deletedCount = 0, canPost = false, canDelete = false, unavailable = false;
  const unread = () => Math.max(0, total - readCount);
  const matches = id => actor?.id === id;
  function paint() {
    if (button?.isConnected) {
      const count = unread(), badge = button.querySelector('[data-cal-announcement-count]');
      badge.textContent = unavailable ? '!' : count;
      badge.hidden = !unavailable && !count;
      button.setAttribute('aria-label', unavailable ? 'Announcements, unread count unavailable' : count ? `Announcements, ${count} unread` : 'Announcements');
    }
    if (active) {
      active.newButton.hidden = total <= active.latest;
      active.form.hidden = !canPost;
      active.feed.querySelectorAll('[data-cal-delete-announcement]').forEach(control => { control.hidden = !canDelete; });
    }
  }
  function status(value) {
    // Deleted posts count as seen for everyone. All three counters only grow.
    total = Math.max(total, value.total);
    readCount = Math.max(readCount, value.total - value.unread);
    deletedCount = Math.max(deletedCount, value.deletedCount || 0);
    canPost = value.canPost === true; canDelete = value.canDelete === true; unavailable = false; paint();
  }
  function failed(error, id) {
    if (matches(id) && error.status === 401) { onSessionExpired(error.message); return true; }
    return false;
  }
  async function refresh() {
    if (!actor || document.visibilityState !== 'visible') return;
    const id = actor.id;
    try { const value = await calendarRequest('/api/announcements/status'); if (matches(id)) { status(value); await active?.syncDeleted(); } }
    catch (error) { if (matches(id) && !failed(error, id)) { unavailable = true; paint(); } }
  }
  function visible() { refresh(); active?.observe(); }
  function stop() {
    actor = null; clearInterval(timer); timer = null;
    document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible);
    active?.cleanup(); active?.view.el.calDispose(); active = null;
    total = readCount = deletedCount = 0; canPost = canDelete = unavailable = false;
  }
  function start(user) {
    if (actor?.id === user.id) return;
    stop(); actor = user;
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible);
    timer = setInterval(refresh, 30000); refresh();
  }
  function bind(container) {
    button = container.querySelector('[data-cal-announcements]');
    button?.addEventListener('click', open); paint();
  }
  function markup() {
    return '<button type="button" data-cal-announcements>Announcements <span class="cal-unread-count" data-cal-announcement-count hidden aria-hidden="true"></span></button>';
  }
  async function open() {
    if (!actor || active) return;
    const id = actor.id;
    let posting = false, deleting = false, reading = false, pendingTimer = null, operation = null, nextBefore = null, loading = false, syncing = null, knownDeletedCount = 0;
    const pending = new Set(), messages = new Map(), deletedIds = new Set();
    let observer;
    const view = dialog('<p class="cal-announcement-intro">Updates for everyone with calendar access.</p><form class="cal-form cal-announcement-compose" hidden><label>New announcement<textarea name="message" maxlength="4000" rows="3" required placeholder="Write an update…"></textarea></label><button class="cal-primary" type="submit">Post announcement</button></form><p class="cal-announcement-status" role="status" aria-live="polite"></p><button type="button" data-cal-new-announcements hidden>Show new announcements</button><div class="cal-announcement-feed" tabindex="0" aria-label="Announcement messages"><p>Loading announcements…</p></div><button type="button" data-cal-older-announcements hidden>Load older announcements</button><button type="button" data-cal-announcement-retry hidden>Try again</button>', {
      onClose: () => {
        if (posting || deleting || textarea.value.trim() && !confirm('Discard your announcement draft?')) return false;
        cleanup(); active = null; return true;
      },
    });
    view.title('Announcements'); view.el.classList.add('cal-announcements-dialog');
    const feed = view.el.querySelector('.cal-announcement-feed'), form = view.el.querySelector('form');
    const textarea = form.elements.message, messageStatus = view.el.querySelector('[role=status]');
    const older = view.el.querySelector('[data-cal-older-announcements]'), retry = view.el.querySelector('[data-cal-announcement-retry]');
    const newButton = view.el.querySelector('[data-cal-new-announcements]');
    const current = () => matches(id) && active?.view === view && view.el.isConnected;
    function cleanup() { observer?.disconnect(); clearTimeout(pendingTimer); }
    function notice(text, error = false, source = '') {
      messageStatus.textContent = text; messageStatus.classList.toggle('cal-error', error); messageStatus.dataset.source = source;
    }
    function whenDate(value) {
      return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
    }
    function card(message) {
      return `<article class="cal-announcement-message${message.read ? '' : ' is-unread'}" data-announcement-id="${escAttr(message.id)}"><header><strong dir="auto">${escText(message.authorName)}</strong><time datetime="${escAttr(message.createdAt)}">${escText(whenDate(message.createdAt))}</time><span class="cal-announcement-new" ${message.read ? 'hidden' : ''}>New</span></header><p dir="auto">${escText(message.text)}</p><button type="button" class="cal-announcement-delete" data-cal-delete-announcement="${escAttr(message.id)}" aria-label="${escAttr('Delete announcement by ' + message.authorName + ' from ' + whenDate(message.createdAt))}" ${canDelete ? '' : 'hidden'}>Delete</button><span class="cal-announcement-end" data-cal-announcement-end="${escAttr(message.id)}" aria-hidden="true"></span></article>`;
    }
    function removeDeleted(ids) {
      const scrollTop = feed.scrollTop;
      for (const key of ids) {
        deletedIds.add(key); pending.delete(key); messages.delete(key);
        const node = [...feed.querySelectorAll('[data-announcement-id]')].find(item => item.dataset.announcementId === key);
        if (!node) continue;
        const focused = node.contains(document.activeElement), neighbor = node.nextElementSibling || node.previousElementSibling;
        observer?.unobserve(node.querySelector('[data-cal-announcement-end]')); node.remove();
        if (focused) (neighbor?.querySelector('[data-cal-delete-announcement]') || feed).focus({ preventScroll: true });
      }
      if (!messages.size) feed.innerHTML = '<p class="cal-empty">No announcements yet.</p>';
      feed.scrollTop = scrollTop;
    }
    async function syncDeleted() {
      if (!current() || knownDeletedCount >= deletedCount) return;
      if (syncing) return syncing;
      syncing = (async () => {
        try {
          const value = await calendarRequest('/api/announcements/deleted'); if (!current()) return;
          removeDeleted(value.ids); knownDeletedCount = Math.max(knownDeletedCount, value.deletedCount);
          deletedCount = Math.max(deletedCount, value.deletedCount);
          if (messageStatus.dataset.source === 'deletions') { notice(''); retry.hidden = true; }
        } catch (error) { if (current() && !failed(error, id)) { notice('Announcement updates could not be loaded. Use Try again to retry.', true, 'deletions'); retry.hidden = false; } }
      })();
      try { await syncing; } finally { syncing = null; }
    }
    async function markRead() {
      if (!current() || reading || !pending.size || document.visibilityState !== 'visible') return;
      reading = true; let saved = false;
      const ids = [...pending].slice(0, 100); ids.forEach(value => pending.delete(value));
      try {
        const value = await calendarRequest('/api/announcements/read', { method: 'POST', body: { ids } });
        if (!matches(id)) return;
        status(value); saved = true;
        if (current() && messageStatus.dataset.source === 'read') { notice(''); retry.hidden = true; }
        if (current()) for (const key of ids) {
          if (messages.has(key)) messages.get(key).read = true;
          const node = [...feed.querySelectorAll('[data-announcement-id]')].find(item => item.dataset.announcementId === key);
          node?.classList.remove('is-unread'); if (node) node.querySelector('.cal-announcement-new').hidden = true;
        }
      } catch (error) {
        if (current() && !failed(error, id)) { ids.forEach(value => pending.add(value)); notice('Read status could not be saved. Use Try again to retry.', true, 'read'); retry.hidden = false; }
      } finally { reading = false; if (saved && pending.size && current()) pendingTimer = setTimeout(markRead, 250); }
    }
    function observe() {
      observer?.disconnect();
      if (!current() || document.visibilityState !== 'visible') return;
      for (const node of feed.querySelectorAll('[data-cal-announcement-end]')) {
        if (!messages.get(node.dataset.calAnnouncementEnd)?.read) observer.observe(node);
      }
    }
    observer = new IntersectionObserver(entries => {
      if (!current() || document.visibilityState !== 'visible') return;
      for (const entry of entries) if (entry.isIntersecting) {
        pending.add(entry.target.dataset.calAnnouncementEnd); observer.unobserve(entry.target);
      }
      clearTimeout(pendingTimer); pendingTimer = setTimeout(markRead, 250);
    }, { threshold: 1 });
    active = { view, latest: 0, form, feed, newButton, observe, cleanup, syncDeleted }; paint();
    async function load(append = false) {
      if (!current() || loading) return;
      loading = true; older.disabled = retry.disabled = newButton.disabled = true;
      try {
        const value = await calendarRequest('/api/announcements' + (append && nextBefore ? '?before=' + nextBefore : ''));
        if (!current()) return;
        if (messageStatus.dataset.source === 'load') notice('');
        if (!append) { messages.clear(); feed.innerHTML = ''; feed.scrollTop = 0; }
        else if (!messages.size) feed.innerHTML = '';
        for (const item of value.messages) if (!messages.has(item.id) && !deletedIds.has(item.id)) { messages.set(item.id, item); feed.insertAdjacentHTML('beforeend', card(item)); }
        if (!messages.size) feed.innerHTML = '<p class="cal-empty">No announcements yet.</p>';
        if (!append) active.latest = Math.max(active.latest, value.total);
        nextBefore = value.nextBefore; older.hidden = !nextBefore; retry.hidden = true; status(value); await syncDeleted(); observe();
      } catch (error) {
        if (current() && !failed(error, id)) {
          notice(error.message, true, 'load'); retry.hidden = false;
          if (!messages.size) feed.innerHTML = '<p class="cal-empty">Announcements could not be loaded.</p>';
        }
      } finally { loading = false; if (current()) older.disabled = retry.disabled = newButton.disabled = false; }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (posting || deleting) return;
      let text; try { text = calendarAnnouncementText(textarea.value); } catch (error) { notice(error.message, true, 'post'); return; }
      if (!operation || operation.text !== text) operation = { id: crypto.randomUUID(), text };
      posting = true; textarea.disabled = true; form.querySelector('button').disabled = true; notice('Posting…');
      try {
        const value = await calendarRequest('/api/announcements', { method: 'POST', body: operation });
        if (!current()) return;
        status(value); textarea.value = ''; operation = null; notice('Announcement posted.'); await load();
      } catch (error) { if (current() && !failed(error, id)) notice(error.message + ' Your text is kept; try posting again.', true, 'post'); }
      finally { posting = false; if (current()) { textarea.disabled = false; form.querySelector('button').disabled = false; } }
    });
    feed.addEventListener('click', async event => {
      const control = event.target.closest('[data-cal-delete-announcement]');
      if (!control || !canDelete || posting || deleting || !current() || !confirm('Delete this announcement for everyone?')) return;
      const messageId = control.dataset.calDeleteAnnouncement;
      deleting = true; control.disabled = true; form.querySelector('button').disabled = true; notice('Deleting…');
      try {
        const value = await calendarRequest('/api/announcements/' + encodeURIComponent(messageId), { method: 'DELETE' });
        if (!current()) return;
        status(value); removeDeleted([messageId]); notice('Announcement deleted.'); await syncDeleted();
      } catch (error) { if (current() && !failed(error, id)) notice(error.message + ' Try Delete again to retry.', true, 'delete'); }
      finally { deleting = false; if (current()) { control.disabled = false; form.querySelector('button').disabled = false; } }
    });
    older.addEventListener('click', () => load(true));
    newButton.addEventListener('click', () => load());
    retry.addEventListener('click', () => { markRead(); syncDeleted(); load(); });
    await load();
  }
  return { start, stop, bind, markup, refresh, dispose: stop };
}
