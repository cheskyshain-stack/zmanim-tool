import { seatsSharedDiff, seatsSharedPlan } from './shared-model.js';
import { seatsDescribeChanges } from './activity.js';

const SEATS_RECORDS_KEY = 'lakewood-commons-seats-records-v1';
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
function normalize(record = {}) {
  return { createdAt: date(record?.createdAt), createdBy: text(record?.createdBy, 60), updatedAt: date(record?.updatedAt), updatedBy: text(record?.updatedBy, 60),
    history: Array.isArray(record?.history) ? record.history.slice(-200).filter(entry => date(entry?.at)).map(entry => ({ id: text(entry.id, 100), at: date(entry.at), by: text(entry.by, 60) || 'This device', details: Array.isArray(entry.details) ? entry.details.slice(0, 31).map(detail => String(detail).slice(0, 400)) : [] })) : [] };
}

export function seatsCreateRecords({ getState, getName, isShared, isEligible = () => true, notify, fresh }) {
  const records = new Map(), observed = new Map(getState().plans.filter(isEligible).map(plan => [plan.id, seatsSharedPlan(plan)]));
  try {
    const saved = JSON.parse(localStorage.getItem(SEATS_RECORDS_KEY) || 'null');
    if (saved?.version === 1 && saved.records && typeof saved.records === 'object') {
      for (const plan of getState().plans) if (Object.hasOwn(saved.records, plan.id)) records.set(plan.id, normalize(saved.records[plan.id]));
    }
  } catch { /* Existing charts remain available when metadata cannot be loaded. */ }
  function persist() {
    try { localStorage.setItem(SEATS_RECORDS_KEY, JSON.stringify({ version: 1, records: Object.fromEntries(records) })); }
    catch { notify('Chart dates and local history could not be saved. Download a backup before closing.'); }
  }
  function append(id, details, created = false) {
    const now = new Date().toISOString(), by = getName() || 'This device', record = records.get(id) || normalize();
    if (created && !record.createdAt) { record.createdAt = now; record.createdBy = by; }
    record.updatedAt = now; record.updatedBy = by;
    record.history.push({ id: crypto.randomUUID(), at: now, by, details }); record.history = record.history.slice(-200);
    records.set(id, record);
  }
  if (fresh) { for (const plan of getState().plans.filter(isEligible)) append(plan.id, ['Created chart'], true); persist(); }
  function sync() {
    let changed = false;
    for (const plan of getState().plans) {
      const previous = observed.get(plan.id);
      if (!previous && !isEligible(plan)) continue;
      const next = seatsSharedPlan(plan); observed.set(plan.id, next);
      if (isShared(plan.id)) continue;
      if (!previous) { append(plan.id, [records.has(plan.id) ? 'Restored chart from a backup' : 'Created chart'], !records.has(plan.id)); changed = true; }
      else {
        const changes = seatsSharedDiff(previous, next);
        if (changes.length) { append(plan.id, seatsDescribeChanges(previous, next, changes)); changed = true; }
      }
    }
    if (changed) persist();
  }
  return { sync, info: id => normalize(records.get(id)), restore: (id, record) => { if (record) records.set(id, normalize(record)); } };
}
