const seatsChartDateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const seatsChartNameKey = value => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

function seatsChartDate(value) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function seatsDatedChartName(value = new Date(), usedNames = []) {
  const date = seatsChartDate(value) || new Date();
  const base = 'Seating plan - ' + seatsChartDateFormat.format(date);
  const used = new Set(usedNames.map(seatsChartNameKey));
  if (!used.has(seatsChartNameKey(base))) return base;
  let suffix = 2;
  while (used.has(seatsChartNameKey(base + ' (' + suffix + ')'))) suffix++;
  return base + ' (' + suffix + ')';
}

export function seatsIsRoomChartName(value) {
  return typeof value === 'string' && /^(?:7\s*:\s*30(?:\s+(?:מנין|מניין|minyan))?|main\s+shul)$/iu.test(value.trim());
}

export function seatsChartName(name, metadata = {}, now = new Date(), usedNames = []) {
  if (!seatsIsRoomChartName(name)) return name;
  return seatsDatedChartName(seatsChartDate(metadata?.updatedAt) || seatsChartDate(metadata?.createdAt) || now, usedNames);
}
