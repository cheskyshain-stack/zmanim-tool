// Traffic belongs to the shul's clock, independently of the administrator's device.
export const TIMEZONE = 'America/New_York';
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const MAX_DAYS = 800;
const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function civilDate(instant) {
  const parts = Object.fromEntries(civilFormatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+at) && at.toISOString().slice(0, 10) === value;
}

export function shiftDate(date, amount) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
}

export function datesBetween(start, end) {
  const dates = [];
  for (let at = start; at <= end && dates.length <= MAX_DAYS + 2; at = shiftDate(at, 1)) dates.push(at);
  return dates;
}

// New York's modern midnight is either 04:00 or 05:00 UTC. Select the candidate
// whose local date begins there, including 23-hour and 25-hour DST days.
export function midnight(date) {
  const base = Date.parse(`${date}T00:00:00Z`);
  for (const hours of [4, 5]) {
    const instant = base + hours * HOUR;
    if (civilDate(instant) === date && civilDate(instant - 1) !== date) return instant;
  }
  throw new Error('Date is outside the supported New York calendar.');
}

export function requestedRange(params, now = Date.now()) {
  const rawAsOf = params.get('asOf');
  const requestedAsOf = rawAsOf ? Date.parse(rawAsOf) : now;
  if (!Number.isFinite(requestedAsOf) || requestedAsOf > now + 120000 || requestedAsOf < Date.parse('2000-01-01T00:00:00Z')) {
    throw new Error('asOf must be a valid past or current timestamp.');
  }
  // A phone clock a few seconds ahead must not break the dashboard. The caller
  // adopts snapshotAt when adjusted, keeping later range changes on this anchor.
  const asOf = Math.min(requestedAsOf, now);
  const today = civilDate(asOf);
  let start = params.get('start') || params.get('from');
  let end = params.get('end') || params.get('to');
  let since;
  let until;
  if (params.has('since') || params.has('until')) {
    since = Date.parse(params.get('since'));
    until = Date.parse(params.get('until'));
    if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || since % HOUR || until % HOUR) {
      throw new Error('since and until must be ordered whole-hour timestamps. Use start and end for New York dates.');
    }
    start = civilDate(since);
    end = civilDate(until - 1);
    if (since !== midnight(start) || until !== midnight(shiftDate(end, 1))) {
      throw new Error('The window must cover whole New York dates. Use start and end.');
    }
  } else {
    if (params.has('date')) start = end = params.get('date');
    if (!start && !end) {
      const days = params.has('days') ? Number(params.get('days')) : 7;
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`days must be from 1 to ${MAX_DAYS}.`);
      end = today;
      start = shiftDate(end, 1 - days);
    }
    if (!validDate(start) || !validDate(end) || start > end) throw new Error('Choose valid start and end dates in order.');
    since = midnight(start);
    until = midnight(shiftDate(end, 1));
  }
  if (end > today) throw new Error('The end date cannot be after the snapshot date.');
  const dates = datesBetween(start, end);
  if (dates.length > MAX_DAYS) throw new Error(`Choose no more than ${MAX_DAYS} dates.`);
  return {
    start, end, dates, since: new Date(since).toISOString(),
    until: new Date(Math.min(until, asOf)).toISOString(),
    snapshotAt: new Date(asOf).toISOString(), snapshotAdjusted: requestedAsOf > now, timezone: TIMEZONE,
  };
}
