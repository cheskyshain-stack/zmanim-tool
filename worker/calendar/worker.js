import { DurableObject } from 'cloudflare:workers';
import { calendarEvent, calendarSerial } from '../../js/calendar/model.js';
import { calendarAnnouncementText, calendarAnnouncementView, calendarAnnouncementDate, calendarAnnouncementAddedAt, CALENDAR_ANNOUNCEMENT_HISTORY_DAYS } from '../../js/calendar/announcement-model.js';
import { requestedRange, civilDate, shiftDate, midnight } from '../traffic-calendar.js';
import { LC_TEXT_MAILBOX, isLcTextSource, lcTextWording } from '../../js/calendar/lc-text.js';
import { lcTextCalendarScript } from './gmail-bridge.js';
import { calendarSessionExpiration } from './session-expiration.js';
import { calendarReminderSchedule, DEFAULT_CALENDAR_REMINDER_SCHEDULE } from '../../js/calendar/reminder-date.js';
import { nextSimchaReminder, pushEndpoint, pushSubscription, reminderDeviceKey, reminderKeys, reminderRegistrationExpired, runSimchaReminders, scheduleCalendarAlarm, sendCalendarPush } from './simcha-reminders.js';

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
const activityTypes = ['signIns', 'registrations', 'eventsCreated', 'eventsEdited', 'eventsDeleted', 'announcementsPosted', 'announcementsEdited', 'announcementsDeleted', 'announcementOpens'];
const activityFields = (types, at = new Date().toISOString()) => ({ ['activity:' + at + ':' + crypto.randomUUID()]: { at, types } });
const announcementDatePrefix = 'announcement-date-order:';
const announcementDateKey = message => announcementDatePrefix + calendarAnnouncementDate(message) + ':' + String(message.sequence).padStart(16, '0');
async function passwordHash(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail('Use a password with 12 to 200 characters.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: encoder.encode(salt) }, key, 256);
  return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const incoming = !origin && request.method === 'POST' && ['/api/email-import/receive', '/api/sms-import/receive'].includes(new URL(request.url).pathname);
    if (origin !== env.ALLOWED_ORIGIN && !incoming) return json({ error: 'Open the calendar from the shul website.' }, 403);
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let result;
    try { result = await env.CALENDAR.get(env.CALENDAR.idFromName('lakewood-commons')).fetch(request); }
    catch { result = json({ error: 'The calendar is temporarily unavailable. Please try again.' }, 503); }
    const headers = new Headers(result.headers);
    if (!incoming) Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
    return new Response(result.body, { status: result.status, headers });
  },
};

export class CommunityCalendar extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx; this.env = env;
    this.reminderKeys = reminderKeys(env.CALENDAR_REMINDER_VAPID);
    ctx.blockConcurrencyWhile(async () => {
      if (!await ctx.storage.get('config:activity-start')) await ctx.storage.put('config:activity-start', new Date().toISOString());
      if (!await ctx.storage.get('config:announcement-date-index')) {
        let after;
        do {
          const rows = await ctx.storage.list({ prefix: 'announcement-order:', limit: 100, ...(after ? { startAfter: after } : {}) });
          if (!rows.size) break;
          const records = await ctx.storage.get([...rows.values()].map(id => 'announcement:' + id));
          const entries = Object.fromEntries([...records.values()].filter(message => !message.deletedAt).map(message => [announcementDateKey(message), message.id]));
          if (Object.keys(entries).length) await ctx.storage.put(entries);
          after = [...rows.keys()].at(-1);
        } while (after);
        await ctx.storage.put('config:announcement-date-index', 1);
      }
    });
  }
  async activityReport(url) {
    let range; try { range = requestedRange(url.searchParams); } catch (error) { fail(error.message); }
    const startedAt = await this.ctx.storage.get('config:activity-start');
    const rows = range.until > range.since ? await this.ctx.storage.list({ start: 'activity:' + range.since, end: 'activity:' + range.until }) : new Map();
    const counts = Object.fromEntries(activityTypes.map(type => [type, 0]));
    const byDay = Object.fromEntries(range.dates.map(date => [date, { ...counts }]));
    for (const entry of rows.values()) for (const type of entry.types) if (type in counts) { counts[type]++; byDay[civilDate(entry.at)][type]++; }
    return json({ schemaVersion: 1, timezone: range.timezone, range, snapshotAt: range.snapshotAt, startedAt,
      coverage: range.until <= startedAt ? 'not-tracked' : range.since < startedAt ? 'partial' : 'complete', counts, byDay });
  }
  async body(request, maxLength = 24000) {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('Use a JSON request.');
    const reader = request.body?.getReader(); if (!reader) fail('Enter the requested information.');
    const decoder = new TextDecoder(); let text = '', length = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxLength) { await reader.cancel(); fail('This request is too long.', 413); }
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
    await scheduleCalendarAlarm(this.ctx.storage, now + 86400000);
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
    const time = Date.now(), token = random(), expires = calendarSessionExpiration(time);
    const now = new Date(time).toISOString(), key = 'login-stats:' + user.id, old = await this.ctx.storage.get(key);
    const count = (old?.count || 0) + 1;
    await this.ctx.storage.put({ ['session:' + await hash(token)]: { userId: user.id, version: user.version, expires },
      [key]: { count, firstAt: old?.firstAt || now, lastAt: now },
      ['login-history:' + user.id + ':' + String(count).padStart(16, '0')]: { sequence: count, at: now, type },
      ...activityFields(type === 'account-created' && user.role === 'viewer' ? ['signIns', 'registrations'] : ['signIns'], now) });
    await scheduleCalendarAlarm(this.ctx.storage, time + 86400000);
    return { token, expires, ...this.sessionInfo(user) };
  }
  sessionInfo(user) {
    return { user: userView(user), ...(this.reminderKeys ? { reminderPublicKey: this.reminderKeys.publicKey, reminderSchedules: true } : {}) };
  }
  async phoneReminders(request, user, path) {
    const method = request.method, statusOnly = path === '/api/phone-reminders/status' && method === 'POST';
    const scheduleOnly = path === '/api/phone-reminders/schedule' && method === 'PUT';
    const testOnly = path === '/api/phone-reminders/test' && method === 'POST';
    if (!statusOnly && !scheduleOnly && !testOnly && (path !== '/api/phone-reminders' || !['PUT', 'DELETE'].includes(method))) fail('Phone reminder setting not found.', 404);
    if (!this.reminderKeys && method !== 'DELETE') fail('Phone reminders are not available yet.', 503);
    const body = await this.body(request, 4096);
    const enrolling = method === 'PUT' && !scheduleOnly;
    const subscription = enrolling ? pushSubscription(body.subscription) : null;
    const endpoint = enrolling ? subscription?.endpoint : pushEndpoint(body.endpoint);
    if (!endpoint) fail('Use a supported browser to enable phone reminders.');
    const key = await reminderDeviceKey(endpoint), storage = this.ctx.storage;
    if (statusOnly || testOnly) {
      const device = await storage.get(key);
      const owned = device?.userId === user.id && device.version === user.version;
      const enabled = owned && !device.expiredAt;
      if (statusOnly) return json({ enabled, ...(owned ? { expired: !!device.expiredAt, lastDelivery: device.lastDelivery || null } : {}),
        ...(enabled ? { schedule: device.reminderSchedule || DEFAULT_CALENDAR_REMINDER_SCHEDULE, nextAt: await nextSimchaReminder(storage, device.reminderSchedule) } : {}) });
      if (!enabled) fail('Reconnect phone reminders for this device before sending a test alert.', 409);
      await this.limited(request, 'phone-reminder-test:' + user.id, 5);
      const status = await sendCalendarPush(storage, key, device, this.reminderKeys, this.env.ALLOWED_ORIGIN, { test: true }, { ttl: 60, urgency: 'high' });
      const now = Date.now(), expired = reminderRegistrationExpired(status, device, now);
      if (expired) {
        const current = await storage.get(key);
        if (current?.id === device.id) await storage.put(key, { ...current, expiredAt: now });
      }
      return json({ accepted: status >= 200 && status < 300, status, expired });
    }
    await this.limited(request, 'phone-reminders:' + user.id, 30);
    let schedule;
    if (scheduleOnly) {
      try { schedule = calendarReminderSchedule(body.schedule); } catch (error) { fail(error.message); }
    }
    const previousEndpoint = enrolling && body.previousEndpoint !== undefined ? pushEndpoint(body.previousEndpoint) : '';
    if (enrolling && body.previousEndpoint !== undefined && !previousEndpoint) fail('The previous phone registration is invalid.');
    const previousKey = previousEndpoint && previousEndpoint !== endpoint ? await reminderDeviceKey(previousEndpoint) : '';
    const result = await storage.transaction(async transaction => {
      const current = await transaction.get(key);
      if (method === 'DELETE') {
        if (current?.userId === user.id) await transaction.delete(key);
        return { enabled: false };
      }
      const sameDevice = current?.userId === user.id && current.version === user.version;
      const now = Date.now();
      if (scheduleOnly) {
        if (!sameDevice || current.expiredAt) fail('Turn on reminders for this phone before setting times.', 403);
        if (schedule.revision !== (current.reminderSchedule?.revision || 0)) fail('The reminder times changed in another tab. Reopen them before saving.', 409);
        const updated = { ...schedule, revision: schedule.revision + 1, effectiveAt: now };
        await transaction.put(key, { ...current, id: crypto.randomUUID(), reminderSchedule: updated });
        await scheduleCalendarAlarm(transaction, now + 1000);
        return { schedule: updated };
      }
      if (sameDevice && current.expiredAt) fail('Reconnect phone reminders to create a new registration.', 409);
      const previous = previousKey && await transaction.get(previousKey);
      const replaced = previous?.userId === user.id && previous.version === user.version ? previous : null;
      if (!sameDevice && !replaced) {
        const devices = await transaction.list({ prefix: 'simcha-phone:' });
        const owned = [...devices].filter(([, device]) => device.userId === user.id && device.version === user.version);
        if (owned.length >= 5) {
          const expired = owned.find(([, device]) => device.expiredAt);
          if (!expired) fail('Turn off reminders on another device before adding this one.', 409);
          await transaction.delete(expired[0]);
        }
      }
      if (replaced) await transaction.delete(previousKey);
      const retained = sameDevice ? current : replaced?.reminderSchedule ? { reminderSchedule: replaced.reminderSchedule } : {};
      await transaction.put(key, { ...retained, id: crypto.randomUUID(), userId: user.id, version: user.version, subscription, enabledAt: retained.enabledAt ?? now });
      await scheduleCalendarAlarm(transaction, now + 1000);
      return { enabled: true, schedule: retained.reminderSchedule || DEFAULT_CALENDAR_REMINDER_SCHEDULE };
    });
    return json({ ...result, ...(result.schedule ? { nextAt: await nextSimchaReminder(storage, result.schedule) } : {}) });
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
  announcementHistorySince(user, url) {
    return user.role === 'viewer' || url?.searchParams.get('view') === 'congregation'
      ? new Date(midnight(shiftDate(civilDate(Date.now()), 1 - CALENDAR_ANNOUNCEMENT_HISTORY_DAYS))).toISOString() : null;
  }
  async announcementStatus(user, url) {
    const total = await this.ctx.storage.get('announcement-count') || 0;
    const prefix = 'announcement-read:' + user.id + ':';
    const read = await this.ctx.storage.list({ prefix }), deleted = await this.ctx.storage.list({ prefix: 'announcement-deleted:' });
    const seen = new Set([...read.keys()].map(key => key.slice(prefix.length)));
    for (const key of deleted.keys()) seen.add(key.slice('announcement-deleted:'.length));
    const admin = ['owner', 'editor'].includes(user.role);
    const historySince = this.announcementHistorySince(user, url);
    const unread = historySince ? [...(await this.ctx.storage.list({ prefix: announcementDatePrefix, start: announcementDatePrefix + historySince })).values()].filter(id => !seen.has(id)).length : Math.max(0, total - seen.size);
    this.statusTime = Math.max(Date.now(), (this.statusTime || 0) + 1);
    return { total, unread, deletedCount: deleted.size, editCount: await this.ctx.storage.get('announcement-edit-count') || 0, canPost: admin, canDelete: admin, canEdit: admin,
      dateEditing: true, chronological: true, historyDays: historySince ? CALENDAR_ANNOUNCEMENT_HISTORY_DAYS : null, historySince, snapshotAt: new Date(this.statusTime).toISOString() };
  }
  async announcements(request, user, url) {
    const storage = this.ctx.storage, method = request.method, status = () => this.announcementStatus(user, url);
    const historySince = this.announcementHistorySince(user, url);
    if (url.pathname === '/api/announcements/status' && method === 'GET') return json(await status());
    if (url.pathname === '/api/announcements/updates' && method === 'GET') {
      const after = url.searchParams.get('after') || '0';
      if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after))) fail('Choose a valid announcement update.');
      const prefix = 'announcement-edit-order:';
      const rows = await storage.list({ prefix, startAfter: prefix + String(Number(after)).padStart(16, '0'), limit: 101 });
      const batch = [...rows].slice(0, 100), ids = [...new Set(batch.map(([, id]) => id))];
      const records = ids.length ? await storage.get(ids.map(id => 'announcement:' + id)) : new Map();
      const values = [...records.values()].filter(message => !message.deletedAt);
      const read = await storage.list({ prefix: 'announcement-read:' + user.id + ':' });
      return json({ messages: values.filter(message => !historySince || calendarAnnouncementDate(message) >= historySince).map(message => ({ ...calendarAnnouncementView(message), read: read.has('announcement-read:' + user.id + ':' + message.id) })),
        hiddenIds: values.filter(message => historySince && calendarAnnouncementDate(message) < historySince).map(message => message.id),
        nextAfter: rows.size > 100 ? Number(batch.at(-1)[0].slice(prefix.length)) : null,
        editCount: await storage.get('announcement-edit-count') || 0 });
    }
    if (url.pathname === '/api/announcements/open' && method === 'POST') {
      const body = await this.body(request);
      if (typeof body.id !== 'string' || !identifier(body.id)) fail('Choose a valid announcement opening.');
      const key = 'activity-open:' + user.id + ':' + body.id;
      const recorded = await storage.get(key);
      if (!recorded) await this.limited(request, 'announcement-open', 120);
      const page = new URL('/api/announcements' + url.search, url);
      const response = await this.announcements(new Request(page, { headers: request.headers }), user, page);
      if (!recorded) await storage.put({ [key]: true, ...activityFields(['announcementOpens']) });
      return response;
    }
    if (url.pathname === '/api/announcements/deleted' && method === 'GET') {
      const rows = await storage.list({ prefix: 'announcement-deleted:' });
      return json({ ids: [...rows.keys()].map(key => key.slice('announcement-deleted:'.length)), deletedCount: rows.size });
    }
    const removal = /^\/api\/announcements\/([^/]+)$/.exec(url.pathname);
    if (removal && method === 'PUT') {
      if (!['owner', 'editor'].includes(user.role)) fail('Only calendar admins can edit announcements.', 403);
      const id = removal[1]; if (!identifier(id)) fail('Choose a valid announcement.');
      const key = 'announcement:' + id, old = await storage.get(key);
      if (!old || old.deletedAt) fail('That announcement was not found.', 404);
      const body = await this.body(request, old.authorId === 'shul-sms-import' ? 128000 : 24000);
      if (typeof body.operationId !== 'string' || !identifier(body.operationId)) fail('Reload the announcement editor and try again.');
      let text; try { text = calendarAnnouncementText(body.text, old.authorId === 'shul-sms-import' ? 16000 : 4000); } catch (error) { fail(error.message); }
      let addedAt; try { addedAt = body.addedAt === undefined ? calendarAnnouncementDate(old) : calendarAnnouncementAddedAt(body.addedAt); } catch (error) { fail(error.message); }
      if (old.lastEditId === body.operationId) {
        if (old.updatedBy !== user.id || old.text !== text || calendarAnnouncementDate(old) !== addedAt) fail('This edit was already saved with different information.', 409);
        return json({ message: calendarAnnouncementView(old), ...await status() });
      }
      if (body.revision !== (old.revision || 1)) fail('This announcement changed. Cancel and reopen Edit before saving.', 409);
      if (text === old.text && addedAt === calendarAnnouncementDate(old)) return json({ message: calendarAnnouncementView(old), ...await status() });
      await this.limited(request, 'announcement-write', 60);
      const now = new Date().toISOString(), editSequence = (await storage.get('announcement-edit-count') || 0) + 1;
      const message = { ...old, text, addedAt, authorName: 'Shul', revision: (old.revision || 1) + 1, updatedAt: now, updatedBy: user.id, lastEditId: body.operationId };
      await storage.transaction(async transaction => {
        await transaction.delete(announcementDateKey(old));
        await transaction.put({ [key]: message, [announcementDateKey(message)]: id, 'announcement-edit-count': editSequence,
          ['announcement-edit-order:' + String(editSequence).padStart(16, '0')]: id, ...activityFields(['announcementsEdited'], now) });
      });
      return json({ message: calendarAnnouncementView(message), ...await status() });
    }
    if (removal && method === 'DELETE') {
      if (!['owner', 'editor'].includes(user.role)) fail('Only calendar admins can delete announcements.', 403);
      const id = removal[1]; if (!identifier(id)) fail('Choose a valid announcement.');
      const key = 'announcement:' + id, message = await storage.get(key);
      if (!message) fail('That announcement was not found.', 404);
      if (!message.deletedAt) {
        await this.limited(request, 'announcement-write', 60);
        const deletion = { id, sequence: message.sequence, deletedAt: new Date().toISOString(), deletedBy: user.id };
        await storage.transaction(async transaction => {
          await transaction.put({ [key]: { ...message, ...deletion }, ['announcement-deleted:' + id]: deletion, ...activityFields(['announcementsDeleted'], deletion.deletedAt) });
          await transaction.delete('announcement-order:' + String(message.sequence).padStart(16, '0'));
          await transaction.delete(announcementDateKey(message));
        });
      }
      return json({ removed: true, id, ...await status() });
    }
    if (url.pathname === '/api/announcements/read' && method === 'POST') {
      const body = await this.body(request);
      if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some(id => typeof id !== 'string' || !identifier(id))) fail('Choose valid announcements to mark as read.');
      const ids = [...new Set(body.ids)], messages = ids.length ? await storage.get(ids.map(id => 'announcement:' + id)) : new Map();
      if (ids.some(id => !messages.has('announcement:' + id))) fail('An announcement was not found.', 404);
      if (ids.length) await storage.put(Object.fromEntries(ids.map(id => ['announcement-read:' + user.id + ':' + id, messages.get('announcement:' + id).sequence])));
      return json(await status());
    }
    if (url.pathname !== '/api/announcements') return json({ error: 'Announcement page not found.' }, 404);
    if (method === 'POST') {
      if (!['owner', 'editor'].includes(user.role)) fail('Only calendar admins can post announcements.', 403);
      const body = await this.body(request);
      if (typeof body.id !== 'string' || !identifier(body.id)) fail('Reload the announcement form and try again.');
      let text; try { text = calendarAnnouncementText(body.text); } catch (error) { fail(error.message); }
      let addedAt; try { addedAt = body.addedAt === undefined ? null : calendarAnnouncementAddedAt(body.addedAt); } catch (error) { fail(error.message); }
      const key = 'announcement:' + body.id, old = await storage.get(key);
      if (old) {
        if (old.deletedAt) fail('This announcement was deleted. Create a new post to share a new update.', 409);
        if (old.authorId !== user.id || old.text !== text || addedAt && calendarAnnouncementDate(old) !== addedAt) fail('This announcement was already posted with different information. Refresh the feed.', 409);
        return json({ message: calendarAnnouncementView(old), ...await status() });
      }
      await this.limited(request, 'announcement-write', 60);
      const sequence = (await storage.get('announcement-count') || 0) + 1;
      const message = { id: body.id, sequence, text, authorId: user.id, authorName: 'Shul', revision: 1, createdAt: new Date().toISOString(), ...(addedAt ? { addedAt } : {}) };
      await storage.put({ [key]: message, ['announcement-order:' + String(sequence).padStart(16, '0')]: body.id,
        [announcementDateKey(message)]: body.id,
        ['announcement-read:' + user.id + ':' + body.id]: sequence, 'announcement-count': sequence, ...activityFields(['announcementsPosted'], message.createdAt) });
      return json({ message: calendarAnnouncementView(message), ...await status() }, 201);
    }
    if (method === 'GET') {
      const before = url.searchParams.get('before');
      if (before !== null && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))) fail('Choose a valid announcement page.');
      let cursor = url.searchParams.get('cursor');
      if (cursor !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:\d{16}$/.test(cursor)) fail('Choose a valid announcement page.');
      if (before !== null && cursor === null) {
        const id = await storage.get('announcement-order:' + before.padStart(16, '0'));
        const previous = id && await storage.get('announcement:' + id);
        if (!previous) fail('This announcement page changed. Reload the feed.', 409);
        cursor = announcementDateKey(previous).slice(announcementDatePrefix.length);
      }
      const rows = historySince && cursor && cursor < historySince ? new Map() : await storage.list({ prefix: announcementDatePrefix, reverse: true, limit: 31,
        ...(historySince ? { start: announcementDatePrefix + historySince } : {}), ...(cursor ? { end: announcementDatePrefix + cursor } : {}) });
      const ids = [...rows.values()].slice(0, 30), records = ids.length ? await storage.get(ids.map(id => 'announcement:' + id)) : new Map();
      const read = await storage.list({ prefix: 'announcement-read:' + user.id + ':' });
      const messages = ids.map(id => ({ ...calendarAnnouncementView(records.get('announcement:' + id)), read: read.has('announcement-read:' + user.id + ':' + id) }));
      return json({ messages, nextBefore: rows.size > 30 ? messages.at(-1).sequence : null,
        nextCursor: rows.size > 30 ? [...rows.keys()][29].slice(announcementDatePrefix.length) : null, ...await status() });
    }
    return json({ error: 'Announcement page not found.' }, 404);
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.route(request); }
      catch (error) { return json({ error: error.status ? error.message : 'The calendar request could not be completed.' }, error.status || 500); }
    });
  }
  emailConnectionView(record) {
    const { keyHash, ...value } = record || { enabled: false, revision: 0, importedCount: 0, reviewCount: 0 };
    return { ...value, mailbox: LC_TEXT_MAILBOX, sender: 'Lc Text (848) 356-4187' };
  }
  smsConnectionView(record) {
    const { keyHash, ...value } = record || { enabled: false, revision: 0, importedCount: 0 };
    return value;
  }
  async manageSms(request, url) {
    const storage = this.ctx.storage, config = await storage.get('config:sms-import');
    if (request.method === 'GET') return json({ connection: this.smsConnectionView(config) });
    if (!['POST', 'DELETE'].includes(request.method)) return json({ error: 'SMS connection page not found.' }, 404);
    const body = await this.body(request);
    if (body.revision !== (config?.revision || 0)) fail('This connection changed. Refresh before changing it.', 409);
    await this.limited(request, 'sms-inbox-setup', 30);
    const token = request.method === 'POST' ? random() : '';
    const next = { ...config, enabled: !!token, keyHash: token ? await hash(token) : '', revision: (config?.revision || 0) + 1,
      importedCount: config?.importedCount || 0, ...(token ? { configuredAt: new Date().toISOString(), lastCheckedAt: null } : {}) };
    await storage.put('config:sms-import', next);
    return json({ connection: this.smsConnectionView(next), ...(token ? { key: token, endpoint: url.origin } : {}) });
  }
  async receiveSms(request) {
    const storage = this.ctx.storage, config = await storage.get('config:sms-import');
    const key = request.headers.get('X-Calendar-SMS-Key') || '';
    if (!config?.enabled || !/^[a-f0-9]{64}$/.test(key) || !equal(await hash(key), config.keyHash)) fail('This SMS connection is not active.', 401);
    const body = await this.body(request, 128000), now = new Date().toISOString();
    if (body.check === true) {
      await storage.put('config:sms-import', { ...config, lastCheckedAt: now });
      return json({ accepted: true, ready: true });
    }
    if (typeof body.id !== 'string' || !identifier(body.id) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 16000 || body.text.includes('\u0000') || typeof body.receivedAt !== 'string' || !Number.isFinite(Date.parse(body.receivedAt)) || Date.parse(body.receivedAt) < 0 || Date.parse(body.receivedAt) > Date.now() + 300000) fail('The SMS information is invalid.');
    const digest = await hash('shul-sms:' + body.id), receiptKey = 'sms-receipt:' + digest;
    const bodyHash = await hash(body.text), previous = await storage.get(receiptKey);
    if (previous) {
      if (previous.bodyHash !== bodyHash) fail('This SMS was already received with different original text.', 409);
      return json({ accepted: true, posted: true, duplicate: true, announcementId: previous.announcementId });
    }
    await this.limited(request, 'sms-inbox', 1000);
    const id = 'shul-sms-' + digest, sequence = (await storage.get('announcement-count') || 0) + 1;
    const message = { id, sequence, text: body.text, authorId: 'shul-sms-import', authorName: 'Shul', revision: 1, createdAt: new Date(body.receivedAt).toISOString() };
    await storage.transaction(async transaction => {
      await transaction.put({ ['announcement:' + id]: message, ['announcement-order:' + String(sequence).padStart(16, '0')]: id,
        [announcementDateKey(message)]: id,
        'announcement-count': sequence, [receiptKey]: { bodyHash, announcementId: id, receivedAt: now },
        'config:sms-import': { ...config, importedCount: (config.importedCount || 0) + 1, lastCheckedAt: now, lastImportedAt: now },
        ...activityFields(['announcementsPosted'], now) });
    });
    return json({ accepted: true, posted: true, duplicate: false, announcementId: id }, 201);
  }
  async saveImportedEmail(receipt, text, config) {
    const storage = this.ctx.storage, id = 'lc-text-' + receipt.digest;
    const sequence = (await storage.get('announcement-count') || 0) + 1, now = new Date().toISOString();
    const message = { id, sequence, text, authorId: 'lc-text-import', authorName: 'Shul', revision: 1, createdAt: receipt.receivedAt };
    const next = { ...config, importedCount: (config.importedCount || 0) + 1, reviewCount: Math.max(0, (config.reviewCount || 0) - (receipt.status === 'review' ? 1 : 0)), lastImportedAt: now };
    await storage.transaction(async transaction => {
      await transaction.put({ ['announcement:' + id]: message, ['announcement-order:' + String(sequence).padStart(16, '0')]: id,
        [announcementDateKey(message)]: id,
        'announcement-count': sequence, ['lc-receipt:' + receipt.digest]: { digest: receipt.digest, receivedAt: receipt.receivedAt, status: 'posted', announcementId: id },
        'config:email-import': next, ...activityFields(['announcementsPosted'], now) });
      await transaction.delete('lc-review:' + receipt.digest);
    });
    return { accepted: true, posted: true };
  }
  async receiveEmail(request) {
    const storage = this.ctx.storage, config = await storage.get('config:email-import');
    const key = request.headers.get('X-Calendar-Inbox-Key') || '';
    if (!config?.enabled || !/^[a-f0-9]{64}$/.test(key) || !equal(await hash(key), config.keyHash)) fail('This inbox connection is not active.', 401);
    await this.limited(request, 'lc-inbox', 1000);
    const body = await this.body(request, 128000);
    if (body.mailbox !== LC_TEXT_MAILBOX) fail('This is not the connected mailbox.', 403);
    const checked = { ...config, lastCheckedAt: new Date().toISOString(), catchingUp: body.catchingUp === true };
    if (body.heartbeat === true) { await storage.put('config:email-import', checked); return json({ accepted: true }); }
    const input = body.message;
    if (!isLcTextSource(input)) return json({ accepted: true, ignored: true });
    if (!/^[a-f0-9]{8,100}$/.test(input.sourceId || '') || typeof input.receivedAt !== 'string' || !Number.isFinite(Date.parse(input.receivedAt)) || Date.parse(input.receivedAt) < 0 || Date.parse(input.receivedAt) > Date.now() + 300000 || typeof input.text !== 'string' || input.text.length > 20000) fail('The source email information is invalid.');
    const digest = await hash(LC_TEXT_MAILBOX + ':' + input.sourceId), old = await storage.get('lc-receipt:' + digest);
    if (old) return json({ accepted: true, duplicate: true, needsReview: old.status === 'review' });
    const receipt = { digest, receivedAt: new Date(input.receivedAt).toISOString() };
    let text;
    try { text = lcTextWording(input); }
    catch (error) {
      if ((config.reviewCount || 0) >= 1000) fail('Review the waiting LC Text messages before importing more.', 409);
      await storage.put({ ['lc-receipt:' + digest]: { ...receipt, status: 'review' }, ['lc-review:' + digest]: { ...receipt, reason: error.message, text: input.text, sourceId: input.sourceId },
        'config:email-import': { ...checked, catchingUp: config.catchingUp, reviewCount: (config.reviewCount || 0) + 1 } });
      return json({ accepted: true, needsReview: true });
    }
    return json(await this.saveImportedEmail(receipt, text, { ...checked, catchingUp: config.catchingUp }));
  }
  async manageEmail(request, url) {
    const storage = this.ctx.storage, method = request.method, config = await storage.get('config:email-import');
    if (url.pathname === '/api/email-import' && method === 'GET') return json({ connection: this.emailConnectionView(config) });
    if (url.pathname === '/api/email-import' && ['POST', 'DELETE'].includes(method)) {
      const body = await this.body(request);
      if (body.revision !== (config?.revision || 0)) fail('This connection changed. Refresh before changing it.', 409);
      await this.limited(request, 'lc-inbox-setup', 30);
      const token = method === 'POST' ? random() : '';
      const next = { ...config, enabled: method === 'POST', revision: (config?.revision || 0) + 1, keyHash: token ? await hash(token) : '',
        ...(token ? { configuredAt: new Date().toISOString(), lastCheckedAt: null, catchingUp: false } : {}), importedCount: config?.importedCount || 0, reviewCount: config?.reviewCount || 0 };
      if (method === 'POST' && typeof body.includeExisting !== 'boolean') fail('Choose whether to include earlier messages.');
      await storage.put('config:email-import', next);
      return json({ connection: this.emailConnectionView(next), ...(token ? { script: lcTextCalendarScript({ endpoint: url.origin, token, includeExisting: body.includeExisting }) } : {}) });
    }
    if (url.pathname === '/api/email-import/review' && method === 'GET') {
      const after = url.searchParams.get('after');
      if (after !== null && !/^[a-f0-9]{64}$/.test(after)) fail('Choose a valid review page.');
      const rows = [...await storage.list({ prefix: 'lc-review:', limit: 21, ...(after ? { startAfter: 'lc-review:' + after } : {}) })].slice(0, 21);
      return json({ messages: rows.slice(0, 20).map(([, row]) => row), nextAfter: rows.length > 20 ? rows[19][1].digest : null });
    }
    const review = /^\/api\/email-import\/review\/([a-f0-9]{64})$/.exec(url.pathname);
    if (review && method === 'POST') {
      const body = await this.body(request), key = 'lc-review:' + review[1], receipt = await storage.get('lc-receipt:' + review[1]);
      if (!['post', 'skip'].includes(body.action)) fail('Choose Post or Skip.');
      if (!receipt) fail('This message was not found.', 404);
      if (receipt.status !== 'review') return json({ accepted: true, resolved: true });
      await this.limited(request, 'lc-inbox-review', 120);
      if (body.action === 'post') {
        let text; try { text = calendarAnnouncementText(body.text); } catch (error) { fail(error.message); }
        return json(await this.saveImportedEmail(receipt, text, config));
      }
      await storage.transaction(async transaction => {
        await transaction.put({ ['lc-receipt:' + review[1]]: { ...receipt, status: 'skipped' }, 'config:email-import': { ...config, reviewCount: Math.max(0, (config.reviewCount || 0) - 1) } });
        await transaction.delete(key);
      });
      return json({ accepted: true, skipped: true });
    }
    return json({ error: 'Inbox page not found.' }, 404);
  }
  async route(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (path === '/api/info' && method === 'GET') return json({ ready: !!await this.ctx.storage.get('config:owner'), private: true, accounts: true, announcements: true, announcementDeletion: true, announcementEditing: true, announcementDateEditing: true, announcementHistoryDays: CALENDAR_ANNOUNCEMENT_HISTORY_DAYS, loginHistory: true, selfRegistration: true, activityStatistics: true, customCategories: true, optionalEventTimes: true, emailImport: true, smsImport: true, phoneReminders: !!this.reminderKeys, reminderSchedules: !!this.reminderKeys, phoneReminderTest: !!this.reminderKeys });
    if (path === '/api/email-import/receive' && method === 'POST') return this.receiveEmail(request);
    if (path === '/api/sms-import/receive' && method === 'POST') return this.receiveSms(request);
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
    const user = await this.signedIn(request, path.startsWith('/api/access') || path === '/api/activity' || path === '/api/sms-import' || path === '/api/email-import' || path.startsWith('/api/email-import/'));
    if (path === '/api/sms-import') return this.manageSms(request, url);
    if (path === '/api/email-import' || path.startsWith('/api/email-import/')) return this.manageEmail(request, url);
    if (path === '/api/activity' && method === 'GET') return this.activityReport(url);
    if ((path === '/api/access/activity' || path.startsWith('/api/access/activity/')) && method === 'GET') return this.loginActivity(url);
    if (path === '/api/announcements' || path.startsWith('/api/announcements/')) return this.announcements(request, user, url);
    if (path === '/api/phone-reminders' || path.startsWith('/api/phone-reminders/')) return this.phoneReminders(request, user, path);
    if (path === '/api/session' && method === 'GET') return json(this.sessionInfo(user));
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
          await transaction.put({ ['deleted-event:' + entry[1]]: { revision: old.revision + 1, deletedAt: now }, ...activityFields(['eventsDeleted'], now) });
          await transaction.delete(key);
        });
        return json({ removed: true });
      }
      if (!old && (await this.ctx.storage.list({ prefix: 'event:', limit: 2000 })).size >= 2000) fail('Remove unused or past events before adding more. This calendar has reached its event limit.', 409);
      let fields;
      try { fields = calendarEvent({ ...body, reminder: body.reminder ?? old?.reminder }); } catch (error) { fail(error.message); }
      const event = { ...fields, id: entry[1], revision: (old?.revision || 0) + 1,
        createdAt: old?.createdAt || now, createdBy: old?.createdBy || user.id, updatedAt: now, updatedBy: user.id };
      if (event.reminder) {
        const sameSchedule = old?.reminder === event.reminder && old.type === event.type && old.date === event.date;
        event.reminderChangedAt = sameSchedule ? old.reminderChangedAt || 0 : Date.parse(now);
      }
      await this.ctx.storage.transaction(async transaction => {
        const current = await transaction.get(key);
        if ((current?.revision || 0) !== body.revision || await transaction.get('deleted-event:' + entry[1])) fail('This event changed in another session. Reload the month before saving.', 409);
        await transaction.put({ [key]: event, ...activityFields([old ? 'eventsEdited' : 'eventsCreated'], now) });
        if (this.reminderKeys && event.reminder) await scheduleCalendarAlarm(transaction, Date.now() + 1000);
      });
      return json({ event }, old ? 200 : 201);
    }
    return json({ error: 'Calendar page not found.' }, 404);
  }
  async alarm() {
    const now = Date.now(), storage = this.ctx.storage;
    let cleanup = await storage.get('config:calendar-cleanup') || 0;
    if (cleanup <= now) {
      for (const prefix of ['session:', 'attempt:', 'invite:']) {
        const rows = await storage.list({ prefix });
        const expired = [...rows].filter(([, value]) => (value.expires || value.until) <= now).map(([key]) => key);
        for (let i = 0; i < expired.length; i += 100) await storage.delete(expired.slice(i, i + 100));
      }
      cleanup = now + 86400000;
      await storage.put('config:calendar-cleanup', cleanup);
    }
    const next = this.reminderKeys ? await runSimchaReminders(storage, this.reminderKeys, this.env.ALLOWED_ORIGIN, now) : Infinity;
    await scheduleCalendarAlarm(storage, Math.min(cleanup, next));
  }
}
