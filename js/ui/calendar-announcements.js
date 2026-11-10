import { calendarRequest } from '../calendar/api.js';
import { calendarAnnouncementText, calendarAnnouncementDate, calendarAnnouncementOrder, calendarAnnouncementLocalTime, calendarAnnouncementInstant } from '../calendar/announcement-model.js';
import { escText, escAttr } from '../util.js';

export function createCalendarAnnouncements({ dialog, timeZone, onSessionExpired }) {
  let actor = null, timer = null, button = null, active = null;
  let total = 0, readCount = 0, deletedCount = 0, editCount = 0, canPost = false, canDelete = false, canEdit = false, unavailable = false;
  let dateEditing = false, historySince = null, snapshotAt = '';
  const dayFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone });
  const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone });
  const timeFormat = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone });
  const fullFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const unread = () => Math.max(0, total - readCount);
  const matches = value => actor === value;
  const previewing = () => actor?.preview === true;
  const request = (path, options) => calendarRequest(path + (actor?.role === 'viewer' ? (path.includes('?') ? '&' : '?') + 'view=congregation' : ''), options);
  function localDay(date) {
    const parts = Object.fromEntries(dayFormat.formatToParts(date).map(({ type, value }) => [type, value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000;
  }
  function whenDate(value) {
    const date = new Date(value);
    if (actor?.role !== 'viewer') return fullFormat.format(date);
    const age = localDay(new Date()) - localDay(date);
    return age === 0 ? timeFormat.format(date) : age === 1 ? 'Yesterday' : dateFormat.format(date);
  }
  function paint() {
    if (button?.isConnected) {
      const count = unread(), badge = button.querySelector('[data-cal-announcement-count]');
      badge.textContent = unavailable ? '!' : count;
      badge.hidden = !unavailable && !count;
      const label = button.dataset.calAnnouncementLabel || 'Announcements';
      button.setAttribute('aria-label', unavailable ? `${label}, unread count unavailable` : count ? `${label}, ${count} unread` : label);
    }
    if (active) {
      active.newButton.hidden = total <= active.latest;
      active.form.hidden = !canPost;
      active.form.querySelectorAll('input,textarea,button').forEach(control => { if (previewing()) control.disabled = true; });
      active.form.querySelector('[data-cal-added-date]').hidden = !dateEditing;
      active.form.elements.addedAt.disabled = !dateEditing || previewing();
      active.expire();
      active.feed.querySelectorAll('[data-cal-delete-announcement]').forEach(control => { control.hidden = !canDelete; if (previewing()) control.disabled = true; });
      active.feed.querySelectorAll('[data-cal-edit-announcement]').forEach(control => { control.hidden = !canEdit; if (previewing()) control.disabled = true; });
      active.feed.querySelectorAll('.cal-announcement-message > header > time').forEach(time => { time.textContent = whenDate(time.dateTime); });
    }
  }
  function status(value) {
    if (value.snapshotAt && value.snapshotAt < snapshotAt) return;
    if (value.snapshotAt) {
      snapshotAt = value.snapshotAt; total = value.total; readCount = value.total - value.unread;
      dateEditing = value.dateEditing === true; historySince = value.historySince || null;
    } else {
      total = Math.max(total, value.total); readCount = Math.max(readCount, value.total - value.unread);
    }
    deletedCount = Math.max(deletedCount, value.deletedCount || 0);
    editCount = Math.max(editCount, value.editCount || 0);
    const editor = ['owner', 'editor'].includes(actor?.role);
    canPost = editor && value.canPost === true; canDelete = editor && value.canDelete === true; canEdit = editor && value.canEdit === true; unavailable = false; paint();
  }
  function failed(error, id) {
    if (matches(id) && error.status === 401) { onSessionExpired(error.message); return true; }
    return false;
  }
  async function refresh() {
    if (!actor || document.visibilityState !== 'visible') return;
    const id = actor;
    try { const value = await request('/api/announcements/status'); if (matches(id)) { status(value); await active?.syncDeleted(); await active?.syncEdits(); } }
    catch (error) { if (matches(id) && !failed(error, id)) { unavailable = true; paint(); } }
  }
  function visible() { refresh(); active?.observe(); }
  function stop() {
    actor = null; clearInterval(timer); timer = null;
    document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible);
    active?.cleanup(); active?.view.el.calDispose(); active = null;
    total = readCount = deletedCount = editCount = 0; canPost = canDelete = canEdit = unavailable = false;
    dateEditing = false; historySince = null; snapshotAt = '';
  }
  function start(user, { previewRole = '', readOnly = false } = {}) {
    const role = readOnly ? 'viewer' : previewRole || user.role, preview = !!previewRole;
    if (actor?.id === user.id && actor.role === role && actor.preview === preview) return;
    stop(); actor = { ...user, role, preview };
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible);
    timer = setInterval(refresh, 30000); refresh();
  }
  function bind(container, openPhoneReminders) {
    button = container.querySelector('[data-cal-announcements]');
    button?.addEventListener('click', () => open(openPhoneReminders)); paint();
  }
  function markup({ label = 'Announcements', icon = false } = {}) {
    return `<button type="button" data-cal-announcements data-cal-announcement-label="${escAttr(label)}">${icon ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>' : ''}<span>${escText(label)}</span><span class="cal-unread-count" data-cal-announcement-count hidden aria-hidden="true"></span></button>`;
  }
  async function open(openPhoneReminders) {
    if (!actor || active) return;
    const id = actor;
    let posting = false, deleting = false, reading = false, pendingTimer = null, operation = null, nextBefore = null, nextCursor = null, loading = false, syncing = null, knownDeletedCount = 0;
    const pending = new Set(), messages = new Map(), deletedIds = new Set();
    const openingId = crypto.randomUUID(); let openingRecorded = false;
    let editing = null, syncingEdits = null, knownEditCount = 0;
    let observer;
    const intro = previewing() ? '<p class="cal-announcement-intro">Preview only. Posts and read status stay unchanged. Choose Main admin to make changes.</p>' : '';
    const view = dialog(intro + `<form class="cal-form cal-announcement-compose" hidden><label>New announcement<textarea name="message" maxlength="4000" rows="3" required placeholder="Write an update…"></textarea></label><div data-cal-added-date hidden><label>Added date and time (optional)<input type="datetime-local" name="addedAt" step="60" disabled></label><p class="cal-form-note">${escText(timeZone.replaceAll('_', ' '))} time. Leave blank to use now.</p></div><button class="cal-primary" type="submit">Post announcement</button></form><p class="cal-announcement-status" role="status" aria-live="polite"></p><button type="button" data-cal-new-announcements hidden>Show new announcements</button><div class="cal-announcement-feed" tabindex="0" aria-label="Announcement messages"><p>Loading announcements…</p></div><button type="button" data-cal-older-announcements hidden>Load older announcements</button><button type="button" data-cal-announcement-retry hidden>Try again</button>`, {
      onClose: () => {
        if (posting || deleting || editing?.saving || (textarea.value.trim() || form.elements.addedAt.value || editDirty()) && !confirm('Discard your unsaved announcement changes?')) return false;
        cleanup(); active = null; return true;
      },
    });
    view.title(button?.dataset.calAnnouncementLabel || 'Announcements'); view.el.classList.add('cal-announcements-dialog');
    if (actor.role === 'viewer') {
      view.el.classList.add('cal-announcement-reader');
      if (openPhoneReminders) {
        const setup = document.createElement('button');
        setup.type = 'button'; setup.textContent = 'Phone reminders'; setup.disabled = previewing();
        view.el.querySelector('.cal-dialog-header').after(setup);
        setup.addEventListener('click', () => {
          view.close();
          if (!view.el.isConnected) openPhoneReminders();
        });
      }
    }
    const feed = view.el.querySelector('.cal-announcement-feed'), form = view.el.querySelector('form');
    const textarea = form.elements.message, messageStatus = view.el.querySelector('[role=status]');
    const older = view.el.querySelector('[data-cal-older-announcements]'), retry = view.el.querySelector('[data-cal-announcement-retry]');
    const newButton = view.el.querySelector('[data-cal-new-announcements]');
    const current = () => matches(id) && active?.view === view && view.el.isConnected;
    const editDirty = () => editing && (editing.field.value !== editing.original || editing.dateField && editing.dateField.value !== editing.originalDate);
    function cleanup() { observer?.disconnect(); clearTimeout(pendingTimer); }
    function notice(text, error = false, source = '') {
      messageStatus.textContent = text; messageStatus.classList.toggle('cal-error', error); messageStatus.dataset.source = source;
    }
    function card(message) {
      const at = calendarAnnouncementDate(message);
      return `<article class="cal-announcement-message${message.read ? '' : ' is-unread'}" data-announcement-id="${escAttr(message.id)}"><header><strong>Shul</strong><time datetime="${escAttr(at)}">${escText(whenDate(at))}</time><span class="cal-announcement-new" ${message.read ? 'hidden' : ''}>New</span></header><p dir="auto">${escText(message.text)}</p><div class="cal-announcement-actions"><button type="button" data-cal-edit-announcement="${escAttr(message.id)}" aria-label="${escAttr('Edit announcement from ' + whenDate(at))}" ${canEdit ? '' : 'hidden'}>Edit</button><button type="button" class="cal-announcement-delete" data-cal-delete-announcement="${escAttr(message.id)}" aria-label="${escAttr('Delete announcement from ' + whenDate(at))}" ${canDelete ? '' : 'hidden'}>Delete</button></div><span class="cal-announcement-end" data-cal-announcement-end="${escAttr(message.id)}" aria-hidden="true"></span></article>`;
    }
    const messageNode = key => [...feed.querySelectorAll('[data-announcement-id]')].find(node => node.dataset.announcementId === key);
    function paintMessage(message) {
      const node = messageNode(message.id); if (!node) return;
      node.querySelector(':scope > p').textContent = message.text;
      const at = calendarAnnouncementDate(message), time = node.querySelector('header time'); time.dateTime = at; time.textContent = whenDate(at);
      node.querySelector('[data-cal-edit-announcement]').setAttribute('aria-label', 'Edit announcement from ' + whenDate(at));
      node.querySelector('[data-cal-delete-announcement]').setAttribute('aria-label', 'Delete announcement from ' + whenDate(at));
    }
    function sortMessages() {
      if (editing) return;
      const focused = document.activeElement; let previous = null;
      for (const message of [...messages.values()].sort(calendarAnnouncementOrder)) {
        const node = messageNode(message.id), before = previous ? previous.nextElementSibling : feed.firstElementChild;
        if (node && node !== before) feed.insertBefore(node, before);
        previous = node;
      }
      if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
    function expire() {
      if (!historySince) return;
      const ids = [...messages.values()].filter(message => calendarAnnouncementDate(message) < historySince).map(message => message.id);
      if (ids.length) removeDeleted(ids, false);
      if (nextCursor && nextCursor < historySince) { nextCursor = nextBefore = null; older.hidden = true; }
    }
    function applyEdits(values) {
      const scrollTop = feed.scrollTop;
      for (const value of values) {
        const old = messages.get(value.id);
        if (deletedIds.has(value.id) || old && (value.revision || 1) <= (old.revision || 1)) continue;
        if (historySince && calendarAnnouncementDate(value) < historySince) { removeDeleted([value.id], false); continue; }
        const next = { ...old, ...value, read: old?.read ?? value.read ?? false }; messages.set(value.id, next);
        if (!old) { feed.querySelector('.cal-empty')?.remove(); feed.insertAdjacentHTML('beforeend', card(next)); }
        else if (editing?.id !== value.id) paintMessage(next);
      }
      sortMessages(); feed.scrollTop = scrollTop; observe();
    }
    async function syncEdits() {
      if (!current() || knownEditCount >= editCount) return;
      if (syncingEdits) return syncingEdits;
      syncingEdits = (async () => {
        try {
          do {
            const value = await request('/api/announcements/updates?after=' + knownEditCount); if (!current()) return;
            removeDeleted(value.hiddenIds || [], false); applyEdits(value.messages); editCount = Math.max(editCount, value.editCount);
            knownEditCount = value.nextAfter ?? value.editCount;
            if (value.nextAfter === null) break;
          } while (current() && knownEditCount < editCount);
          if (messageStatus.dataset.source === 'edits') { notice(''); retry.hidden = true; }
        } catch (error) { if (current() && !failed(error, id)) { notice('Edited announcements could not be loaded. Use Try again to retry.', true, 'edits'); retry.hidden = false; } }
      })();
      try { await syncingEdits; } finally { syncingEdits = null; }
    }
    function closeEditor() {
      if (!editing) return;
      const key = editing.id; messageNode(key)?.querySelector('.cal-announcement-edit-form')?.remove(); editing = null;
      if (messages.has(key)) paintMessage(messages.get(key));
      sortMessages();
      messageNode(key)?.querySelector('[data-cal-edit-announcement]')?.focus({ preventScroll: true });
    }
    function editMessage(key) {
      if (previewing() || !canEdit || posting || deleting || editing?.saving) return;
      if (editing?.id === key) { editing.field.focus(); return; }
      if (editDirty() && !confirm('Discard your unsaved announcement changes?')) return;
      closeEditor(); const message = messages.get(key), node = messageNode(key); if (!message || !node) return;
      const originalAt = calendarAnnouncementDate(message), originalDate = calendarAnnouncementLocalTime(originalAt, timeZone);
      node.insertAdjacentHTML('beforeend', `<form class="cal-form cal-announcement-edit-form"><label>Edit announcement<textarea name="text" rows="4" maxlength="${message.authorId === 'shul-sms-import' ? 16000 : 4000}" required>${escText(message.text)}</textarea></label>${dateEditing ? `<label>Added date and time<input type="datetime-local" name="addedAt" step="60" value="${escAttr(originalDate)}" required></label><p class="cal-form-note">${escText(timeZone.replaceAll('_', ' '))} time. Changing this moves the message in the list.</p>` : ''}<p class="cal-error" role="status"></p><div class="cal-form-actions"><button class="cal-primary" type="submit">Save changes</button><button type="button" data-cal-cancel-edit>Cancel</button></div></form>`);
      const editor = node.querySelector('.cal-announcement-edit-form'), field = editor.elements.text, error = editor.querySelector('[role=status]');
      const dateField = editor.elements.addedAt;
      const state = editing = { id: key, original: message.text, originalDate, dateField, revision: message.revision || 1, field, saving: false, operation: null };
      editor.querySelector('[data-cal-cancel-edit]').addEventListener('click', () => { if (!state.saving) closeEditor(); });
      editor.addEventListener('submit', async event => {
        event.preventDefault(); if (state.saving || !current()) return;
        try {
          const text = calendarAnnouncementText(field.value, message.authorId === 'shul-sms-import' ? 16000 : 4000);
          const addedAt = dateField ? calendarAnnouncementInstant(dateField.value, timeZone, originalAt) : undefined;
          if (!state.operation || state.operation.text !== text || state.operation.addedAt !== addedAt) state.operation = { operationId: crypto.randomUUID(), text, revision: state.revision, ...(addedAt ? { addedAt } : {}) };
          state.saving = true; field.disabled = true; editor.querySelectorAll('input,button').forEach(button => { button.disabled = true; }); error.textContent = 'Saving…';
          const value = await request('/api/announcements/' + encodeURIComponent(key), { method: 'PUT', body: state.operation });
          if (!current()) return;
          state.saving = false; closeEditor(); applyEdits([value.message]); status(value); notice('Announcement updated.'); await syncEdits();
        } catch (issue) { if (current() && !failed(issue, id)) { error.textContent = issue.message + ' Your changes are kept.'; if (issue.status === 409) await refresh(); else await syncEdits(); } }
        finally { state.saving = false; if (editor.isConnected) { field.disabled = false; editor.querySelectorAll('input,button').forEach(button => { button.disabled = false; }); } }
      });
      field.focus(); field.scrollIntoView({ block: 'nearest' });
    }
    function removeDeleted(ids, permanent = true) {
      const scrollTop = feed.scrollTop;
      for (const key of ids) {
        if (editing?.id === key) closeEditor();
        if (permanent) deletedIds.add(key); pending.delete(key); messages.delete(key);
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
          const value = await request('/api/announcements/deleted'); if (!current()) return;
          removeDeleted(value.ids); knownDeletedCount = Math.max(knownDeletedCount, value.deletedCount);
          deletedCount = Math.max(deletedCount, value.deletedCount);
          if (messageStatus.dataset.source === 'deletions') { notice(''); retry.hidden = true; }
        } catch (error) { if (current() && !failed(error, id)) { notice('Announcement updates could not be loaded. Use Try again to retry.', true, 'deletions'); retry.hidden = false; } }
      })();
      try { await syncing; } finally { syncing = null; }
    }
    async function markRead() {
      if (previewing() || !current() || reading || !pending.size || document.visibilityState !== 'visible') return;
      reading = true; let saved = false;
      const ids = [...pending].slice(0, 100); ids.forEach(value => pending.delete(value));
      try {
        const value = await request('/api/announcements/read', { method: 'POST', body: { ids } });
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
      if (previewing() || !current() || document.visibilityState !== 'visible') return;
      for (const node of feed.querySelectorAll('[data-cal-announcement-end]')) {
        if (!messages.get(node.dataset.calAnnouncementEnd)?.read) observer.observe(node);
      }
    }
    observer = new IntersectionObserver(entries => {
      if (previewing() || !current() || document.visibilityState !== 'visible') return;
      for (const entry of entries) if (entry.isIntersecting) {
        pending.add(entry.target.dataset.calAnnouncementEnd); observer.unobserve(entry.target);
      }
      clearTimeout(pendingTimer); pendingTimer = setTimeout(markRead, 250);
    }, { threshold: 1 });
    active = { view, latest: 0, form, feed, newButton, expire, observe, cleanup, syncDeleted, syncEdits }; paint();
    async function load(append = false) {
      if (!current() || loading) return;
      if (!append && editing) {
        if (editing.saving || editDirty() && !confirm('Discard your unsaved announcement changes?')) return;
        closeEditor();
      }
      loading = true; older.disabled = retry.disabled = newButton.disabled = true;
      try {
        const value = !previewing() && !openingRecorded && !append
          ? await request('/api/announcements/open', { method: 'POST', body: { id: openingId } })
          : await request('/api/announcements' + (append && nextCursor ? '?cursor=' + encodeURIComponent(nextCursor) : append && nextBefore ? '?before=' + nextBefore : ''));
        if (!current()) return;
        openingRecorded = true;
        if (messageStatus.dataset.source === 'load') notice('');
        const previous = new Map(messages);
        if (!append) { messages.clear(); feed.innerHTML = ''; feed.scrollTop = 0; }
        else if (!messages.size) feed.innerHTML = '';
        for (const item of value.messages) if (!messages.has(item.id) && !deletedIds.has(item.id)) {
          const old = previous.get(item.id), next = old && (old.revision || 1) > (item.revision || 1) ? old : item;
          messages.set(item.id, next); feed.insertAdjacentHTML('beforeend', card(next));
        }
        if (!messages.size) feed.innerHTML = '<p class="cal-empty">No announcements yet.</p>';
        if (!append) { active.latest = Math.max(active.latest, value.total); knownEditCount = value.editCount || 0; }
        else knownEditCount = Math.min(knownEditCount, value.editCount || 0);
        nextBefore = value.nextBefore; nextCursor = value.nextCursor || null; older.hidden = !nextCursor && !nextBefore; retry.hidden = true; status(value); sortMessages(); await syncDeleted(); await syncEdits(); observe();
      } catch (error) {
        if (current() && !failed(error, id)) {
          notice(error.message, true, 'load'); retry.hidden = false;
          if (!messages.size) feed.innerHTML = '<p class="cal-empty">Announcements could not be loaded.</p>';
        }
      } finally { loading = false; if (current()) older.disabled = retry.disabled = newButton.disabled = false; }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (previewing() || posting || deleting || editing?.saving) return;
      let text, addedAt; try { text = calendarAnnouncementText(textarea.value); if (dateEditing && form.elements.addedAt.value) addedAt = calendarAnnouncementInstant(form.elements.addedAt.value, timeZone); } catch (error) { notice(error.message, true, 'post'); return; }
      if (!operation || operation.text !== text || operation.addedAt !== addedAt) operation = { id: crypto.randomUUID(), text, ...(addedAt ? { addedAt } : {}) };
      posting = true; textarea.disabled = true; form.elements.addedAt.disabled = true; form.querySelector('button').disabled = true; notice('Posting…');
      try {
        const value = await request('/api/announcements', { method: 'POST', body: operation });
        if (!current()) return;
        status(value); textarea.value = ''; form.elements.addedAt.value = ''; operation = null; notice('Announcement posted.'); await load();
      } catch (error) { if (current() && !failed(error, id)) notice(error.message + ' Your text is kept; try posting again.', true, 'post'); }
      finally { posting = false; if (current()) { textarea.disabled = false; form.elements.addedAt.disabled = !dateEditing; form.querySelector('button').disabled = false; } }
    });
    feed.addEventListener('click', async event => {
      const edit = event.target.closest('[data-cal-edit-announcement]'); if (edit) { editMessage(edit.dataset.calEditAnnouncement); return; }
      const control = event.target.closest('[data-cal-delete-announcement]');
      if (previewing() || !control || !canDelete || posting || deleting || editing?.saving || !current() || !confirm('Delete this announcement for everyone?')) return;
      const messageId = control.dataset.calDeleteAnnouncement;
      deleting = true; control.disabled = true; form.querySelector('button').disabled = true; notice('Deleting…');
      try {
        const value = await request('/api/announcements/' + encodeURIComponent(messageId), { method: 'DELETE' });
        if (!current()) return;
        status(value); removeDeleted([messageId]); notice('Announcement deleted.'); await syncDeleted();
      } catch (error) { if (current() && !failed(error, id)) notice(error.message + ' Try Delete again to retry.', true, 'delete'); }
      finally { deleting = false; if (current()) { control.disabled = false; form.querySelector('button').disabled = false; } }
    });
    older.addEventListener('click', () => load(true));
    newButton.addEventListener('click', () => load());
    retry.addEventListener('click', () => { markRead(); syncDeleted(); syncEdits(); load(); });
    await load();
  }
  return { start, stop, bind, markup, open, refresh, dispose: stop };
}
