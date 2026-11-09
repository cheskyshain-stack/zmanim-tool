const CALENDAR_SESSION_KEY = 'lakewood-commons-calendar-session-v1';
let calendarEndpoint = null;

export async function calendarConfig() {
  if (calendarEndpoint !== null) return calendarEndpoint;
  if (location.protocol === 'file:') return '';
  const response = await fetch('/data/calendar.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Calendar connection settings could not be loaded. Reload to try again.');
  const value = await response.json();
  if (typeof value.endpoint !== 'string') throw new Error('Calendar connection settings are invalid.');
  if (value.endpoint) {
    const url = new URL(value.endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('The calendar requires a secure connection.');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Calendar connection settings are invalid.');
  }
  calendarEndpoint = value.endpoint.replace(/\/$/, '');
  return calendarEndpoint;
}

function storedCalendarSession(storage) {
  try { return JSON.parse(window[storage].getItem(CALENDAR_SESSION_KEY) || 'null'); }
  catch { return null; }
}

function validCalendarSession(session) {
  return session?.expires > Date.now() && /^[a-f0-9]{64}$/.test(session.token || '') ? session : null;
}

export function calendarSession(value) {
  const current = storedCalendarSession('sessionStorage');
  if (value === undefined) return validCalendarSession(current);
  const saved = value ? JSON.stringify(value) : null;
  try { saved ? sessionStorage.setItem(CALENDAR_SESSION_KEY, saved) : sessionStorage.removeItem(CALENDAR_SESSION_KEY); }
  catch { if (saved) throw new Error('Allow session storage to sign in to the calendar.'); }
  try {
    if (saved) localStorage.setItem(CALENDAR_SESSION_KEY, saved);
    else if (current?.token && storedCalendarSession('localStorage')?.token === current.token) localStorage.removeItem(CALENDAR_SESSION_KEY);
  } catch { /* Storage restrictions still allow a session in this tab. */ }
  return value;
}

export function restoreCalendarSession() {
  const current = calendarSession();
  if (current) return current;
  const remembered = validCalendarSession(storedCalendarSession('localStorage'));
  if (!remembered) return null;
  // Pin requests in this tab to this account, even if another tab signs in later.
  try { sessionStorage.setItem(CALENDAR_SESSION_KEY, JSON.stringify(remembered)); }
  catch { return null; }
  return remembered;
}

export function calendarSessionWasCleared(event) {
  if (event.key !== CALENDAR_SESSION_KEY || event.newValue !== null || !event.oldValue) return false;
  const token = storedCalendarSession('sessionStorage')?.token;
  try { return !!token && event.storageArea === localStorage && JSON.parse(event.oldValue)?.token === token; }
  catch { return false; }
}

export async function calendarRequest(path, { method = 'GET', body, signal } = {}) {
  const endpoint = await calendarConfig();
  if (!endpoint) throw new Error('Shared calendar accounts have not been connected yet.');
  const token = calendarSession()?.token;
  const response = await fetch(endpoint + path, { method, signal: signal || AbortSignal.timeout(20000),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  let value;
  try { value = await response.json(); } catch { throw new Error('The calendar service returned an unreadable response. Try again.'); }
  if (!response.ok) {
    if (response.status === 401 && method === 'GET' && token && storedCalendarSession('sessionStorage')?.token === token) calendarSession(null);
    throw Object.assign(new Error(value.error || 'The calendar request could not be completed.'), { status: response.status });
  }
  return value;
}
