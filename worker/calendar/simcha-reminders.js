import { buildPushPayload } from '@block65/webcrypto-web-push';
import { calendarReminderDate } from '../../js/calendar/reminder-date.js';
import { civilDate, shiftDate, midnight, HOUR } from '../traffic-calendar.js';

const devicePrefix = 'simcha-phone:';
const runKey = 'config:simcha-reminder-run';
const batchSize = 16;
const decode = value => atob(value.replaceAll('-', '+').replaceAll('_', '/'));
const keyPart = /^[A-Za-z0-9_-]{43}$/;

export function reminderKeys(secret) {
  try {
    const privateJWK = JSON.parse(secret);
    if (privateJWK.kty !== 'EC' || privateJWK.crv !== 'P-256' || ![privateJWK.x, privateJWK.y, privateJWK.d].every(value => typeof value === 'string' && keyPart.test(value))) return null;
    const publicKey = btoa('\x04' + decode(privateJWK.x) + decode(privateJWK.y)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return { privateKey: privateJWK.d, publicKey };
  } catch { return null; }
}

export function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    const supported = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname)
      || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
    return supported && url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash ? url.href : '';
  } catch { return ''; }
}

export function pushSubscription(value) {
  const endpoint = pushEndpoint(value?.endpoint), keys = value?.keys;
  if (!endpoint || typeof keys?.auth !== 'string' || typeof keys.p256dh !== 'string'
    || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth) || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh)
    || decode(keys.p256dh).charCodeAt(0) !== 4) return null;
  return { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } };
}

export async function reminderDeviceKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return devicePrefix + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function simchaReminderAt(event) {
  const date = calendarReminderDate(event.date, event.reminder);
  // Use the offset after the overnight clock change on daylight-saving Sundays.
  return date ? midnight(shiftDate(date, 1)) - 15 * HOUR : Infinity;
}

export async function scheduleCalendarAlarm(storage, time) {
  if (!Number.isFinite(time)) return;
  const alarm = await storage.getAlarm();
  if (alarm === null || time < alarm) await storage.setAlarm(time);
}

async function sendToDevice(storage, key, device, due, day, keys, origin, ttl, send) {
  if (device.lastSent === day) return true;
  const user = await storage.get('user:' + device.userId);
  if (!user?.active || user.version !== device.version) {
    if ((await storage.get(key))?.id === device.id) await storage.delete(key);
    return true;
  }
  const own = user.role !== 'viewer' && due.find(event => event.createdBy === user.id);
  const payload = { date: (own || due[0]).date, post: Boolean(own), day };
  let request;
  try {
    request = await buildPushPayload({ data: payload, options: { ttl, urgency: 'normal', topic: 'simcha-' + day } }, device.subscription, { ...keys, subject: origin });
  } catch { return false; }
  if ((await storage.get(key))?.id !== device.id) return true;
  let response;
  try { response = await send(device.subscription.endpoint, { ...request, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { return false; }
  await response.body?.cancel();
  const current = await storage.get(key);
  if (current?.id !== device.id) return true;
  if (response.ok) { await storage.put(key, { ...current, lastSent: day }); return true; }
  if (response.status === 404 || response.status === 410) { await storage.delete(key); return true; }
  return false;
}

export async function runSimchaReminders(storage, keys, origin, now = Date.now(), send = fetch) {
  const day = civilDate(now), morning = midnight(shiftDate(day, 1)) - 15 * HOUR;
  const deadline = morning + 2 * HOUR;
  const due = [];
  let next = Infinity;
  for (const event of (await storage.list({ prefix: 'event:' })).values()) {
    if (event.deletedAt || !event.reminder) continue;
    const at = simchaReminderAt(event);
    if (at > now) next = Math.min(next, at);
    else if (at === morning && now < deadline) due.push(event);
  }
  if (!due.length) return next;
  due.sort((a, b) => a.date.localeCompare(b.date));
  const saved = await storage.get(runKey);
  const run = saved?.day === day ? saved : { day, attempts: 0, after: '', retry: false };
  if (run.done) return next;
  if (run.resumeAt > now) return Math.min(run.resumeAt, next);
  const devices = await storage.list({ prefix: devicePrefix, ...(run.after ? { startAfter: run.after } : {}), limit: batchSize });
  const ttl = Math.max(1, Math.floor((deadline - now) / 1000));
  const results = await Promise.all([...devices].map(([key, device]) => sendToDevice(storage, key, device, due, day, keys, origin, ttl, send)));
  const retry = run.retry || results.some(result => !result);
  if (devices.size === batchSize) {
    await storage.put(runKey, { ...run, retry, after: [...devices.keys()].at(-1) });
    return Math.min(Date.now() + 1000, next);
  }
  if (retry && run.attempts < 2 && now + 300000 < deadline) {
    const resumeAt = now + 300000;
    await storage.put(runKey, { day, attempts: run.attempts + 1, after: '', retry: false, resumeAt });
    return Math.min(resumeAt, next);
  }
  await storage.put(runKey, { day, done: true });
  return next;
}
