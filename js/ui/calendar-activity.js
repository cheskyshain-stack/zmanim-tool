import { calendarRequest } from '../calendar/api.js';
import { escText, escAttr } from '../util.js';

export async function openCalendarActivity({ dialog, timeZone }) {
  const view = dialog('<p>Successful sign-ins recorded since tracking was enabled. Earlier sign-ins were not recorded.</p><div data-cal-activity-accounts>Loading sign-in history…</div><p class="cal-error" role="status"></p><button type="button" data-cal-activity-retry hidden>Try again</button>');
  view.title('Sign-in history');
  const content = view.el.querySelector('[data-cal-activity-accounts]'), status = view.el.querySelector('[role=status]');
  const retry = view.el.querySelector('[data-cal-activity-retry]');
  const when = value => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
  async function load() {
    retry.disabled = true;
    try {
      const value = await calendarRequest('/api/access/activity'); if (!view.el.isConnected) return;
      content.innerHTML = value.users.map(account => `<article class="cal-activity-account"><header><strong dir="auto">${escText(account.name)}</strong><span>${account.active ? account.pending ? 'Invitation pending' : account.role === 'owner' ? 'Owner' : account.role === 'editor' ? 'Calendar editor' : 'Viewer' : 'Access removed'}</span></header><p>${escText(account.email)}</p><p><strong>${account.signInCount}</strong> recorded sign-ins${account.lastSignInAt ? ` · Last: ${escText(when(account.lastSignInAt))}` : ''}</p>${account.signInCount ? `<button type="button" data-cal-account-history="${escAttr(account.id)}">View sign-ins for ${escText(account.name)}</button><div data-cal-account-signins hidden><ol></ol><button type="button" data-cal-signins-more hidden>Load older sign-ins</button><p class="cal-error" role="status"></p></div>` : ''}</article>`).join('');
      status.textContent = ''; retry.hidden = true;
      content.querySelectorAll('[data-cal-account-history]').forEach(button => {
        const details = button.nextElementSibling, list = details.querySelector('ol'), more = details.querySelector('button'), error = details.querySelector('[role=status]');
        let loaded = false, before = null, busy = false;
        async function entries() {
          if (busy) return; busy = true; button.disabled = more.disabled = true;
          try {
            const result = await calendarRequest('/api/access/activity/' + encodeURIComponent(button.dataset.calAccountHistory) + (before ? '?before=' + before : ''));
            if (!details.isConnected) return;
            list.insertAdjacentHTML('beforeend', result.entries.map(entry => `<li><time datetime="${escAttr(entry.at)}">${escText(when(entry.at))}</time> · ${entry.type === 'account-created' ? 'Account created' : entry.type === 'invitation-claimed' ? 'Invitation accepted' : 'Signed in'}</li>`).join(''));
            before = result.nextBefore; more.hidden = !before; loaded = true; error.textContent = '';
          } catch (issue) { if (details.isConnected) error.textContent = issue.message; }
          finally { busy = false; if (details.isConnected) button.disabled = more.disabled = false; }
        }
        button.addEventListener('click', () => { details.hidden = loaded && !details.hidden; if (!loaded) entries(); });
        more.addEventListener('click', entries);
      });
    } catch (error) { if (view.el.isConnected) { status.textContent = error.message; retry.hidden = false; } }
    finally { if (view.el.isConnected) retry.disabled = false; }
  }
  retry.addEventListener('click', load); await load();
}
