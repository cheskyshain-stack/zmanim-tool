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

export function calendarSession(value) {
  if (value !== undefined) {
    try { value ? sessionStorage.setItem(CALENDAR_SESSION_KEY, JSON.stringify(value)) : sessionStorage.removeItem(CALENDAR_SESSION_KEY); }
    catch { throw new Error('Allow session storage to sign in to the calendar.'); }
    return value;
  }
  try {
    const session = JSON.parse(sessionStorage.getItem(CALENDAR_SESSION_KEY) || 'null');
    return session?.expires > Date.now() && /^[a-f0-9]{64}$/.test(session.token || '') ? session : null;
  } catch { return null; }
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
    if (response.status === 401 && method === 'GET') calendarSession(null);
    throw Object.assign(new Error(value.error || 'The calendar request could not be completed.'), { status: response.status });
  }
  return value;
}
