import { civilDate, shiftDate, midnight } from '../traffic-calendar.js';
import { calendarAnnouncementDate } from '../../js/calendar/announcement-model.js';

export const MESSAGE_FEED_PATHS = ['/api/v1/messages', '/api/v1/messages.txt'];
export const messageFeedHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};
const prefix = 'message-feed:';
const encoder = new TextEncoder();
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const random = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const view = record => ({ id: record.id, name: record.name, createdAt: record.createdAt });
const json = (value, status = 200) => Response.json(value, { status, headers: messageFeedHeaders });

export function messageFeedWeek(now = Date.now()) {
  const today = civilDate(now), weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const start = shiftDate(today, -weekday), next = shiftDate(start, 7);
  return { start, end: shiftDate(next, -1), since: new Date(midnight(start)).toISOString(), until: new Date(midnight(next)).toISOString() };
}

export async function manageMessageFeeds(storage, request, url, readBody) {
  const id = url.pathname.slice('/api/message-feeds/'.length);
  if (request.method === 'DELETE' && /^[a-f0-9]{32}$/.test(id)) {
    await storage.delete(prefix + id);
    return json({ revoked: true });
  }
  if (url.pathname !== '/api/message-feeds') return json({ error: 'Message link not found.' }, 404);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Use GET or POST.' }, 405);
  const records = [...(await storage.list({ prefix })).values()];
  if (request.method === 'GET') return json({ links: records.map(view), endpoint: url.origin });
  const body = await readBody(request);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) fail('Enter a website name of up to 60 characters.');
  if (records.length >= 20) fail('Revoke an unused message link before creating another.', 409);
  const recordId = random(16), key = 'calmsg_' + recordId + '_' + random(32);
  const record = { id: recordId, name, createdAt: new Date().toISOString(), keyHash: await hash(key) };
  await storage.put(prefix + recordId, record);
  return json({ link: view(record), key, endpoint: url.origin }, 201);
}

export async function readMessageFeed(storage, request, url) {
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'This API is read-only. Use GET.' }), { status: 405, headers: { ...messageFeedHeaders, 'Content-Type': 'application/json', Allow: 'GET, OPTIONS' } });
  const authorization = request.headers.get('Authorization');
  const queryKeys = url.searchParams.getAll('key');
  const key = authorization ? authorization.replace(/^Bearer /, '') : queryKeys[0];
  if ((authorization && queryKeys.length) || queryKeys.length > 1 || !/^calmsg_[a-f0-9]{32}_[a-f0-9]{64}$/.test(key || '')) fail('A valid message link or API key is required.', 401);
  const record = await storage.get(prefix + key.split('_')[1]);
  const candidate = await hash(key);
  let difference = candidate.length ^ (record?.keyHash.length || 0);
  for (let i = 0; i < candidate.length; i++) difference |= candidate.charCodeAt(i) ^ (record?.keyHash.charCodeAt(i) || 0);
  if (!record || difference) fail('A valid message link or API key is required.', 401);
  if ([...url.searchParams.keys()].some(name => name !== 'key')) fail('This link shows only the current week. Remove extra query parameters.');
  const week = messageFeedWeek(), messages = [];
  const datePrefix = 'announcement-date-order:';
  let after;
  do {
    const rows = await storage.list({ end: datePrefix + week.until, limit: 100, ...(after ? { startAfter: after } : { start: datePrefix + week.since }) });
    if (!rows.size) break;
    const records = await storage.get([...rows.values()].map(id => 'announcement:' + id));
    for (const id of rows.values()) {
      const message = records.get('announcement:' + id);
      if (!message || message.deletedAt || calendarAnnouncementDate(message) < week.since || calendarAnnouncementDate(message) >= week.until) continue;
      messages.push({ id: message.id, text: message.text, postedAt: calendarAnnouncementDate(message), updatedAt: message.updatedAt || message.createdAt, revision: message.revision || 1 });
    }
    after = [...rows.keys()].at(-1);
  } while (after);
  if (url.pathname.endsWith('.txt')) return new Response(messages.map(message => message.text).join('\n\n'), { headers: { ...messageFeedHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });
  return json({ schemaVersion: 1, timezone: 'America/New_York', week: { start: week.start, end: week.end }, generatedAt: new Date().toISOString(), messages });
}
