import { calendarRequest } from '../calendar/api.js';
import { escText } from '../util.js';
import { keepPosition } from './keep-position.js';

export async function openCalendarSmsImport({ dialog, timeZone }) {
  let connection, key = '', saving = false;
  const view = dialog('<p>Post incoming Shul SMS messages to the existing Announcements feed.</p><p role="status" aria-live="polite">Checking connection…</p><div data-cal-sms-content></div>', {
    onClose: () => { if (saving) return false; key = ''; return true; },
  });
  view.title('Shul SMS connection'); view.el.classList.add('cal-inbox-dialog');
  const status = view.el.querySelector('[role=status]'), content = view.el.querySelector('[data-cal-sms-content]');
  const current = () => view.el.isConnected;
  const date = value => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)) : 'Not yet';
  function paint() {
    keepPosition(view.el, () => {
      content.innerHTML = `<div class="cal-inbox-summary"><strong>${!connection.enabled ? 'Not connected' : connection.lastCheckedAt ? 'Connected' : 'Waiting for Shul SMS setup'}</strong><dl><div><dt>Last checked</dt><dd>${escText(date(connection.lastCheckedAt))}</dd></div><div><dt>SMS announcements imported</dt><dd>${connection.importedCount || 0}</dd></div></dl></div>
        <p>Each new SMS from your allowed sender becomes an announcement with its original wording. English, Hebrew, quotes and line breaks are kept. Duplicate retries never replace an edited or deleted post.</p>
        <div class="cal-form-actions"><button type="button" class="cal-primary" data-cal-sms-create>${connection.enabled ? 'Replace connection key' : 'Create connection key'}</button><button type="button" data-cal-sms-refresh>Refresh connection</button></div>
        <div data-cal-sms-key ${key ? '' : 'hidden'}><h3>Finish in Shul SMS</h3><ol><li>Copy the private key below.</li><li>Open <a href="https://shul-signs-inbox.cheskyshain.chatgpt.site" target="_blank" rel="noopener noreferrer">Shul SMS</a>, then choose Announcements.</li><li>Paste the key and choose Connect announcements.</li></ol><label class="cal-form">Private connection key<textarea readonly rows="3" aria-label="Private SMS connection key" autocomplete="off" spellcheck="false"></textarea></label><button type="button" data-cal-sms-copy>Copy private key</button><p class="cal-form-note">The key is shown only in this session. Keep it private. Replacing it disables the previous key. Your calendar password is never shared with Tasker.</p></div>
        ${connection.enabled ? '<button type="button" data-cal-sms-disable>Disconnect Shul SMS</button>' : ''}`;
      if (key) content.querySelector('[aria-label="Private SMS connection key"]').value = key;
      content.querySelector('[data-cal-sms-refresh]').addEventListener('click', refresh);
      content.querySelector('[data-cal-sms-create]').addEventListener('click', () => {
        if (connection.enabled && !confirm('Replace the SMS connection key? The previous key will stop working.')) return;
        change('POST');
      });
      content.querySelector('[data-cal-sms-disable]')?.addEventListener('click', () => {
        if (confirm('Stop importing SMS announcements? Existing posts will stay.')) change('DELETE');
      });
      content.querySelector('[data-cal-sms-copy]')?.addEventListener('click', async event => {
        try { await navigator.clipboard.writeText(key); event.target.textContent = 'Copied'; }
        catch { const field = content.querySelector('textarea'); field.focus(); field.select(); status.textContent = 'Select and copy the private key.'; }
      });
    });
  }
  async function refresh() {
    if (saving) return;
    try { const result = await calendarRequest('/api/sms-import'); if (!current()) return; if (connection && result.connection.revision !== connection.revision) key = ''; connection = result.connection; paint(); status.textContent = connection.lastCheckedAt ? 'Connection status refreshed.' : 'Finish setup in Shul SMS to start posting.'; }
    catch (error) { if (current()) status.textContent = error.message; }
  }
  async function change(method) {
    if (saving) return; saving = true; content.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const result = await calendarRequest('/api/sms-import', { method, body: { revision: connection.revision } });
      if (!current()) return; connection = result.connection; key = result.key || ''; paint(); status.textContent = key ? 'Private key ready. Finish setup in Shul SMS.' : 'Shul SMS disconnected.';
    } catch (error) { if (current()) status.textContent = error.message; }
    finally { saving = false; if (current()) content.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  try { const info = await calendarRequest('/api/info'); if (!current()) return; if (!info.smsImport) { status.textContent = 'The SMS connection is awaiting calendar service activation.'; return; } await refresh(); }
  catch (error) { if (current()) status.textContent = error.message; }
}
