export { ZONE, localStamp, localToISO, formatInstant, addDays } from "./date-time.js";
import { nextYomTovWindows } from "./notice-recurrence.js";
export function phase(item, now, dateInfo) {
  if (item.status !== "published") return item.status;
  if (item.kind === 'announcement' && item.data?.recurrence) {
    return nextYomTovWindows(item.data.recurrence, now, dateInfo).some(w => w.startsAt <= now && now < w.endsAt) ? 'showing' : 'scheduled';
  }
  return item.startsAt > now ? "scheduled" : item.endsAt && now >= item.endsAt ? "expired" : "showing";
}
export function visible(item, now, dateInfo) {
  return phase(item, now, dateInfo) === "showing";
}
