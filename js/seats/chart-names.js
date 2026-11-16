const seatsChartDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const seatsChartTimeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const seatsChartNameKey = value => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

function seatsChartDate(value) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function seatsDatedChartName(value = new Date(), usedNames = []) {
  const date = seatsChartDate(value) || new Date();
  const base = 'Seating plan - ' + seatsChartDateFormat.format(date) + ' at ' + seatsChartTimeFormat.format(date);
  const used = new Set(usedNames.map(seatsChartNameKey));
  if (!used.has(seatsChartNameKey(base))) return base;
  let suffix = 2;
  while (used.has(seatsChartNameKey(base + ' (' + suffix + ')'))) suffix++;
  return base + ' (' + suffix + ')';
}

export function seatsCopiedChartName(name, usedNames = []) {
  const base = String(name || 'Seating plan').trim(), used = new Set(usedNames.map(seatsChartNameKey));
  for (let number = 1; ; number++) {
    const suffix = number === 1 ? ' (copy)' : ' (copy ' + number + ')';
    const candidate = base.slice(0, 80 - suffix.length).trimEnd() + suffix;
    if (!used.has(seatsChartNameKey(candidate))) return candidate;
  }
}

export function seatsIsRoomChartName(value) {
  return typeof value === 'string' && /^(?:7\s*:\s*30(?:\s+(?:מנין|מניין|minyan))?|main\s+shul)$/iu.test(value.trim());
}

export function seatsChartName(name, metadata = {}, now = new Date(), usedNames = []) {
  if (!seatsIsRoomChartName(name)) return name;
  return seatsDatedChartName(seatsChartDate(metadata?.updatedAt) || seatsChartDate(metadata?.createdAt) || now, usedNames);
}
