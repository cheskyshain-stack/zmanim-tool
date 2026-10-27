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
