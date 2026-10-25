export const SEATS_STORAGE_KEY = 'lakewood-commons-seats-v1';
export const SEATS_ROOM = { width: 1200, height: 900 };
export const SEATS_BOUNDS = { left: 17, top: 70, right: 1183, bottom: 850 };
export const SEATS_SEAT_WIDTH = 43;

function seatsDefaultTable(column, row) {
  const count = (column === 'A' || column === 'D') && row > 6 ? 3 : 5;
  const anchor = column === 'A' && row <= 6 ? 'left' : column === 'D' && row <= 6 ? 'right' : 'center';
  const width = count * SEATS_SEAT_WIDTH;
  const center = { A: 124.5, B: 407.5, C: 792.5, D: 1075.5 }[column];
  return { id: column + row, label: column + row, column, anchor, autoSize: true,
    x: anchor === 'left' ? 17 : anchor === 'right' ? 1183 - width : center - width / 2,
    y: 70 + (row - 1) * 78 + (row > 6 ? 90 : 0),
    width, height: 48, count, seats: Array(count).fill(null) };
}

export function seatsUpgradePlan(plan) {
  if (plan.layoutVersion === 2) return 0;
  let released = 0;
  for (const table of plan.tables) {
    const match = /^([ABCD])([1-9])$/.exec(table.id);
    if (!match || table.column !== match[1]) continue;
    const fresh = seatsDefaultTable(match[1], Number(match[2]));
    const count = fresh.count === 3 ? 3 : table.count ?? 5;
    const assignments = table.seats;
    released += assignments.slice(count).filter(Boolean).length;
    Object.assign(table, fresh, { label: table.label, count, seats: Array.from({ length: count }, (_, i) => assignments[i] || null) });
    seatsSetCount(table, count);
  }
  const bimah = plan.objects.find(object => object.type === 'bimah');
  const position = { x: 548, y: 420, width: 104, height: 90 };
  if (bimah) Object.assign(bimah, position);
  else plan.objects.push({ id: seatsUid(), type: 'bimah', label: 'Bimah', ...position });
  plan.layoutVersion = 2;
  return released;
}

export function seatsUid() {
  return crypto.randomUUID();
}

export function seatsCreatePlan(name = 'Main shul') {
  const tables = [];
  ['A', 'B', 'C', 'D'].forEach((column, col) => {
    const rows = col === 0 || col === 3 ? 8 : 9;
    for (let row = 1; row <= rows; row++) tables.push(seatsDefaultTable(column, row));
  });
  return { id: seatsUid(), name, layoutVersion: 2, tables,
    objects: [{ id: seatsUid(), type: 'bimah', label: 'Bimah', x: 548, y: 420, width: 104, height: 90 }],
    people: [], paper: 'letter', monochrome: true };
}

export function seatsCreateState() {
  const plan = seatsCreatePlan();
  return { version: 1, activeId: plan.id, plans: [plan] };
}

export function seatsSetCount(table, value) {
  const count = value === '' || value === null ? null : Number(value);
  if (count !== null && (!Number.isInteger(count) || count < 0 || count > 16)) {
    throw new Error('Choose a whole number from 0 to 16 seats.');
  }
  const removed = table.seats.slice(count ?? 0).filter(Boolean).length;
  table.count = count;
  table.seats = Array.from({ length: count ?? 0 }, (_, i) => table.seats[i] || null);
  if (table.autoSize !== false) {
    const previous = table.width;
    table.width = Math.max(60, (count ?? 5) * SEATS_SEAT_WIDTH);
    if (table.anchor === 'right') table.x += previous - table.width;
    else if (table.anchor !== 'left') table.x += (previous - table.width) / 2;
    table.x = Math.max(SEATS_BOUNDS.left, Math.min(SEATS_BOUNDS.right - table.width, table.x));
  }
  return removed;
}

export function seatsWriteName(plan, tableId, index, text, { duplicate = false, personId = null } = {}) {
  const table = plan.tables.find(entry => entry.id === tableId);
  if (!table || index < 0 || index >= (table.count ?? 0)) throw new Error('Choose a seat first.');
  const name = String(text).replace(/\s+/g, ' ').trim();
  if (!name) { seatsAssign(plan, tableId, index, null); return null; }
  if (name.length > 160) throw new Error('Names must be 160 characters or shorter.');
  const key = value => value.normalize('NFC').toLocaleLowerCase();
  const assigned = seatsAssigned(plan);
  let person = personId ? plan.people.find(entry => entry.id === personId) : null;
  if (!person && !duplicate) {
    const current = plan.people.find(entry => entry.id === table.seats[index]);
    person = (current && key(current.name) === key(name) ? current : null)
      || plan.people.find(entry => !assigned.has(entry.id) && key(entry.name) === key(name));
    if (!person && current) { current.name = name; person = current; }
  }
  if (!person) {
    if (plan.people.length >= 2000) throw new Error('A plan can contain up to 2,000 people.');
    person = { id: seatsUid(), name }; plan.people.push(person);
  }
  seatsAssign(plan, tableId, index, person.id);
  return person;
}

export function seatsAssign(plan, tableId, index, personId) {
  const table = plan.tables.find(item => item.id === tableId);
  if (!table || !Number.isInteger(index) || index < 0 || index >= (table.count ?? 0)) {
    throw new Error('Choose a seat inside a table first.');
  }
  if (personId !== null && !plan.people.some(person => person.id === personId)) throw new Error('Choose a person first.');
  // Moving someone frees their previous seat, and a displaced person stays on the list.
  for (const item of plan.tables) item.seats = item.seats.map(id => id === personId ? null : id);
  table.seats[index] = personId;
}

export function seatsAssigned(plan) {
  return new Set(plan.tables.flatMap(table => table.seats).filter(Boolean));
}

export function seatsAddNames(plan, names) {
  const key = name => name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const existing = new Set(plan.people.map(person => key(person.name)));
  let added = 0, duplicates = 0;
  for (const raw of names) {
    const name = String(raw).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (name.length > 160) throw new Error('Names must be 160 characters or shorter.');
    if (existing.has(key(name))) { duplicates++; continue; }
    if (plan.people.length >= 2000) throw new Error('A plan can contain up to 2,000 people.');
    existing.add(key(name));
    plan.people.push({ id: seatsUid(), name });
    added++;
  }
  return { added, duplicates };
}

export function seatsNormalizeState(input) {
  const fail = message => { throw new Error('Cannot open this backup: ' + message); };
  const str = (value, max, name) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid ' + name + '.');
    return value;
  };
  const list = (value, max, name) => {
    if (!Array.isArray(value) || value.length > max) fail('invalid ' + name + '.');
    return value;
  };
  const num = (value, min, max) => {
    if (!Number.isFinite(value) || value < min || value > max) fail('an object is outside the room.');
    return value;
  };
  if (input?.version !== 1) fail('unsupported file version.');
  const planIds = new Set();
  const plans = list(input.plans, 30, 'plans').map(raw => {
    const id = str(raw.id, 100, 'plan ID');
    if (planIds.has(id)) fail('duplicate plan ID.');
    planIds.add(id);
    const peopleIds = new Set(), objectIds = new Set(), assignments = new Set();
    const people = list(raw.people, 2000, 'people').map(person => {
      const pid = str(person.id, 100, 'person ID');
      if (peopleIds.has(pid)) fail('duplicate person ID.');
      peopleIds.add(pid);
      return { id: pid, name: str(person.name, 160, 'name') };
    });
    const box = item => {
      const oid = str(item.id, 100, 'object ID');
      if (objectIds.has(oid)) fail('duplicate object ID.');
      objectIds.add(oid);
      const width = num(item.width, 20, 1166), height = num(item.height, 20, 780);
      return { id: oid, label: str(item.label, 80, 'label'),
        x: num(item.x, SEATS_BOUNDS.left, SEATS_BOUNDS.right - width), y: num(item.y, SEATS_BOUNDS.top, SEATS_BOUNDS.bottom - height), width, height };
    };
    const tables = list(raw.tables, 200, 'tables').map(table => {
      const base = box(table);
      if (base.width < 60 || base.height < 40) fail('table too small.');
      if (table.count !== null && (!Number.isInteger(table.count) || table.count < 0 || table.count > 16)) fail('invalid seat count.');
      const seats = list(table.seats, 16, 'seats');
      if (seats.length !== (table.count ?? 0)) fail('seat count does not match the table.');
      for (const person of seats) {
        if (person === null) continue;
        if (!peopleIds.has(person) || assignments.has(person)) fail('missing or repeated seat assignment.');
        assignments.add(person);
      }
      return { ...base, column: ['A', 'B', 'C', 'D'].includes(table.column) ? table.column : '',
        anchor: ['left', 'right'].includes(table.anchor) ? table.anchor : 'center', autoSize: table.autoSize !== false,
        count: table.count, seats: [...seats] };
    });
    const objects = list(raw.objects, 100, 'room objects').map(item => {
      if (!['pillar', 'cabinet', 'bimah', 'label'].includes(item.type)) fail('unknown room object.');
      return { ...box(item), type: item.type };
    });
    return { id, name: str(raw.name, 80, 'plan name'), layoutVersion: raw.layoutVersion === 2 ? 2 : 1, people, tables, objects,
      paper: raw.paper === 'tabloid' ? 'tabloid' : 'letter', monochrome: raw.monochrome !== false };
  });
  if (!plans.length || !planIds.has(input.activeId)) fail('no active plan.');
  return { version: 1, activeId: input.activeId, plans };
}
