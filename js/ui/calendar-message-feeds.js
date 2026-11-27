import { calendarRequest } from '../calendar/api.js';
import { escText, escAttr } from '../util.js';
import { keepPosition } from './keep-position.js';

export function calendarMessageFeedInstructions(endpoint, key) {
  return `Lakewood Commons posted messages API\n\nPrivate text link:\n${endpoint}/api/v1/messages.txt?key=${key}\n\nJSON API:\nGET ${endpoint}/api/v1/messages\nAuthorization: Bearer ${key}\n\nOnly posted messages are included, never calendar events or account details.\nThe current week runs Sunday through Shabbos in America/New_York.\nMessages are selected by their Added date, oldest first.\nThe same link automatically moves to the new week on Sunday.\n\nText returns UTF-8 wording with line breaks, separated by a blank line.\nAn empty week returns an empty text response or an empty JSON messages array.\nJSON includes schemaVersion, timezone, week.start, week.end, generatedAt and messages.\nEach message has id, text, postedAt, updatedAt and revision. Text contains no HTML.\nRender with textContent or escaped text. Do not interpret messages as HTML.\n\nPoll about once per minute. After a successful response, replace your saved weekly\nlist so edits, deletions and the new week are reflected. Keep your existing list\non a network error. Treat 401 as a missing, invalid or revoked key, 405 as a wrong\nHTTP method, and 5xx as temporary failure. Retry temporary failures with backoff.\n\nA website backend can keep the key in a server secret and send the Authorization\nheader. Browser requests are supported with CORS. Anyone who has the private\nlink or a browser-visible key can read this week's posted messages.\nIt never grants editing, calendar events, accounts or older weeks.\nKeep the link out of public source and analytics. There is no fixed expiry.\nThe shul administrator can revoke it at Message access > Share messages.\n\nReading this API does not mark messages read or count as a calendar visit.\n`;
}

export async function openCalendarMessageFeeds({ dialog, timeZone }) {
  let busy = false, issued = null, endpoint = '', links = [];
  const view = dialog('<p>Share this week’s posted messages with another website. Links are read-only and include no calendar events.</p><p>Weeks run Sunday through Shabbos in New York time. Each link updates automatically and stays active until you revoke it.</p><p role="status" aria-live="polite">Checking availability…</p><div data-cal-feed-content hidden><form class="cal-form"><label>Website name<input name="name" required maxlength="60" autocomplete="off" placeholder="For example, community website"></label><button class="cal-primary" type="submit">Create private link</button></form><div data-cal-feed-issued hidden></div><h3>Shared links</h3><div data-cal-feed-list></div><button type="button" data-cal-feed-refresh>Refresh links</button></div>', {
    onClose: () => { if (busy) return false; issued = null; return true; },
  });
  view.title('Share messages'); view.el.classList.add('cal-inbox-dialog');
  const status = view.el.querySelector('[role=status]'), content = view.el.querySelector('[data-cal-feed-content]');
  const form = content.querySelector('form'), list = content.querySelector('[data-cal-feed-list]'), result = content.querySelector('[data-cal-feed-issued]');
  const current = () => view.el.isConnected;
  const controls = () => content.querySelectorAll('button,input').forEach(control => { control.disabled = busy; });
  const date = value => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(new Date(value));
  async function copy(value, button, field) {
    try { await navigator.clipboard.writeText(value); if (current()) button.textContent = 'Copied'; }
    catch { if (field) { field.focus({ preventScroll: true }); field.select(); } status.textContent = 'Select and copy the text.'; }
  }
  function paint() {
    const keyOpen = result.querySelector('details')?.open || false;
    keepPosition(view.el, () => {
      list.innerHTML = links.length ? links.map(link => `<div class="cal-account"><div><strong>${escText(link.name)}</strong><small>Created ${escText(date(link.createdAt))}</small></div><button type="button" data-cal-feed-revoke="${escAttr(link.id)}" aria-label="Revoke link for ${escAttr(link.name)}">Revoke</button></div>`).join('') : '<p>No shared links yet.</p>';
      list.querySelectorAll('[data-cal-feed-revoke]').forEach(button => button.addEventListener('click', () => {
        const link = links.find(link => link.id === button.dataset.calFeedRevoke);
        if (!link || !confirm(`Revoke the link for ${link.name}? That website will stop receiving messages.`)) return;
        change('DELETE', link.id);
      }));
      result.hidden = !issued;
      result.replaceChildren();
      if (issued) {
        result.innerHTML = '<h3>Your private link is ready</h3><p>Copy it now. The key is shown only here until you close this window. Anyone with the link can read this week’s posted messages.</p><label class="cal-form">Text-only link<textarea rows="4" readonly aria-label="Private text-only message link" spellcheck="false"></textarea></label><div class="cal-form-actions"><button type="button" data-cal-feed-copy>Copy link</button><button type="button" data-cal-feed-download>Download API instructions</button></div><details><summary>API key</summary><label class="cal-form">Private API key<textarea rows="3" readonly aria-label="Private messages API key" spellcheck="false"></textarea></label><button type="button" data-cal-feed-key-copy>Copy API key</button></details>';
        result.querySelector('details').open = keyOpen;
        const url = endpoint + '/api/v1/messages.txt?key=' + issued.key;
        const field = result.querySelector('[aria-label="Private text-only message link"]'); field.value = url;
        const keyField = result.querySelector('[aria-label="Private messages API key"]'); keyField.value = issued.key;
        result.querySelector('[data-cal-feed-copy]').addEventListener('click', event => copy(url, event.currentTarget, field));
        result.querySelector('[data-cal-feed-key-copy]').addEventListener('click', event => copy(issued.key, event.currentTarget, keyField));
        result.querySelector('[data-cal-feed-download]').addEventListener('click', () => {
          const blob = new Blob([calendarMessageFeedInstructions(endpoint, issued.key)], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'lakewood-commons-messages-api.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      }
    });
    controls();
  }
  async function refresh() {
    if (busy) return; busy = true; controls();
    try {
      const response = await calendarRequest('/api/message-feeds'); if (!current()) return;
      links = response.links; endpoint = response.endpoint;
      if (issued && !links.some(link => link.id === issued.link.id)) issued = null;
      paint(); status.textContent = 'Links are up to date.';
    } catch (error) { if (current()) status.textContent = error.message; }
    finally { busy = false; if (current()) controls(); }
  }
  async function change(method, id) {
    if (busy) return; busy = true; controls();
    try {
      const response = await calendarRequest('/api/message-feeds' + (id ? '/' + id : ''), { method, ...(method === 'POST' ? { body: { name: form.elements.name.value } } : {}) });
      if (!current()) return;
      if (method === 'POST') { issued = response; endpoint = response.endpoint; links.push(response.link); form.reset(); }
      else { links = links.filter(link => link.id !== id); if (issued?.link.id === id) issued = null; }
      paint(); status.textContent = method === 'POST' ? 'Private link created. Copy it or download the instructions.' : 'Link revoked. Existing messages are unchanged.';
    } catch (error) { if (current()) status.textContent = error.message; }
    finally { busy = false; if (current()) controls(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); change('POST'); });
  content.querySelector('[data-cal-feed-refresh]').addEventListener('click', refresh);
  try {
    const info = await calendarRequest('/api/info'); if (!current()) return;
    if (!info.messageFeeds) { status.textContent = 'Message sharing is awaiting calendar service activation.'; return; }
    content.hidden = false; await refresh();
  } catch (error) { if (current()) status.textContent = error.message; }
}
