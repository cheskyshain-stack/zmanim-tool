import { loadTables } from './data-loader.js';
import { resolveSettings } from './settings.js';
import { renderCalendar } from './ui/calendar-view.js';
import { wireSecretDoor } from './ui/nav-helpers.js';

const calendarHost = document.getElementById('calendar-editor');
const calendarLink = new URLSearchParams(location.hash.slice(1));
const calendarSetupToken = calendarLink.get('setup') || '', calendarInviteToken = calendarLink.get('invite') || '';
const calendarQuery = new URLSearchParams(location.search);
const calendarCongregationPreview = calendarQuery.get('preview') === 'congregation';
// A one-time account token belongs only in the registration request body.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
wireSecretDoor(document.querySelector('.cal-editor-header'), '/admin/');
(async () => {
  try {
    const [tables, response] = await Promise.all([loadTables(), fetch('/data/published.json', { cache: 'no-cache' })]);
    if (!response.ok) throw new Error('Calendar settings could not be loaded. Reload to try again.');
    const config = await response.json();
    renderCalendar(calendarHost, resolveSettings(config.settings), tables, { standalone: true, setupToken: calendarSetupToken, inviteToken: calendarInviteToken, congregationPreview: calendarCongregationPreview, reminderDate: calendarQuery.get('simcha') || '', reminderPost: calendarQuery.get('post') === '1' });
  } catch (error) { calendarHost.textContent = error.message || 'The calendar could not be loaded. Reload to try again.'; }
})();
