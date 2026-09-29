// Match the congregation card: retain a minyan through five minutes after start.
export const MINYAN_HOLD_MS = 5 * 60000;
export function nextMinyanChangeAt(next) {
  const start = Date.parse(next?.at);
  return Number.isFinite(start) ? new Date(start + MINYAN_HOLD_MS + 1).toISOString() : null;
}
