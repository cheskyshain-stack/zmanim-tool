// Only the public entry enables this clock, in its own document. Admin and ordinary
// visitors keep real time; choosing a preview never changes shared settings or Date.
export const WEBSITE_PREVIEW_PARAM = 'website-preview';
let websitePreviewMillis = null;

export function enableWebsitePreview(search) {
  const value = new URLSearchParams(search).get(WEBSITE_PREVIEW_PARAM);
  websitePreviewMillis = null;
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const instant = new Date(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== canonical
    || instant.getUTCFullYear() < 1900 || instant.getUTCFullYear() > 2199) return false;
  websitePreviewMillis = instant.getTime();
  return true;
}

export const isWebsitePreview = () => websitePreviewMillis !== null;
export const websiteNow = () => websitePreviewMillis === null ? new Date() : new Date(websitePreviewMillis);

export function websiteLocalFields(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`,
    time: `${String(Number(values.hour) % 24).padStart(2, '0')}:${values.minute}`, second: values.second };
}

/** Convert the shul's wall clock using IANA offsets on both sides of a transition.
 * Reject nonexistent spring times; use the first occurrence of a repeated fall time. */
export function websitePreviewInstant(date, time, zone) {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d$/.test(time)) throw new Error('Choose a valid date and time.');
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (year < 1900 || year > 2199 || hour > 23 || minute > 59
    || new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error('Choose a valid date between 1900 and 2199.');
  const candidates = new Set();
  for (const delta of [-36, 0, 36]) {
    const sample = wall + delta * 3600000;
    const at = websiteLocalFields(new Date(sample), zone);
    const offset = Date.parse(`${at.date}T${at.time}:${at.second}Z`) - sample;
    const candidate = wall - offset;
    const local = websiteLocalFields(new Date(candidate), zone);
    if (local.date === date && local.time === time) candidates.add(candidate);
  }
  if (!candidates.size) throw new Error('That time does not occur when the clocks move forward. Choose another time.');
  return { instant: new Date(Math.min(...candidates)), repeated: candidates.size > 1 };
}

export function websitePreviewURL(url, instant = websiteNow()) {
  const result = new URL(url);
  result.searchParams.set(WEBSITE_PREVIEW_PARAM, instant.toISOString());
  return result;
}
