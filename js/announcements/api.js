let announcementsConfig;
export async function announcementEndpoint() {
  if (!announcementsConfig) announcementsConfig = fetch('/data/announcements.json', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error('The announcements connection could not be loaded.');
    return response.json();
  }).then(value => {
    if (!value.endpoint) throw new Error('The announcements service has not been connected yet.');
    const url = new URL(value.endpoint);
    const local = ['localhost', '127.0.0.1'].includes(location.hostname) && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('The announcements connection is invalid.');
    return url.origin;
  }).catch(error => { announcementsConfig = null; throw error; });
  return announcementsConfig;
}
export async function announcementRequest(path, { method = 'GET', body, token, signal } = {}) {
  const endpoint = await announcementEndpoint();
  const response = await fetch(endpoint + path, { method, cache: 'no-store', credentials: 'omit', signal,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || 'Announcements could not be loaded. Please try again.'), { status: response.status });
  return value;
}
export const announcementEscape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export const announcementDate = value => value ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '';
export function announcementArticle(post) {
  return `<article class="announcement-message" id="message-${announcementEscape(post.id)}"><p class="announcement-meta">${announcementEscape(announcementDate(post.publishedAt || post.updatedAt))}</p><h2 dir="auto">${announcementEscape(post.title)}</h2><p class="announcement-body" dir="auto">${announcementEscape(post.body)}</p></article>`;
}
