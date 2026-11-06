import { calendarRequest, calendarSession } from '../calendar/api.js';
import { escText } from '../util.js';
import { keepPosition } from './keep-position.js';

const calendarActivityLabels = { signIns: 'Successful sign-ins', registrations: 'Viewing accounts created', eventsCreated: 'Calendar events added', eventsEdited: 'Calendar events edited', eventsDeleted: 'Calendar events deleted', announcementsPosted: 'Announcements posted', announcementsEdited: 'Announcements edited', announcementsDeleted: 'Announcements deleted', announcementOpens: 'Announcement feed opens' };

export async function renderTrafficActivity(host, range, snapshot) {
  const write = html => { if (host.isConnected) keepPosition(host.closest('.traffic-view') || host, () => { host.innerHTML = html; }); };
  const signIn = '<h3>Calendar and announcements</h3><p class="traffic-small">Sign in as the calendar owner through <a href="#calendar">Admin → Calendar</a>, then return here to see private activity totals. Individual names and sign-in history remain under Calendar access.</p>';
  if (calendarSession()?.user?.role !== 'owner') { write(signIn); return; }
  write('<h3>Calendar and announcements</h3><p class="traffic-small">Loading recorded activity…</p>');
  try {
    const params = new URLSearchParams({ start: range.start, end: range.end, asOf: snapshot });
    const value = await calendarRequest('/api/activity?' + params);
    if (value.schemaVersion !== 1 || value.timezone !== 'America/New_York' || value.range?.start !== range.start || value.range?.end !== range.end || value.snapshotAt !== snapshot) throw new Error('The activity service did not return the selected dates and snapshot.');
    if (!Object.keys(calendarActivityLabels).every(key => Number.isSafeInteger(value.counts?.[key]) && value.counts[key] >= 0)) throw new Error('Recorded activity counts are unavailable.');
    const started = new Date(value.startedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
    const known = value.coverage !== 'not-tracked';
    write(`<h3>Calendar and announcements</h3><p class="traffic-small">Owner-only activity for the selected New York dates and snapshot. Tracking began ${escText(started)}. Earlier activity is not included in these totals.${value.coverage === 'partial' ? ' These totals cover only the recorded part of this range.' : ''}</p><dl class="traffic-activity-grid">${Object.entries(calendarActivityLabels).map(([key, label]) => `<div><dt>${escText(label)}</dt><dd>${known ? Number(value.counts[key]).toLocaleString('en-US') : 'Not tracked'}</dd></div>`).join('')}</dl><p class="traffic-small">Successful sign-ins include account creation and accepted invitations. Activity counts successful operations, including those from browsers excluded from page-view tracking. Reopening a feed counts again; retries do not. Individual sign-in history is retained under Calendar access.</p>`);
  } catch (error) {
    if (error.status === 401 || error.status === 403) { write(signIn); return; }
    write(`<h3>Calendar and announcements</h3><p class="traffic-small">Activity totals are unavailable. ${escText(error.message)} Use Refresh data to try again.</p>`);
  }
}
