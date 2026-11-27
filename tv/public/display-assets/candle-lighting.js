import { addDays, localStamp } from './time.js';

export const CANDLE_HOLD_MS = 25 * 60000;
export const isCandleLighting = label => /הדלקת\s*נרות|candle\s*lighting|hadlakas\s*neiros/i.test(String(label || ''));

/** Present today's source time, without creating a prayer or borrowing next week's time. */
export function candleLightingForScreen(schedule, instant) {
  const now = Date.parse(instant);
  if (!Number.isFinite(now)) return null;
  const date = localStamp(instant).slice(0, 10);
  const day = schedule.today?.date === date ? schedule.today : schedule.displayDays?.find(day => day.date === date);
  const candle = day?.events?.find(event => event.auxiliary && isCandleLighting(event.name));
  const at = Date.parse(candle?.at);
  if (!Number.isFinite(at) || now - at >= CANDLE_HOLD_MS) return null;
  const incoming = schedule.displayDays?.find(day => day.date === addDays(date, 1));
  const title = day.prayerHeadings?.evening?.title || incoming?.displayTitle || incoming?.hebrewTitle || '';
  return { ...candle, title };
}

/** Match the congregation card's countdown, including seconds around candle lighting. */
export function candleCountdownText(at, instant) {
  const remaining = Date.parse(at) - Date.parse(instant);
  if (!Number.isFinite(remaining) || remaining <= -CANDLE_HOLD_MS) return '';
  if (remaining <= 10 * 60000) {
    const seconds = remaining > 0 ? Math.ceil(remaining / 1000) : Math.floor(-remaining / 1000);
    if (!seconds) return 'now';
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return remaining > 0 ? duration : `${duration} ago`;
  }
  const minutes = Math.ceil(remaining / 60000), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return 'in ' + [hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '', rest ? `${rest} minute${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}
