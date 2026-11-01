export const SEATS_TRASH_DAYS = 60;
export const SEATS_TRASH_MS = SEATS_TRASH_DAYS * 24 * 60 * 60 * 1000;
export const SEATS_TRASH_KEY = 'lakewood-commons-seats-trash-v1';

export function seatsTrashExpiry(record) {
  const at = Date.parse(record?.deletedAt);
  return Number.isFinite(at) ? new Date(at + SEATS_TRASH_MS).toISOString() : null;
}
export function seatsTrashAvailable(record, now = Date.now()) {
  const expiry = seatsTrashExpiry(record);
  return Boolean(expiry && Date.parse(record.deletedAt) <= now && Date.parse(expiry) > now && !record.purgedAt);
}

export function seatsCreateLocalTrash(storage = localStorage) {
  function read() {
    let value;
    try { value = JSON.parse(storage.getItem(SEATS_TRASH_KEY) || '{"version":1,"items":[]}'); }
    catch { throw new Error('Trash could not be opened on this device. Nothing was deleted.'); }
    if (value?.version !== 1 || !Array.isArray(value.items)) throw new Error('Trash could not be opened on this device. Nothing was deleted.');
    return value.items.filter(item => item?.id && item.plan?.id && seatsTrashAvailable(item));
  }
  function write(items) {
    try { storage.setItem(SEATS_TRASH_KEY, JSON.stringify({ version: 1, items })); }
    catch { throw new Error('This device could not save a recovery copy. Nothing was deleted. Free some browser storage and try again.'); }
  }
  return {
    list: () => read().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    add(plan, metadata, by) {
      const item = { id: crypto.randomUUID(), plan: structuredClone(plan), metadata: structuredClone(metadata), deletedAt: new Date().toISOString(), deletedBy: by || 'This device' };
      write([...read(), item]); return item;
    },
    remove(id) { write(read().filter(item => item.id !== id)); },
  };
}
