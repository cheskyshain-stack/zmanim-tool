const shulSessionClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

export function shulSessionExpiration(signedInAt) {
  const hour = 3600000, day = 24 * hour;
  const earliest = signedInAt + 7 * day;
  const parts = Object.fromEntries(shulSessionClock.formatToParts(earliest).map(({ type, value }) => [type, value]));
  const firstDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 7);
  // In New York, 3 a.m. is 07:00 or 08:00 UTC, even on clock-change days.
  for (const at of [firstDay, firstDay + hour, firstDay + day, firstDay + day + hour]) {
    if (at >= earliest && shulSessionClock.formatToParts(at).some(part => part.type === 'hour' && part.value === '03')) return at;
  }
  throw new Error('Could not determine the New York session expiration.');
}
