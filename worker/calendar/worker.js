import { DurableObject } from 'cloudflare:workers';
import { calendarEvent, calendarSerial } from '../../js/calendar/model.js';
import { calendarAnnouncementText } from '../../js/calendar/announcement-model.js';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const encoder = new TextEncoder();
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => { let out = a.length ^ b.length; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return out === 0; };
const email = value => typeof value === 'string' && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : fail('Enter a valid email address.');
const name = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 60 ? value.trim() : fail('Enter a name of up to 60 characters.');
const userView = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, pending: !user.password });
const identifier = value => /^[a-zA-Z0-9_-]{8,100}$/.test(value || '');
async function passwordHash(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail('Use a password with 12 to 200 characters.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: encoder.encode(salt) }, key, 256);
  return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: 'Open the calendar from the shul website.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let result;
    try { result = await env.CALENDAR.get(env.CALENDAR.idFromName('lakewood-commons')).fetch(request); }
    catch { result = json({ error: 'The calendar is temporarily unavailable. Please try again.' }, 503); }
    const headers = new Headers(result.headers);
    Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
    return new Response(result.body, { status: result.status, headers });
  },
};

export class CommunityCalendar extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; this.env = env; }
  async body(request) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Use a JSON request.');
    const reader = request.body?.getReader(); if (!reader) fail('Enter the requested information.');
    const decoder = new TextDecoder(); let text = '', length = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 24000) { await reader.cancel(); fail('This event is too long.', 413); }
      text += decoder.decode(value, { stream: true });
    }
    try { const value = JSON.parse(text + decoder.decode()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { fail('Enter valid information.'); }
  }
  async limited(request, subject, limit = 12) {
    const key = 'attempt:' + await hash((request.headers.get('CF-Connecting-IP') || 'local') + '/' + subject);
    const now = Date.now(), old = await this.ctx.storage.get(key);
    const next = old?.until > now ? old : { count: 0, until: now + 15 * 60000 };
    if (next.count >= limit) fail('Too many attempts. Try again in 15 minutes.', 429);
    await this.ctx.storage.put(key, { ...next, count: next.count + 1 });
    await this.ctx.storage.setAlarm(now + 2 * 86400000);
  }
  async signedIn(request, owner = false) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token || '')) fail('Sign in to open the calendar.', 401);
    const session = await this.ctx.storage.get('session:' + await hash(token));
    const user = session && await this.ctx.storage.get('user:' + session.userId);
    if (!user?.active || session.expires <= Date.now() || session.version !== user.version) fail('Your session has ended. Sign in again.', 401);
    if (owner && user.role !== 'owner') fail('Only the main calendar admin can manage accounts.', 403);
    return user;
  }
  async session(user, type = 'sign-in') {
    const token = random(), expires = Date.now() + 2 * 86400000;
    const now = new Date().toISOString(), key = 'login-stats:' + user.id, old = await this.ctx.storage.get(key);
    const count = (old?.count || 0) + 1;
    await this.ctx.storage.put({ ['session:' + await hash(token)]: { userId: user.id, version: user.version, expires },
      [key]: { count, firstAt: old?.firstAt || now, lastAt: now },
      ['login-history:' + user.id + ':' + String(count).padStart(16, '0')]: { sequence: count, at: now, type } });
    await this.ctx.storage.setAlarm(expires);
    return { token, expires, user: userView(user) };
  }
  async loginActivity(url) {
    const storage = this.ctx.storage;
    if (url.pathname === '/api/access/activity') {
      const users = [...(await storage.list({ prefix: 'user:' })).values()];
      const stats = await storage.list({ prefix: 'login-stats:' });
      return json({ users: users.map(user => {
        const history = stats.get('login-stats:' + user.id);
        return { ...userView(user), signInCount: history?.count || 0, firstSignInAt: history?.firstAt || null, lastSignInAt: history?.lastAt || null };
      }).sort((a, b) => (b.lastSignInAt || '').localeCompare(a.lastSignInAt || '') || a.name.localeCompare(b.name)) });
    }
    const id = url.pathname.slice('/api/access/activity/'.length);
    if (!identifier(id) || !await storage.get('user:' + id)) fail('That account was not found.', 404);
    const before = url.searchParams.get('before');
    if (before !== null && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))) fail('Choose a valid sign-in history page.');
    const prefix = 'login-history:' + id + ':';
    const rows = await storage.list({ prefix, reverse: true, limit: 51, ...(before === null ? {} : { end: prefix + before.padStart(16, '0') }) });
    const entries = [...rows.values()].slice(0, 50);
    return json({ entries, nextBefore: rows.size > 50 ? entries.at(-1).sequence : null });
  }
  async announcementStatus(user) {
    const total = await this.ctx.storage.get('announcement-count') || 0;
    const read = await this.ctx.storage.list({ prefix: 'announcement-read:' + user.id + ':' });
    return { total, unread: Math.max(0, total - read.size), canPost: ['owner', 'editor'].includes(user.role) };
  }
  async announcements(request, user, url) {
    const storage = this.ctx.storage, method = request.method;
    if (url.pathname === '/api/announcements/status' && method === 'GET') return json(await this.announcementStatus(user));
    if (url.pathname === '/api/announcements/read' && method === 'POST') {
      const body = await this.body(request);
      if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some(id => typeof id !== 'string' || !identifier(id))) fail('Choose valid announcements to mark as read.');
      const ids = [...new Set(body.ids)], messages = ids.length ? await storage.get(ids.map(id => 'announcement:' + id)) : new Map();
      if (ids.some(id => !messages.has('announcement:' + id))) fail('An announcement was not found.', 404);
      if (ids.length) await storage.put(Object.fromEntries(ids.map(id => ['announcement-read:' + user.id + ':' + id, messages.get('announcement:' + id).sequence])));
      return json(await this.announcementStatus(user));
    }
    if (url.pathname !== '/api/announcements') return json({ error: 'Announcement page not found.' }, 404);
    if (method === 'POST') {
      if (!['owner', 'editor'].includes(user.role)) fail('Only calendar admins can post announcements.', 403);
      const body = await this.body(request);
      if (typeof body.id !== 'string' || !identifier(body.id)) fail('Reload the announcement form and try again.');
      let text; try { text = calendarAnnouncementText(body.text); } catch (error) { fail(error.message); }
      const key = 'announcement:' + body.id, old = await storage.get(key);
      if (old) {
        if (old.authorId !== user.id || old.text !== text) fail('This announcement was already posted with different text. Refresh the feed.', 409);
        return json({ message: old, ...await this.announcementStatus(user) });
      }
      await this.limited(request, 'announcement-write', 60);
      const sequence = (await storage.get('announcement-count') || 0) + 1;
      const message = { id: body.id, sequence, text, authorId: user.id, authorName: user.name, createdAt: new Date().toISOString() };
      await storage.put({ [key]: message, ['announcement-order:' + String(sequence).padStart(16, '0')]: body.id,
        ['announcement-read:' + user.id + ':' + body.id]: sequence, 'announcement-count': sequence });
      return json({ message, ...await this.announcementStatus(user) }, 201);
    }
    if (method === 'GET') {
      const before = url.searchParams.get('before');
      if (before !== null && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))) fail('Choose a valid announcement page.');
      const rows = await storage.list({ prefix: 'announcement-order:', reverse: true, limit: 31,
        ...(before === null ? {} : { end: 'announcement-order:' + before.padStart(16, '0') }) });
      const ids = [...rows.values()].slice(0, 30), records = ids.length ? await storage.get(ids.map(id => 'announcement:' + id)) : new Map();
      const read = await storage.list({ prefix: 'announcement-read:' + user.id + ':' });
      const messages = ids.map(id => ({ ...records.get('announcement:' + id), read: read.has('announcement-read:' + user.id + ':' + id) }));
      return json({ messages, nextBefore: rows.size > 30 ? messages.at(-1).sequence : null, ...await this.announcementStatus(user) });
    }
    return json({ error: 'Announcement page not found.' }, 404);
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.route(request); }
      catch (error) { return json({ error: error.status ? error.message : 'The calendar request could not be completed.' }, error.status || 500); }
    });
  }
  async route(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/api/info' && method === 'GET') return json({ ready: !!await this.ctx.storage.get('config:owner'), private: true, accounts: true, announcements: true, loginHistory: true, selfRegistration: true });
    if (path === '/api/register' && method === 'POST') {
      if (!await this.ctx.storage.get('config:owner')) fail('The calendar owner must finish setup before registration opens.', 409);
      await this.limited(request, 'register');
      const body = await this.body(request), address = email(body.email), displayName = name(body.name);
      const users = [...(await this.ctx.storage.list({ prefix: 'user:' })).values()];
      if (users.some(user => user.email === address)) fail('An account already uses this email. Sign in or contact the calendar admin.', 409);
      if (users.filter(user => user.active && user.role === 'viewer').length >= 2000) fail('Calendar registration is full. Contact the calendar admin.', 409);
      const salt = random(), password = await passwordHash(body.password, salt), id = crypto.randomUUID();
      const viewer = { id, email: address, name: displayName, password, salt, role: 'viewer', active: true, version: 1 };
      await this.ctx.storage.put('user:' + id, viewer);
      return json(await this.session(viewer, 'account-created'), 201);
    }
    if (path === '/api/setup' && method === 'POST') {
      await this.limited(request, 'setup', 5);
      const body = await this.body(request);
      if (!this.env.BOOTSTRAP_SHA256 || !equal(await hash(String(body.setupToken || '')), this.env.BOOTSTRAP_SHA256)) fail('That setup link is invalid.', 401);
      if (await this.ctx.storage.get('config:owner')) fail('The main admin account is already set up.', 409);
      const address = email(body.email), displayName = name(body.name), salt = random();
      const password = await passwordHash(body.password, salt), id = crypto.randomUUID();
      const owner = { id, email: address, name: displayName, password, salt, role: 'owner', active: true, version: 1 };
      await this.ctx.storage.put({ ['user:' + id]: owner, 'config:owner': id });
      return json(await this.session(owner, 'account-created'), 201);
    }
    if (path === '/api/session' && method === 'POST') {
      await this.limited(request, 'signin');
      const body = await this.body(request), address = email(body.email);
      const users = await this.ctx.storage.list({ prefix: 'user:' });
      const user = [...users.values()].find(value => value.email === address && value.active);
      const candidate = await passwordHash(body.password, user?.salt || 'unavailable-calendar-account');
      if (!user?.password || !equal(candidate, user.password)) fail('The email or password did not match.', 401);
      return json(await this.session(user));
    }
    if (path === '/api/invitations/claim' && method === 'POST') {
      await this.limited(request, 'claim');
      const body = await this.body(request), key = 'invite:' + await hash(String(body.token || ''));
      const invite = await this.ctx.storage.get(key), user = invite && await this.ctx.storage.get('user:' + invite.userId);
      if (!user?.active || invite.expires <= Date.now() || invite.version !== user.version) fail('That invitation has expired or was removed.', 401);
      const salt = random(), password = await passwordHash(body.password, salt);
      const next = { ...user, password, salt, version: user.version + 1 };
      await this.ctx.storage.put('user:' + user.id, next); await this.ctx.storage.delete(key);
      return json(await this.session(next, 'invitation-claimed'));
    }
    const user = await this.signedIn(request, path.startsWith('/api/access'));
    if ((path === '/api/access/activity' || path.startsWith('/api/access/activity/')) && method === 'GET') return this.loginActivity(url);
    if (path === '/api/announcements' || path.startsWith('/api/announcements/')) return this.announcements(request, user, url);
    if (path === '/api/session' && method === 'GET') return json({ user: userView(user) });
    if (path === '/api/session' && method === 'DELETE') {
      await this.ctx.storage.delete('session:' + await hash(request.headers.get('Authorization').slice(7)));
      return json({ signedOut: true });
    }
    if (path === '/api/access' && method === 'GET') return json({ users: [...(await this.ctx.storage.list({ prefix: 'user:' })).values()].filter(value => value.active).map(userView) });
    if (path === '/api/access' && method === 'POST') {
      const body = await this.body(request), address = email(body.email), displayName = name(body.name);
      const users = [...(await this.ctx.storage.list({ prefix: 'user:' })).values()];
      if (users.some(value => value.active && value.email === address)) fail('That email already has calendar access.', 409);
      if (users.filter(value => value.active && value.role !== 'viewer').length >= 20) fail('Remove an unused calendar admin before adding another.', 409);
      const editor = { id: crypto.randomUUID(), email: address, name: displayName, role: 'editor', active: true, version: 1, password: null };
      const token = random();
      await this.ctx.storage.put({ ['user:' + editor.id]: editor, ['invite:' + await hash(token)]: { userId: editor.id, version: editor.version, expires: Date.now() + 7 * 86400000 } });
      return json({ user: userView(editor), token }, 201);
    }
    const roleChange = /^\/api\/access\/([a-zA-Z0-9_-]+)\/role$/.exec(path);
    if (roleChange && method === 'POST') {
      const body = await this.body(request), account = await this.ctx.storage.get('user:' + roleChange[1]);
      if (!account?.active) fail('That account was not found.', 404);
      if (account.role === 'owner' || !['editor', 'viewer'].includes(body.role)) fail('Choose viewing or calendar editing access.');
      if (!account.password) fail('Finish account setup before changing editing access.');
      if (account.role === body.role) return json({ user: userView(account) });
      if (body.role === 'editor') {
        const users = [...(await this.ctx.storage.list({ prefix: 'user:' })).values()];
        if (users.filter(user => user.active && user.role !== 'viewer').length >= 20) fail('Remove an unused calendar admin before adding another.', 409);
      }
      const next = { ...account, role: body.role, version: account.version + 1 };
      await this.ctx.storage.put('user:' + next.id, next);
      return json({ user: userView(next) });
    }
    const access = /^\/api\/access\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (access && ['DELETE', 'POST'].includes(method)) {
      const editor = await this.ctx.storage.get('user:' + access[1]);
      if (!editor) fail('That account was not found.', 404);
      if (editor.role === 'owner') fail('The main admin account cannot be removed or reset here.');
      const next = { ...editor, active: method !== 'DELETE', version: editor.version + 1, password: null, salt: null };
      if (method === 'DELETE') { await this.ctx.storage.put('user:' + next.id, next); return json({ removed: true }); }
      const token = random();
      await this.ctx.storage.put({ ['user:' + next.id]: next, ['invite:' + await hash(token)]: { userId: next.id, version: next.version, expires: Date.now() + 7 * 86400000 } });
      return json({ user: userView(next), token });
    }
    if (path === '/api/events' && method === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!Number.isFinite(calendarSerial(from)) || !Number.isFinite(calendarSerial(to)) || calendarSerial(to) < calendarSerial(from) || calendarSerial(to) - calendarSerial(from) > 62) fail('Choose a calendar month.');
      const events = [...(await this.ctx.storage.list({ prefix: 'event:' })).values()];
      return json({ events: events.filter(event => !event.deletedAt && event.date <= to && event.endDate >= from) });
    }
    const entry = /^\/api\/events\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (entry && ['PUT', 'DELETE'].includes(method)) {
      if (!['owner', 'editor'].includes(user.role)) fail('Only calendar admins can add or change events.', 403);
      await this.limited(request, 'event-write', 120);
      if (!identifier(entry[1])) fail('That event was not found.', 404);
      const body = await this.body(request), key = 'event:' + entry[1], old = await this.ctx.storage.get(key);
      const deleted = await this.ctx.storage.get('deleted-event:' + entry[1]);
      if (old && user.role !== 'owner' && old.createdBy !== user.id) fail('Only the main admin can change another editor’s event.', 403);
      if ((old?.revision || 0) !== body.revision || deleted) fail('This event changed in another session. Reload the month before saving.', 409);
      const now = new Date().toISOString();
      if (method === 'DELETE') {
        if (!old) fail('That event was not found.', 404);
        await this.ctx.storage.transaction(async transaction => {
          await transaction.put('deleted-event:' + entry[1], { revision: old.revision + 1, deletedAt: now });
          await transaction.delete(key);
        });
        return json({ removed: true });
      }
      if (!old && (await this.ctx.storage.list({ prefix: 'event:', limit: 2000 })).size >= 2000) fail('Remove unused or past events before adding more. This calendar has reached its event limit.', 409);
      let fields;
      try { fields = calendarEvent(body); } catch (error) { fail(error.message); }
      const event = { ...fields, id: entry[1], revision: (old?.revision || 0) + 1,
        createdAt: old?.createdAt || now, createdBy: old?.createdBy || user.id, updatedAt: now, updatedBy: user.id };
      await this.ctx.storage.put(key, event);
      return json({ event }, old ? 200 : 201);
    }
    return json({ error: 'Calendar page not found.' }, 404);
  }
  async alarm() {
    const now = Date.now();
    for (const prefix of ['session:', 'attempt:', 'invite:']) {
      const rows = await this.ctx.storage.list({ prefix });
      const expired = [...rows].filter(([, value]) => (value.expires || value.until) <= now).map(([key]) => key);
      for (let i = 0; i < expired.length; i += 100) await this.ctx.storage.delete(expired.slice(i, i + 100));
    }
    await this.ctx.storage.setAlarm(now + 86400000);
  }
}
