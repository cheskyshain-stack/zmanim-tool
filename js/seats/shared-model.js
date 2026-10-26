import { seatsNormalizeState } from './model.js';

const seatsSharedGroups = ['people', 'tables', 'objects'];
const seatsSharedFields = {
  plan: ['name', 'layoutVersion', 'paper', 'monochrome'],
  people: ['name'],
  tables: ['label', 'column', 'anchor', 'autoSize', 'x', 'y', 'width', 'height', 'count', 'seats'],
  objects: ['label', 'type', 'x', 'y', 'width', 'height', 'count', 'seats'],
};
const seatsSharedEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function seatsSharedPlan(value) {
  return seatsNormalizeState({ version: 1, activeId: value.id, plans: [value] }).plans[0];
}

export function seatsSharedDiff(before, after) {
  const changes = [];
  for (const key of seatsSharedFields.plan) if (!seatsSharedEqual(before[key], after[key])) changes.push({ group: 'plan', key, before: before[key], after: after[key] });
  for (const group of seatsSharedGroups) {
    const previous = new Map(before[group].map(item => [item.id, item])), next = new Map(after[group].map(item => [item.id, item]));
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const a = previous.get(id), b = next.get(id);
      if (!a || !b) { changes.push({ group, id, before: a || null, after: b || null }); continue; }
      for (const key of seatsSharedFields[group]) {
        if (seatsSharedEqual(a[key], b[key])) continue;
        if (key === 'seats' && a.seats?.length === b.seats?.length) {
          for (let index = 0; index < a.seats.length; index++) if (a.seats[index] !== b.seats[index]) changes.push({ group, id, key, index, before: a.seats[index], after: b.seats[index] });
        } else changes.push({ group, id, key, before: a[key] ?? null, after: b[key] ?? null });
      }
    }
  }
  return changes;
}

export function seatsSharedReverse(changes) {
  return [...changes].reverse().map(change => ({ ...change, before: change.after, after: change.before }));
}

export function seatsSharedApply(plan, changes) {
  if (!Array.isArray(changes) || changes.length > 20000) throw new Error('This update is too large.');
  const next = structuredClone(plan);
  for (const change of changes) {
    const { group, id, key, index, before, after } = change;
    if (!Object.hasOwn(seatsSharedFields, group) || !Object.hasOwn(change, 'before') || !Object.hasOwn(change, 'after')) throw new Error('Invalid shared update.');
    if (group !== 'plan' && (typeof id !== 'string' || !id || id.length > 100)) throw new Error('Invalid shared item.');
    if (!key && group !== 'plan') {
      const found = next[group].findIndex(item => item.id === id), current = found < 0 ? null : next[group][found];
      if (seatsSharedEqual(current, after)) continue;
      if (!seatsSharedEqual(current, before)) throw new Error('Another organizer changed ' + (current?.label || current?.name || id) + '.');
      if (after !== null && (typeof after !== 'object' || after.id !== id)) throw new Error('Invalid shared item.');
      if (after === null) { if (found >= 0) next[group].splice(found, 1); }
      else if (found < 0) next[group].push(structuredClone(after));
      else next[group][found] = structuredClone(after);
      continue;
    }
    if (!seatsSharedFields[group].includes(key)) throw new Error('Invalid shared field.');
    const item = group === 'plan' ? next : next[group].find(item => item.id === id);
    if (!item) throw new Error('Another organizer removed ' + id + '.');
    const indexed = index !== undefined;
    if (indexed && (key !== 'seats' || !Number.isInteger(index) || index < 0 || index >= (item.seats?.length ?? 0))) throw new Error('This seat has changed.');
    const current = indexed ? item.seats[index] : item[key] ?? null;
    if (seatsSharedEqual(current, after)) continue;
    if (!seatsSharedEqual(current, before)) throw new Error('Another organizer changed ' + (item.label || item.name || 'this plan') + (indexed ? ', seat ' + (index + 1) : '') + '.');
    if (indexed) item.seats[index] = structuredClone(after);
    else item[key] = structuredClone(after);
  }
  return seatsSharedPlan(next);
}
