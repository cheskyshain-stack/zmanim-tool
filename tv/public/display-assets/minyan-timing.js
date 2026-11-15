// Match the congregation card: retain a minyan through five minutes after start.
export const MINYAN_HOLD_MS = 5 * 60000;
export function nextMinyanChangeAt(next) {
  const start = Date.parse(next?.at);
  return Number.isFinite(start) ? new Date(start + MINYAN_HOLD_MS + 1).toISOString() : null;
}

// Identify the same source minyan in the large card and the prayer schedule.
export function minyanKey(event) {
  const start = Date.parse(event?.at);
  if (!event || event.auxiliary || !Number.isFinite(start)) return '';
  return JSON.stringify([start,event.name || '',event.place || '']);
}
export function nextMinyanKey(next, instant) {
  const remaining = Date.parse(next?.at) - Date.parse(instant);
  return Number.isFinite(remaining) && remaining >= -MINYAN_HOLD_MS ? minyanKey(next) : '';
}
