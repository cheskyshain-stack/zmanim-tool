export const ZONE = "America/New_York";
export function localStamp(instant = /* @__PURE__ */ new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)).map((p2) => [p2.type, p2.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function localToISO(value, fold = "") {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new RangeError("Choose a valid date and time.");
  const bare = Date.parse(value + "Z"), matches = [4, 5].map((h) => new Date(bare + h * 36e5)).filter((d) => Number.isFinite(+d) && localStamp(d) === value);
  if (!matches.length) throw new RangeError("This New York time does not exist. Check the date or daylight saving change.");
  if (matches.length > 1 && !["earlier", "later"].includes(fold)) throw new RangeError("This time occurs twice when daylight saving ends. Choose first or second occurrence.");
  return matches[fold === "later" ? matches.length - 1 : 0].toISOString();
}
export function formatInstant(iso) {
  return iso ? new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso)) : "Until turned off";
}
export function addDays(date, n) {
  const d = /* @__PURE__ */ new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function phase(item, now) {
  if (item.status !== "published") return item.status;
  return item.startsAt > now ? "scheduled" : item.endsAt && now >= item.endsAt ? "expired" : "showing";
}
export function visible(item, now) {
  return phase(item, now) === "showing";
}
