import { calendarPhoneDevicePrefix, reminderRegistrationExpired, sendCalendarPush } from './simcha-reminders.js';

const queuePrefix = 'message-alert:';
const messageAlertLifetime = 60 * 60 * 1000;
const messageAlertBatch = 6;

export function queueCalendarMessageAlert(message, receivedAt, now = Date.now()) {
  return { [queuePrefix + String(message.sequence).padStart(16, '0')]: { id: message.id, sequence: message.sequence, receivedAt, expires: now + messageAlertLifetime } };
}

export async function runCalendarMessageAlerts(storage, keys, origin, now = Date.now(), send = fetch) {
  const queue = await storage.list({ prefix: queuePrefix });
  const expired = [...queue].filter(([, message]) => message.expires <= now).map(([key]) => key);
  for (let i = 0; i < expired.length; i += 100) await storage.delete(expired.slice(i, i + 100));
  const messages = [...queue.values()].filter(message => message.expires > now);
  if (!messages.length) return Infinity;
  const devices = await storage.list({ prefix: calendarPhoneDevicePrefix });
  const jobs = [];
  let next = messages[0].expires;
  for (const [key, device] of devices) {
    if (device.messageAlertAfter == null || device.expiredAt) continue;
    const message = messages.find(item => item.sequence > device.messageAlertAfter && item.receivedAt >= device.messageAlertsSince);
    if (!message) continue;
    const retry = device.messageAlertRetry;
    if (retry?.sequence === message.sequence && retry.at > now) {
      next = Math.min(next, retry.at);
      continue;
    }
    if (jobs.length === messageAlertBatch) { next = Math.min(next, now + 1000); break; }
    jobs.push({ key, device, message });
  }
  const progress = await Promise.all(jobs.map(async ({ key, device, message }) => {
    const [user, announcement] = await Promise.all([storage.get('user:' + device.userId), storage.get('announcement:' + message.id)]);
    if (!user?.active || user.version !== device.version) {
      if ((await storage.get(key))?.id === device.id) await storage.delete(key);
      return Infinity;
    }
    const status = announcement && !announcement.deletedAt ? await sendCalendarPush(storage, key, device, keys, origin,
      { messageAlert: true, sequence: message.sequence },
      { ttl: Math.max(1, Math.floor((message.expires - now) / 1000)), urgency: 'high', topic: 'shul-message-' + message.sequence }, send) : 204;
    const current = await storage.get(key);
    if (current?.id !== device.id) return Infinity;
    if (reminderRegistrationExpired(status, device, now)) {
      await storage.put(key, { ...current, expiredAt: now });
      return Infinity;
    }
    const previous = current.messageAlertRetry;
    const attempts = previous?.sequence === message.sequence ? previous.attempts + 1 : 1;
    const retryAt = now + attempts * 30000;
    if ((!status || status === 404 || status === 410 || status === 429 || status >= 500) && attempts < 3 && retryAt < message.expires) {
      await storage.put(key, { ...current, messageAlertRetry: { sequence: message.sequence, attempts, at: retryAt } });
      return retryAt;
    }
    const { messageAlertRetry, ...updated } = current;
    await storage.put(key, { ...updated, messageAlertAfter: message.sequence });
    return messages.at(-1).sequence > message.sequence ? now + 1000 : Infinity;
  }));
  return Math.min(next, ...progress);
}
