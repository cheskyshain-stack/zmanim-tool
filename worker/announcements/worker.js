import { buildPushPayload } from '@block65/webcrypto-web-push';
import { DurableObject } from 'cloudflare:workers';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const enc = new TextEncoder();
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
const email = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254 ? value.toLowerCase().trim() : fail('Enter a valid email address.');
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, pending: !user.password, createdAt: user.createdAt });
const publicPost = post => ({ id: post.id, title: post.title, body: post.body, publishedAt: post.publishedAt, updatedAt: post.updatedAt, expiresAt: post.expiresAt });

async function passwordHash(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail('Use a password with 12 to 200 characters.');
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return base64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256)));
}

export async function subscription(value) {
  try {
    const url = new URL(value.endpoint), host = url.hostname;
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 2500
      || !(host === 'fcm.googleapis.com' || host === 'web.push.apple.com' || host === 'updates.push.services.mozilla.com'
        || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com'))) throw new Error();
    if (!/^[A-Za-z0-9_-]+$/.test(value.keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(value.keys.auth)
      || decode(value.keys.p256dh).length !== 65 || decode(value.keys.auth).length !== 16) throw new Error();
    await crypto.subtle.importKey('raw', decode(value.keys.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  } catch { fail('That browser notification subscription is not supported.'); }
}

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN, origin = request.headers.get('Origin');
    if (origin !== allowed) return json({ error: 'Open announcements from the shul website.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response;
    try { response = await env.ANNOUNCEMENTS.get(env.ANNOUNCEMENTS.idFromName('lakewood-commons')).fetch(request); }
    catch { response = json({ error: 'Announcements are temporarily unavailable. Please try again.' }, 503); }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

export class AnnouncementBoard extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; this.env = env; }
  async body(request) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Use a JSON request.');
    const reader = request.body?.getReader(); if (!reader) fail('Enter the requested information.');
    let text = '', length = 0; const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 24000) { await reader.cancel(); fail('This message is too long.', 413); }
      text += decoder.decode(value, { stream: true });
    }
    try { const value = JSON.parse(text + decoder.decode()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { fail('Enter valid information.'); }
  }
  async limited(request, subject, limit = 12) {
    const key = 'attempt:' + await hash((request.headers.get('CF-Connecting-IP') || 'local') + '/' + subject);
    const at = Date.now(), old = await this.ctx.storage.get(key);
    const record = old?.until > at ? old : { count: 0, until: at + 15 * 60000 };
    if (record.count >= limit) fail('Too many attempts. Try again in 15 minutes.', 429);
    await this.ctx.storage.put(key, { ...record, count: record.count + 1 });
  }
  async signedIn(request, owner = false) {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token || '')) fail('Sign in to manage announcements.', 401);
    const session = await this.ctx.storage.get('session:' + await hash(token));
    const user = session && await this.ctx.storage.get('user:' + session.userId);
    if (!user?.active || session.expires <= Date.now() || session.version !== user.version) fail('Your session has ended. Sign in again.', 401);
    if (owner && user.role !== 'owner') fail('Only the owner can manage posting access.', 403);
    return user;
  }
  async newSession(user) {
    const token = random(), expires = Date.now() + 2 * 86400000;
    await this.ctx.storage.put('session:' + await hash(token), { userId: user.id, version: user.version, expires });
    return { user: publicUser(user), token, expires };
  }
  async vapid() {
    let keys = await this.ctx.storage.get('config:vapid');
    if (!keys) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
      keys = { subject: this.env.ALLOWED_ORIGIN, publicKey: base64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: privateKey.d };
      await this.ctx.storage.put('config:vapid', keys);
    }
    return keys;
  }
  async removeSubscription(key) {
    if (await this.ctx.storage.delete(key)) await this.ctx.storage.put('config:subscriber-count', Math.max(0, Number(await this.ctx.storage.get('config:subscriber-count') || 0) - 1));
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.handle(request); }
      catch (error) { return json({ error: error.status ? error.message : 'The request could not be completed. Please try again.' }, error.status || 500); }
    });
  }
  async handle(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/api/info' && method === 'GET') {
      const ready = !!await this.ctx.storage.get('config:owner');
      return json({ ready, publicKey: ready ? (await this.vapid()).publicKey : null });
    }
    if (path === '/api/setup' && method === 'POST') {
      await this.limited(request, 'setup');
      const body = await this.body(request);
      if (!this.env.BOOTSTRAP_SHA256 || await hash(String(body.setupToken || '')) !== this.env.BOOTSTRAP_SHA256) fail('That setup link is invalid.', 401);
      if (await this.ctx.storage.get('config:owner')) fail('The owner account is already set up.', 409);
      const address = email(body.email), name = String(body.name || '').trim().slice(0, 60); if (!name) fail('Enter your name.');
      const salt = random(), password = await passwordHash(body.password, salt), id = crypto.randomUUID();
      const user = { id, email: address, name, role: 'owner', active: true, version: 1, salt, password, createdAt: new Date().toISOString() };
      await this.ctx.storage.put({ ['user:' + id]: user, 'config:owner': id });
      await this.vapid();
      return json(await this.newSession(user), 201);
    }
    if (path === '/api/session' && method === 'POST') {
      const body = await this.body(request); await this.limited(request, 'signin');
      const address = email(body.email), users = await this.ctx.storage.list({ prefix: 'user:' });
      const user = [...users.values()].find(user => user.email === address);
      const candidate = await passwordHash(body.password, user?.salt || 'invalid-account');
      if (!user?.active || !user.password || candidate !== user.password) fail('The email or password did not match.', 401);
      return json(await this.newSession(user));
    }
    if (path === '/api/invitations/claim' && method === 'POST') {
      await this.limited(request, 'invitation');
      const body = await this.body(request), key = 'invite:' + await hash(String(body.token || ''));
      const invite = await this.ctx.storage.get(key), user = invite && await this.ctx.storage.get('user:' + invite.userId);
      if (!user?.active || invite.expires < Date.now()) fail('That posting link has expired or was removed.', 401);
      user.salt = random(); user.password = await passwordHash(body.password, user.salt); user.version++;
      await this.ctx.storage.put('user:' + user.id, user); await this.ctx.storage.delete(key);
      return json(await this.newSession(user));
    }
    if (path === '/api/posts' && method === 'GET') {
      const posts = await this.ctx.storage.list({ prefix: 'post:' });
      return json({ posts: [...posts.values()].filter(post => !post.deleted && post.status === 'published' && (!post.expiresAt || Date.parse(post.expiresAt) > Date.now()))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 100).map(publicPost) });
    }
    if (path === '/api/subscriptions' && ['POST', 'DELETE'].includes(method)) {
      if (!await this.ctx.storage.get('config:owner')) fail('Notifications are not available yet.', 503);
      await this.limited(request, 'subscription', 300);
      const sub = await subscription(await this.body(request)), key = 'subscriber:' + await hash(sub.endpoint);
      const existing = await this.ctx.storage.get(key);
      if (method === 'DELETE') {
        if (existing && (existing.keys.auth !== sub.keys.auth || existing.keys.p256dh !== sub.keys.p256dh)) fail('That subscription did not match.', 403);
        await this.removeSubscription(key); return json({ subscribed: false });
      }
      const count = Number(await this.ctx.storage.get('config:subscriber-count') || 0);
      if (!existing && count >= 5000) fail('The notification subscriber limit has been reached. Please contact the shul.', 409);
      await this.ctx.storage.put(key, { ...sub, addedAt: existing?.addedAt || new Date().toISOString() });
      if (!existing) await this.ctx.storage.put('config:subscriber-count', count + 1);
      return json({ subscribed: true });
    }
    const user = await this.signedIn(request, path.startsWith('/api/access'));
    if (path === '/api/session' && method === 'GET') return json({ user: publicUser(user) });
    if (path === '/api/session' && method === 'DELETE') {
      await this.ctx.storage.delete('session:' + await hash(request.headers.get('Authorization').slice(7))); return json({ signedOut: true });
    }
    if (path === '/api/access' && method === 'GET') return json({ users: [...(await this.ctx.storage.list({ prefix: 'user:' })).values()].map(publicUser) });
    if (path === '/api/access' && method === 'POST') {
      const body = await this.body(request), address = email(body.email), name = String(body.name || '').trim().slice(0, 60); if (!name) fail('Enter a name.');
      const users = [...(await this.ctx.storage.list({ prefix: 'user:' })).values()];
      if (users.some(user => user.email === address && user.active)) fail('That person already has posting access.', 409);
      if (users.filter(user => user.active).length >= 20) fail('There are already 20 posting accounts. Remove an unused one first.', 409);
      const editor = { id: crypto.randomUUID(), name, email: address, role: 'editor', active: true, version: 1, password: null, createdAt: new Date().toISOString() };
      const token = random(); await this.ctx.storage.put({ ['user:' + editor.id]: editor, ['invite:' + await hash(token)]: { userId: editor.id, expires: Date.now() + 7 * 86400000 } });
      return json({ user: publicUser(editor), token }, 201);
    }
    const access = /^\/api\/access\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (access && method === 'DELETE') {
      if (access[1] === user.id) fail('You cannot remove your own owner access.');
      const editor = await this.ctx.storage.get('user:' + access[1]); if (!editor) fail('That account was not found.', 404);
      await this.ctx.storage.put('user:' + editor.id, { ...editor, active: false, version: editor.version + 1 }); return json({ removed: true });
    }
    if (path === '/api/manage/posts' && method === 'GET') {
      return json({ posts: [...(await this.ctx.storage.list({ prefix: 'post:' })).values()].filter(post => !post.deleted).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    const postRoute = /^\/api\/manage\/posts\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (postRoute && ['PUT', 'DELETE'].includes(method)) {
      const id = postRoute[1]; if (!identifier(id)) fail('Invalid message ID.');
      const body = await this.body(request), old = await this.ctx.storage.get('post:' + id);
      if (old?.deleted) fail('That message was removed.', 410);
      if ((old?.revision || 0) !== body.revision) fail('This message changed in another session. Reload it before saving.', 409);
      const now = new Date().toISOString();
      if (method === 'DELETE') {
        if (!old) fail('That message was not found.', 404);
        await this.ctx.storage.put('post:' + id, { ...old, deleted: true, updatedAt: now, updatedBy: user.id, revision: old.revision + 1 }); return json({ removed: true });
      }
      const title = typeof body.title === 'string' ? body.title.trim() : '', text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!title || title.length > 120 || !text || text.length > 5000) fail('Enter a title up to 120 characters and a message up to 5,000 characters.');
      if (!['draft', 'published'].includes(body.status)) fail('Choose a draft or published message.');
      const expiresAt = body.expiresAt || '';
      if (expiresAt && (!/^\d{4}-\d\d-\d\dT/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) fail('Choose an expiry date in the future.');
      if (!old && (await this.ctx.storage.list({ prefix: 'post:' })).size >= 1000) fail('The message archive is full. Please contact the owner.', 409);
      const post = { id, title, body: text, status: body.status, expiresAt, revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || now, createdBy: old?.createdBy || user.id, updatedAt: now, updatedBy: user.id,
        publishedAt: old?.publishedAt || (body.status === 'published' ? now : null), notified: old?.notified || body.status === 'published' };
      const values = { ['post:' + id]: post };
      if (body.status === 'published' && !old?.notified) values['job:' + id] = { postId: id, cursor: '', attempts: 0, createdAt: now };
      await this.ctx.storage.put(values);
      if (values['job:' + id]) await this.ctx.storage.setAlarm(Date.now() + 1000);
      return json({ post }, old ? 200 : 201);
    }
    fail('That page was not found.', 404);
  }
  async alarm() {
    const jobs = await this.ctx.storage.list({ prefix: 'job:', limit: 1 });
    for (const [jobKey, job] of jobs) {
      const post = await this.ctx.storage.get('post:' + job.postId);
      if (!post || post.deleted || post.status !== 'published' || post.expiresAt && Date.parse(post.expiresAt) <= Date.now()) { await this.ctx.storage.delete(jobKey); continue; }
      const rows = await this.ctx.storage.list({ prefix: 'subscriber:', startAfter: job.cursor || undefined, limit: 20 });
      const vapid = await this.vapid();
      for (const [key, sub] of rows) {
        try {
          // A subscriber who joined later is waiting for the next new announcement.
          if (sub.addedAt <= job.createdAt) {
            const message = { title: post.title, body: post.body.slice(0, 180), url: this.env.ALLOWED_ORIGIN + '/announcements/?post=' + post.id, tag: 'shul-' + post.id };
            const payload = await buildPushPayload({ data: JSON.stringify(message), options: { ttl: 86400 } }, sub, vapid);
            const response = await (this.env.PUSH_DELIVERY || { fetch }).fetch(sub.endpoint, { ...payload, redirect: 'manual' });
            if ([404, 410].includes(response.status)) await this.removeSubscription(key);
            else if (!response.ok && response.status !== 400 && response.status !== 403) throw new Error('Retry delivery');
          }
          job.cursor = key; job.attempts = 0;
        } catch {
          job.attempts++;
          if (job.attempts < 3) { await this.ctx.storage.put(jobKey, job); await this.ctx.storage.setAlarm(Date.now() + 60000); return; }
          job.cursor = key; job.attempts = 0;
        }
        await this.ctx.storage.put(jobKey, job);
      }
      if (rows.size < 20) await this.ctx.storage.delete(jobKey);
    }
    // Clean up expired credentials without keeping a timer alive on an unused board.
    for (const prefix of ['session:', 'invite:', 'attempt:']) {
      const rows = await this.ctx.storage.list({ prefix });
      for (const [key, value] of rows) if ((value.expires || value.until) < Date.now()) await this.ctx.storage.delete(key);
    }
    if ((await this.ctx.storage.list({ prefix: 'job:', limit: 1 })).size) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
}
