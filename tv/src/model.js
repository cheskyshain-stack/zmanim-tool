import { ApiError } from "./auth.js";
import { localToISO, visible, phase } from "../public/display-assets/time.js";
import { dateInfo, source } from "./schedules.js";
export const text = (v, n = 200) => {
  if (typeof v !== "string") return "";
  if (v.length > n) throw new ApiError(422, `Text exceeds ${n} characters.`);
  return v.trim();
};
const choice = (v, values, fallback) => {
  v = v ?? fallback;
  if (!values.includes(v)) throw new ApiError(422, "Choose a valid option.");
  return v;
};
export function validate(raw) {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new ApiError(422,"Enter a valid display item.");
  const kind = choice(raw.kind, ["announcement", "dedication", "schedule"]), status = choice(raw.status, ["draft", "published", "hidden", "archived"], "draft");
  const d = raw.data || {}, data = {};
  let startsAt = null, endsAt = null;
  if (raw.startLocal) startsAt = localToISO(raw.startLocal, raw.startFold);
  if (raw.endLocal) endsAt = localToISO(raw.endLocal, raw.endFold);
  if (endsAt && (!startsAt || endsAt <= startsAt)) throw new ApiError(422, "End must be after start.");
  let title = text(raw.title);
  const internalName = text(raw.internalName);
  if (kind === "announcement") {
    Object.assign(data, { message: text(d.message, 1200), contact: text(d.contact, 100), phone: text(d.phone, 40), category: text(d.category, 60), placement: choice(d.placement, ["automatic", "left", "right"], "automatic"), priority: choice(d.priority, ["normal", "important", "urgent"], "normal"), behavior: choice(d.behavior, ["pinned", "rotating"], "rotating"), duration: Math.min(120, Math.max(15, Number(d.duration) || 25)) });
    if (status === "published" && (!title || !data.message)) throw new ApiError(422, "Enter a visible title and message.");
  }
  if (kind === "dedication") {
    Object.assign(data, { sponsor: text(d.sponsor), anonymous: d.anonymous === true, dedicationType: choice(d.dedicationType, ["לע״נ", "לרפואה שלמה", "לזכות", "Custom"], "לע״נ"), dedicationName: text(d.dedicationName), dedicationText: text(d.dedicationText, 500), message: text(d.message, 600), sponsorshipDate: text(d.sponsorshipDate, 10), timing: choice(d.timing, ["evening", "civil", "custom"], "evening"), duration: Math.min(120, Math.max(25, Number(d.duration) || 35)) });
    title = "פרנס היום";
    if (data.sponsorshipDate) {
      const info = dateInfo(data.sponsorshipDate);
      data.hebrewLabel = info.label;
      if (data.timing !== "custom") {
        startsAt = data.timing === "evening" ? info.previousSunset : info.civilStart;
        endsAt = data.timing === "evening" ? info.sunset : info.civilEnd;
      }
    }
    if (status === "published" && (!data.sponsorshipDate || !data.anonymous && !data.sponsor || !data.dedicationName)) throw new ApiError(422, "Enter a sponsorship date, dedication name and sponsor (or choose anonymous).");
  }
  if (kind === "schedule") {
    Object.assign(data, { source: text(d.source), appliesFrom: text(d.appliesFrom, 10), appliesTo: text(d.appliesTo, 10), portion: choice(d.portion, ["all", "morning", "mincha", "maariv"], "all"), precedence: Number(d.precedence) || 0, overlapAcknowledged: d.overlapAcknowledged === true });
    if (data.source) {
      const catalog = source(data.source);
      if (data.appliesFrom) dateInfo(data.appliesFrom);
      if (data.appliesTo) dateInfo(data.appliesTo);
      if (data.appliesFrom && data.appliesTo && data.appliesFrom > data.appliesTo) throw new ApiError(422, "Applicable end date must follow its start date.");
      if (data.appliesFrom && data.appliesFrom < catalog.from || data.appliesTo && data.appliesTo > catalog.to) throw new ApiError(422, "Choose applicable dates within the selected source schedule.");
    }
    data.previewAt = d.previewLocal ? localToISO(d.previewLocal, d.previewFold) : null;
    if (data.previewAt && startsAt && data.previewAt > startsAt) throw new ApiError(422, "Preview must begin no later than the main schedule.");
    if (status === "published" && (!title || !data.source || !data.appliesFrom || !data.appliesTo || !endsAt || !Number.isInteger(data.precedence) || data.precedence < 1 || data.precedence > 999)) throw new ApiError(422, "Choose a source, applicable dates, activation/resume times and an explicit precedence from 1 to 999.");
  }
  if (status === "published" && !startsAt) throw new ApiError(422, "Choose when this item starts.");
  return { kind, status, title, internalName, startsAt, endsAt, data };
}
export function conflicts(item, others) {
  if (item.kind !== "schedule" || item.status !== "published") return [];
  return others.filter((o) => o.id !== item.id && o.kind === "schedule" && o.status === "published" && o.startsAt < item.endsAt && item.startsAt < o.endsAt && o.data.appliesFrom <= item.data.appliesTo && item.data.appliesFrom <= o.data.appliesTo && (o.data.portion === "all" || item.data.portion === "all" || o.data.portion === item.data.portion));
}
export function publicItem(item) {
  const d = { ...item.data };
  if (item.kind === "dedication" && d.anonymous) delete d.sponsor;
  delete d.overlapAcknowledged;
  return { id: item.id, kind: item.kind, title: item.title, startsAt: item.startsAt, endsAt: item.endsAt, data: d };
}
export function publicItems(items, instant) {
  return items.filter((i) => i.kind !== "schedule" && visible(i, instant)).map(publicItem);
}
export function warnings(items, instant) {
  const active = items.filter((i) => visible(i, instant));
  const out = [];
  if (active.some((i) => i.kind === "dedication") && active.some((i) => i.kind === "announcement" && i.data.placement === "right" && i.data.behavior === "pinned") && active.filter((i) => i.kind === "announcement" && i.data.placement === "right").length > 1) out.push("The dedication shares the right column. Its announcements, including pinned cards, will rotate in the remaining slot. Move a pinned announcement to the left to keep it steady.");
  if (["left", "right"].some((side) => active.filter((i) => i.kind === "announcement" && i.data.behavior === "pinned" && (i.data.placement === "automatic" ? "left" : i.data.placement) === side).length > 1)) out.push("Only one pinned announcement fits in each column. Extra pinned cards rotate so schedules remain readable.");
  if (active.some((i) => (i.data.message || "").length > 320 || (i.data.dedicationText || "").length > 250 || (i.title || "").length > 70 || (i.data.dedicationName || "").length > 70 || (i.data.sponsor || "").length > 70)) out.push("Long text may not fit comfortably. Shorten the title, name or message before publishing.");
  if (active.some((i) => conflicts(i, active).length)) out.push("Overlapping schedules: the higher precedence wins for each affected portion.");
  return out;
}
