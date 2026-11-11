import { buildPushPayload } from '@block65/webcrypto-web-push';
import { calendarReminderShabbos, calendarReminderSlot } from '../../js/calendar/reminder-date.js';
import { civilDate, shiftDate, HOUR, TIMEZONE } from '../traffic-calendar.js';

const devicePrefix = 'simcha-phone:';
const batchSize = 16;
const deliveryWindow = 2 * HOUR;
const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
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

function reminderInstant({ date, time }) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const daylight = wall + 4 * HOUR;
  // Use the first occurrence of a repeated time. Move skipped times forward by one hour.
  return localTime.format(daylight) === time ? daylight : wall + 5 * HOUR;
}

export function simchaReminderAt(event, schedule) {
  const slot = calendarReminderSlot(event, schedule);
  return slot ? reminderInstant(slot) : Infinity;
}

export async function scheduleCalendarAlarm(storage, time) {
  if (!Number.isFinite(time)) return;
  const alarm = await storage.getAlarm();
  if (alarm === null || time < alarm) await storage.setAlarm(time);
}

async function sendToDevice(storage, { key, device, slot }, keys, origin, now, cutoff, send) {
  const user = await storage.get('user:' + device.userId);
  if (!user?.active || user.version !== device.version) {
    if ((await storage.get(key))?.id === device.id) await storage.delete(key);
    return Infinity;
  }
  const { at, events } = slot, deadline = at + deliveryWindow;
  const own = user.role !== 'viewer' && events.find(event => event.createdBy === user.id);
  const payload = { date: (own || events[0]).date, post: Boolean(own), day: slot.day, slot: at };
  const ttl = Math.max(1, Math.floor((deadline - now) / 1000));
  let response;
  try {
    const request = await buildPushPayload({ data: payload, options: { ttl, urgency: 'normal', topic: 'simcha-' + at } }, device.subscription, { ...keys, subject: origin });
    if ((await storage.get(key))?.id !== device.id) return Infinity;
    response = await send(device.subscription.endpoint, { ...request, redirect: 'error', signal: AbortSignal.timeout(12000) });
    await response.body?.cancel();
  } catch { /* Retry when delivery fails. */ }
  const current = await storage.get(key);
  if (current?.id !== device.id) return Infinity;
  if (response?.status === 404 || response?.status === 410) {
    await storage.delete(key);
    return Infinity;
  }
  const sentSlots = (current.sentSlots || []).filter(time => time > cutoff);
  const retries = Object.fromEntries(Object.entries(current.reminderRetries || {}).filter(([time]) => Number(time) > cutoff));
  let next = Infinity;
  if (response?.ok) {
    sentSlots.push(at);
    delete retries[at];
  } else {
    const attempts = (retries[at]?.attempts || 0) + 1;
    const retryAt = attempts < 3 && now + 300000 < deadline ? now + 300000 : 0;
    retries[at] = { attempts, retryAt };
    next = retryAt || Infinity;
  }
  await storage.put(key, { ...current, sentSlots, reminderRetries: retries });
  return next;
}

function reminderEventGroups(events, oldestDate, tomorrow) {
  const nearby = new Map(), future = new Map();
  for (const event of events.values()) {
    if (event.deletedAt || !event.reminder || event.date < oldestDate) continue;
    const kind = `${event.type}:${event.reminder}`;
    if (event.date > tomorrow) {
      const key = `${kind}:${calendarReminderShabbos(event.date)}`;
      if (!future.has(key) || event.date < future.get(key)[0].date) future.set(key, [event]);
    } else {
      const key = `${kind}:${event.date}`;
      if (!nearby.has(key)) nearby.set(key, []);
      nearby.get(key).push(event);
    }
  }
  return [...nearby.values(), ...future.values()];
}

function reminderAgenda(groups, schedule, now, cutoff) {
  const due = new Map();
  let next = Infinity;
  for (const events of groups) {
    const at = simchaReminderAt(events[0], schedule);
    if (at > now) next = Math.min(next, at);
    else if (at > cutoff) {
      const active = events.filter(event => (event.reminderChangedAt || 0) <= at);
      if (!active.length) continue;
      if (!due.has(at)) due.set(at, []);
      due.get(at).push(...active);
    }
  }
  const slots = [...due].sort(([a], [b]) => a - b).map(([at, events]) => ({ at,
    day: civilDate(at), legacyMorning: localTime.format(at) === '09:00', events: events.sort((a, b) => a.date.localeCompare(b.date)),
  }));
  return { next, slots };
}

export async function runSimchaReminders(storage, keys, origin, now = Date.now(), send = fetch) {
  const devices = await storage.list({ prefix: devicePrefix });
  if (!devices.size) return Infinity;
  const cutoff = now - deliveryWindow;
  const groups = reminderEventGroups(await storage.list({ prefix: 'event:' }), civilDate(cutoff), shiftDate(civilDate(now), 1));
  const agendas = new Map(), jobs = [];
  let next = Infinity;
  for (const [key, device] of devices) {
    const schedule = device.reminderSchedule;
    const agendaKey = JSON.stringify([schedule?.standard, schedule?.sameTime === true ? null : schedule?.categories]);
    if (!agendas.has(agendaKey)) agendas.set(agendaKey, reminderAgenda(groups, schedule, now, cutoff));
    const agenda = agendas.get(agendaKey);
    next = Math.min(next, agenda.next);
    let selected = false;
    for (const slot of agenda.slots) {
      if (slot.at < Math.max(device.enabledAt || 0, schedule?.effectiveAt || 0) || device.sentSlots?.includes(slot.at) || slot.legacyMorning && device.lastSent === slot.day) continue;
      const retry = device.reminderRetries?.[slot.at];
      if (retry?.retryAt === 0) continue;
      if (retry?.retryAt > now) { next = Math.min(next, retry.retryAt); continue; }
      if (selected || jobs.length >= batchSize) { next = Math.min(next, now + 1000); break; }
      jobs.push({ key, device, slot });
      selected = true;
    }
  }
  const retries = await Promise.all(jobs.map(job => sendToDevice(storage, job, keys, origin, now, cutoff, send)));
  return Math.min(next, ...retries);
}
