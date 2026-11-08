import { calendarRequest } from '../calendar/api.js';
import { escText, escAttr } from '../util.js';
import { keepPosition } from './keep-position.js';

export async function openCalendarEmailImport({ dialog, timeZone }) {
  let script = '', connection = null, saving = false, includeExisting = true;
  const drafts = new Map();
  const view = dialog('<p>Import LC Text messages into calendar notifications.</p><p role="status" aria-live="polite">Checking connection…</p><div data-cal-inbox-content></div>', {
    onClose: () => { if (saving || [...drafts.values()].some(text => text.trim()) && !confirm('Discard your unsaved notification wording?')) return false; script = ''; drafts.clear(); return true; },
  });
  view.title('LC Text connection'); view.el.classList.add('cal-inbox-dialog');
  const status = view.el.querySelector('[role=status]'), content = view.el.querySelector('[data-cal-inbox-content]');
  const current = () => view.el.isConnected;
  const date = value => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)) : 'Not yet';
  const connectionLabel = () => !connection.enabled ? 'Not connected' : !connection.lastCheckedAt ? 'Waiting for Google setup' : Date.now() - Date.parse(connection.lastCheckedAt) >= 20 * 60000 ? 'No recent check' : connection.catchingUp ? 'Importing earlier messages' : 'Connected';
  const paint = () => keepPosition(view.el, draw);
  function draw() {
    content.innerHTML = `<div class="cal-inbox-summary"><strong>${connectionLabel()}</strong><span>ads@neileich.org</span><span>Lc Text (848) 356-4187</span><dl><div><dt>Last checked</dt><dd data-cal-inbox-checked>${escText(date(connection.lastCheckedAt))}</dd></div><div><dt>Notifications imported</dt><dd data-cal-inbox-imported>${connection.importedCount || 0}</dd></div></dl><button type="button" data-cal-inbox-refresh>Refresh connection</button></div>
      <details class="cal-extra"><summary>How this connection works</summary><p>Google checks this mailbox every five minutes for the exact LC Text sender and subject. Only the message wording is posted, with its original date. Your other emails and the Comments newsletter connection stay unchanged. Messages that cannot be extracted safely wait here for your review.</p><p>Earlier messages become unread calendar notifications. Deleted or edited notifications are never replaced by an import retry.</p></details>
      <form class="cal-form cal-inbox-setup"><label class="cal-checkbox"><input type="checkbox" name="includeExisting" ${includeExisting ? 'checked' : ''}>Include existing LC Text messages</label><button class="cal-primary" type="submit">${connection.enabled ? 'Create replacement script' : 'Create connection script'}</button></form>
      <div data-cal-inbox-script ${script ? '' : 'hidden'}><h3>Finish in Google</h3><ol><li>Open a <a href="https://script.google.com/home/start" target="_blank" rel="noopener noreferrer">new Google Apps Script project</a> as ads@neileich.org.</li><li>Copy this script into the new project’s Code.gs file and save it.</li><li>Run <strong>setupLcTextCalendar</strong> and approve Google access.</li></ol><div class="cal-form-actions"><button type="button" data-cal-inbox-copy>Copy script</button><button type="button" data-cal-inbox-download>Download script</button></div><details class="cal-extra"><summary>Show private script</summary><textarea readonly rows="8" aria-label="Private Google connection script"></textarea></details><p class="cal-form-note">Keep the script private. Creating another script replaces this connection key. Use a separate project from Commons Comments.</p></div>
      <details class="cal-extra" data-cal-inbox-review><summary>Messages needing review (${connection.reviewCount || 0})</summary><div data-cal-inbox-review-list></div></details>
      ${connection.enabled ? '<button type="button" data-cal-inbox-disable>Disconnect LC Text</button>' : ''}`;
    if (script) content.querySelector('[aria-label="Private Google connection script"]').value = script;
    content.querySelector('[name=includeExisting]').addEventListener('change', event => { includeExisting = event.target.checked; });
    content.querySelector('[data-cal-inbox-refresh]').addEventListener('click', () => refresh().catch(error => { if (current()) status.textContent = error.message; }));
    content.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      if (connection.enabled && !confirm('Replace this connection script? The previous script will stop working.')) return;
      includeExisting = event.currentTarget.elements.includeExisting.checked;
      await change(async () => {
        const result = await calendarRequest('/api/email-import', { method: 'POST', body: { revision: connection.revision, includeExisting } });
        connection = result.connection; script = result.script; paint(); status.textContent = 'Script ready. Finish the three Google steps below, then refresh the connection.';
      });
    });
    content.querySelector('[data-cal-inbox-disable]')?.addEventListener('click', async () => {
      if (!confirm('Stop importing LC Text messages? Existing notifications will stay.')) return;
      await change(async () => {
        const result = await calendarRequest('/api/email-import', { method: 'DELETE', body: { revision: connection.revision } });
        connection = result.connection; script = ''; paint(); status.textContent = 'LC Text disconnected.';
      });
    });
    content.querySelector('[data-cal-inbox-copy]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(script); status.textContent = 'Script copied.'; }
      catch { const details = content.querySelector('[aria-label="Private Google connection script"]').closest('details'); details.open = true; const field = details.querySelector('textarea'); field.focus(); field.select(); status.textContent = 'Select and copy the private script, or use Download script.'; }
    });
    content.querySelector('[data-cal-inbox-download]')?.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([script], { type: 'text/plain' })), link = document.createElement('a');
      link.href = url; link.download = 'Lakewood-Commons-LC-Text-Code.gs'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Private script downloaded. Finish setup in the new Google project.';
    });
    const review = content.querySelector('[data-cal-inbox-review]');
    review.addEventListener('toggle', () => { if (review.open && !review.dataset.loaded) { review.dataset.loaded = '1'; loadReview(); } });
  }
  async function change(action) {
    if (saving) return;
    saving = true; content.querySelectorAll('button').forEach(button => { button.disabled = true; }); status.textContent = 'Saving…';
    try { await action(); }
    catch (error) { if (current()) status.textContent = error.message; }
    finally { saving = false; if (current()) content.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  async function refresh() {
    if (saving) return;
    const result = await calendarRequest('/api/email-import'); if (!current()) return;
    const previous = connection; connection = result.connection;
    if (previous && previous.enabled === connection.enabled && previous.revision === connection.revision) {
      content.querySelector('.cal-inbox-summary > strong').textContent = connectionLabel();
      content.querySelector('[data-cal-inbox-checked]').textContent = date(connection.lastCheckedAt);
      content.querySelector('[data-cal-inbox-imported]').textContent = connection.importedCount || 0;
      content.querySelector('[data-cal-inbox-review] > summary').textContent = 'Messages needing review (' + (connection.reviewCount || 0) + ')';
      if (previous.reviewCount !== connection.reviewCount && content.querySelector('[data-cal-inbox-review]').open) await loadReview();
    } else { if (previous) script = ''; paint(); }
    status.textContent = connection.lastCheckedAt ? 'Connection status refreshed.' : 'Finish Google setup to start importing.';
  }
  async function loadReview(after = '', append = false) {
    const list = content.querySelector('[data-cal-inbox-review-list]'); if (!list) return;
    try {
      const result = await calendarRequest('/api/email-import/review' + (after ? '?after=' + after : '')); if (!current() || !list.isConnected) return;
      keepPosition(view.el, () => {
      if (!append) list.innerHTML = '';
      for (const message of result.messages) {
        const card = document.createElement('section'); card.className = 'cal-inbox-review-card'; card.dataset.calInboxReviewId = card.dataset.id = message.digest;
        card.innerHTML = `<strong>${escText(date(message.receivedAt))}</strong><p>${escText(message.reason)}</p><details class="cal-extra"><summary>Original email</summary><pre dir="auto">${escText(message.text)}</pre><a href="https://mail.google.com/mail/u/${encodeURIComponent('ads@neileich.org')}/#all/${escAttr(message.sourceId)}" target="_blank" rel="noopener noreferrer">Open in Gmail</a></details><form class="cal-form"><label>Notification wording<textarea name="text" rows="4" maxlength="4000" required></textarea></label><div class="cal-form-actions"><button type="submit" class="cal-primary">Post notification</button><button type="button" data-cal-inbox-skip>Skip email</button></div></form>`;
        async function resolve(action, text) {
          await change(async () => {
            const result = await calendarRequest('/api/email-import/review/' + message.digest, { method: 'POST', body: { action, ...(text ? { text } : {}) } });
            if (!current()) return;
            keepPosition(view.el, () => {
              card.remove(); drafts.delete(message.digest); connection.reviewCount = Math.max(0, connection.reviewCount - 1);
              content.querySelector('[data-cal-inbox-review] > summary').textContent = 'Messages needing review (' + connection.reviewCount + ')';
              if (result.posted) { connection.importedCount = (connection.importedCount || 0) + 1; content.querySelector('[data-cal-inbox-imported]').textContent = connection.importedCount; }
            });
            status.textContent = result.resolved ? 'This email was already handled in another session.' : action === 'post' ? 'Notification posted.' : 'Email skipped.';
          });
        }
        card.querySelector('form').addEventListener('submit', event => { event.preventDefault(); resolve('post', event.currentTarget.elements.text.value); });
        const field = card.querySelector('textarea'); field.value = drafts.get(message.digest) || '';
        field.addEventListener('input', () => drafts.set(message.digest, field.value));
        card.querySelector('[data-cal-inbox-skip]').addEventListener('click', () => { if (confirm('Skip this email without adding a notification?')) resolve('skip'); });
        list.append(card);
      }
      list.querySelector('[data-cal-inbox-more]')?.remove();
      if (result.nextAfter) {
        const more = document.createElement('button'); more.type = 'button'; more.dataset.calInboxMore = ''; more.textContent = 'Load more'; more.addEventListener('click', () => loadReview(result.nextAfter, true)); list.append(more);
      } else if (!list.children.length) list.textContent = 'No messages waiting for review.';
      });
    } catch (error) { if (current()) { status.textContent = error.message; content.querySelector('[data-cal-inbox-review]').dataset.loaded = ''; } }
  }
  try {
    const info = await calendarRequest('/api/info'); if (!current()) return;
    if (!info.emailImport) { status.textContent = 'The email connection is awaiting activation. Your existing calendar is ready to use.'; return; }
    await refresh();
  } catch (error) { if (current()) status.textContent = error.message; }
}
