// Display grouping does not merge stored records: every notice keeps its own
// source ID and complete text so the admin can still edit it independently.
export const ANNOUNCEMENT_GROUPS = Object.freeze([
  Object.freeze({ id: 'hall', title: 'Simcha Hall', slotSpan: 4 }),
  Object.freeze({ id: 'rav', title: 'The Rav', slotSpan: 2 }),
  Object.freeze({ id: 'community', title: 'Community', slotSpan: 2 }),
  Object.freeze({ id: 'support', title: 'Support & services', slotSpan: 4 }),
]);

const uploadedGroups = Object.freeze({
  'uploaded-poster-hall-booking': 'hall',
  'uploaded-poster-hall-bar-mitzvah': 'hall',
  'uploaded-poster-hall-bris': 'hall',
  'uploaded-poster-rav-appointments': 'rav',
  'uploaded-poster-rav-messages': 'rav',
  'uploaded-poster-simcha-gemach': 'community',
  'uploaded-poster-belongings': 'community',
  'uploaded-poster-yom-tov-appeal': 'support',
  'uploaded-poster-text-messages': 'support',
  'uploaded-poster-coffee-sponsors': 'support',
});
const uploadedOrder = new Map(Object.keys(uploadedGroups).map((id, index) => [id, index]));
const definitions = new Map(ANNOUNCEMENT_GROUPS.map(group => [group.id, group]));
const ranks = { normal: 1, important: 2, urgent: 3 };
const text = value => String(value ?? '');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const priority = value => Object.hasOwn(ranks, value) ? value : 'normal';

/** Takes already-visible announcement records. Scheduling and permission checks
 * remain with the existing caller/server; this only changes their presentation.
 * An explicit admin group wins over the known uploaded poster mapping. Unknown
 * automatic notices stay distinct sections in Community, never guessed by words
 * in their titles. No notice is paginated, shortened or silently deduplicated. */
export function groupAnnouncements(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (item.kind !== 'announcement') continue;
    const data = item.data || {}, sourceId = text(item.id);
    const selected = data.displayGroup;
    const id = selected === 'separate' ? `announcement:${sourceId}`
      : definitions.has(selected) ? selected : uploadedGroups[sourceId] || 'community';
    const definition = definitions.get(id) || { id, title: text(item.title), slotSpan: 2 };
    if (!groups.has(id)) groups.set(id, { ...definition, priority: 'normal', sections: [], sourceIds: [], charCount: 0 });
    const group = groups.get(id);
    const section = {
      sourceId, title: text(item.title), message: text(data.message),
      contact: text(data.contact), phone: text(data.phone),
      category: text(data.category), priority: priority(data.priority),
    };
    group.sections.push(section);
    group.charCount += [section.title, section.message, section.contact, section.phone].reduce((sum, value) => sum + value.length, 0);
    if (ranks[section.priority] > ranks[group.priority]) group.priority = section.priority;
  }
  for (const group of groups.values()) {
    group.sections.sort((a, b) => (uploadedOrder.get(a.sourceId) ?? Infinity) - (uploadedOrder.get(b.sourceId) ?? Infinity) || compare(a.sourceId, b.sourceId));
    group.sourceIds = group.sections.map(section => section.sourceId);
    // A separate/new notice may need the larger footprint as its saved text grows.
    if (group.charCount > 400) group.slotSpan = 4;
  }
  const order = id => ANNOUNCEMENT_GROUPS.findIndex(group => group.id === id);
  return [...groups.values()].sort((a, b) => ranks[b.priority] - ranks[a.priority]
    || (order(a.id) < 0 ? 99 : order(a.id)) - (order(b.id) < 0 ? 99 : order(b.id))
    || compare(a.id, b.id));
}

export const escapeAnnouncementHTML = value => text(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

// Keep numbers embedded in the original wording on one line too. Escape every
// segment before adding our own markup; saved text is never interpreted as HTML.
function messageHTML(value) {
  return text(value).split(/(\b(?:\+1[ .\-–]?)?(?:\(\d{3}\)|\d{3})[ .\-–]\d{3}[ .\-–]\d{4}\b)/g)
    .map((part,index) => index % 2 ? `<bdi dir="ltr" class="announcement-phone">${escapeAnnouncementHTML(part)}</bdi>` : escapeAnnouncementHTML(part)).join('');
}

/** Complete, plain-text sections with bidi isolation for contact names and phone
 * numbers. CSS may lay these out, but the model never supplies truncated pages. */
export function renderAnnouncementGroup(group) {
  const esc = escapeAnnouncementHTML;
  return `<article class="announcement-group ${esc(group.priority)}" data-announcement-group="${esc(group.id)}" data-slot-span="${group.slotSpan}" data-character-count="${group.charCount}"><h2 dir="auto">${esc(group.title)}</h2><div class="announcement-group-sections">${group.sections.map(section => `<section class="announcement-section" data-source-id="${esc(section.sourceId)}"><h3 dir="auto">${esc(section.title)}</h3>${section.message ? `<p class="announcement-message" dir="auto" style="white-space:pre-wrap">${messageHTML(section.message)}</p>` : ''}${section.contact || section.phone ? `<p class="announcement-contact">${section.contact ? `<bdi dir="auto">${esc(section.contact)}</bdi>` : ''}${section.phone ? `<bdi dir="ltr">${esc(section.phone)}</bdi>` : ''}</p>` : ''}</section>`).join('')}</div></article>`;
}
