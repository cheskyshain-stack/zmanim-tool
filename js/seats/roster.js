import { seatsItems } from './model.js';
import { seatsCompareNames } from './name-sort.js';
import { seatsCsvCell } from './import.js';

const seatsTableOrder = new Intl.Collator(['en', 'he'], { numeric: true, sensitivity: 'base' });

export function seatsSeatingRows(plan, order = 'last', includeUnassigned = false) {
  const locations = new Map();
  for (const table of seatsItems(plan)) {
    table.seats.forEach((id, index) => {
      if (!id) return;
      if (!locations.has(id)) locations.set(id, []);
      locations.get(id).push({ table: table.label, seat: index + 1 });
    });
  }
  return plan.people.flatMap(person => {
    const seats = locations.get(person.id) || [];
    if (!seats.length && includeUnassigned) return [{ name: person.name, table: 'Unassigned', seat: '' }];
    return seats.map(location => ({ name: person.name, ...location }));
  }).sort((a, b) => seatsCompareNames(a.name, b.name, order) || seatsTableOrder.compare(a.table, b.table) || a.seat - b.seat);
}

export function seatsSeatingCsv(rows) {
  return '\uFEFF' + [['Name', 'Table', 'Seat'], ...rows.map(row => [row.name, row.table, row.seat])]
    .map(row => row.map(seatsCsvCell).join(',')).join('\r\n');
}

export function seatsRosterRows(plan, order = 'last') {
  const names = new Map(), key = value => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  for (const row of seatsSeatingRows(plan, order)) {
    const id = key(row.name);
    if (!names.has(id)) names.set(id, { name: row.name, tables: new Map() });
    const tables = names.get(id).tables, tableId = key(row.table);
    if (!tables.has(tableId)) tables.set(tableId, row.table);
  }
  return [...names.values()].map(({ name, tables }) => ({ name, table: [...tables.values()].sort(seatsTableOrder.compare).join(', ') }))
    .sort((a, b) => seatsCompareNames(a.name, b.name, order));
}

export function seatsRosterCsv(rows) {
  return '\uFEFF' + [['Name', 'Table'], ...rows.map(row => [row.name, row.table])]
    .map(row => row.map(seatsCsvCell).join(',')).join('\r\n');
}
