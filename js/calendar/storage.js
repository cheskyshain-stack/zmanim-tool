import { calendarEvent } from './model.js';

export const CALENDAR_STORAGE_KEY = 'lakewood-commons-calendar-preview-v1';

export function calendarReadPreview(storage) {
  let saved;
  try { saved = (storage || localStorage).getItem(CALENDAR_STORAGE_KEY); }
  catch { throw new Error('This browser cannot read calendar storage. Allow site storage to save test events.'); }
  if (!saved) return [];
  try {
    const value = JSON.parse(saved);
    if (value.version !== 1 || !Array.isArray(value.events) || value.events.length > 2000) throw new Error();
    const ids = new Set();
    return value.events.map(item => {
      if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(item.id) || ids.has(item.id)) throw new Error();
      ids.add(item.id);
      return { ...calendarEvent(item), id: item.id, createdAt: String(item.createdAt || ''), updatedAt: String(item.updatedAt || ''), createdBy: 'device' };
    });
  } catch { throw new Error('The saved test calendar could not be read. Its data has been kept. Restore a calendar backup to continue.'); }
}

export function calendarWritePreview(events, storage) {
  if (events.length > 2000) throw new Error('This calendar has reached its limit of 2,000 events.');
  try { (storage || localStorage).setItem(CALENDAR_STORAGE_KEY, JSON.stringify({ version: 1, events })); }
  catch { throw new Error('The calendar could not be saved. Allow site storage or download a backup before continuing.'); }
}
