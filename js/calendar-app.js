import { loadTables } from './data-loader.js';
import { resolveSettings } from './settings.js';
import { renderCalendar } from './ui/calendar-view.js';

const calendarHost = document.getElementById('calendar-editor');
const calendarLink = new URLSearchParams(location.hash.slice(1));
const calendarSetupToken = calendarLink.get('setup') || '', calendarInviteToken = calendarLink.get('invite') || '';
// A one-time account token belongs only in the registration request body.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
(async () => {
  try {
    const [tables, response] = await Promise.all([loadTables(), fetch('/data/published.json', { cache: 'no-cache' })]);
    if (!response.ok) throw new Error('Calendar settings could not be loaded. Reload to try again.');
    const config = await response.json();
    renderCalendar(calendarHost, resolveSettings(config.settings), tables, { standalone: true, setupToken: calendarSetupToken, inviteToken: calendarInviteToken });
  } catch (error) { calendarHost.textContent = error.message || 'The calendar could not be loaded. Reload to try again.'; }
})();
