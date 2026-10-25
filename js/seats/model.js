export const SEATS_STORAGE_KEY = 'lakewood-commons-seats-v1';
export const SEATS_ROOM = { width: 1200, height: 900 };

export function seatsUid() {
  return crypto.randomUUID();
}

export function seatsCreatePlan(name = 'Main shul') {
  const tables = [];
  ['A', 'B', 'C', 'D'].forEach((column, col) => {
    const rows = col === 0 || col === 3 ? 8 : 9;
    for (let row = 0; row < rows; row++) tables.push({
      id: column + (row + 1), label: column + (row + 1), column,
      x: [60, 340, 645, 925][col], y: 130 + row * 76,
      width: 215, height: 48, count: null, seats: [],
    });
  });
  return { id: seatsUid(), name, tables, objects: [], people: [], paper: 'letter', monochrome: true };
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
  return removed;
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
      const width = num(item.width, 20, 1140), height = num(item.height, 20, 800);
      return { id: oid, label: str(item.label, 80, 'label'),
        x: num(item.x, 20, 1180 - width), y: num(item.y, 75, 850 - height), width, height };
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
      return { ...base, column: ['A', 'B', 'C', 'D'].includes(table.column) ? table.column : '', count: table.count, seats: [...seats] };
    });
    const objects = list(raw.objects, 100, 'room objects').map(item => {
      if (!['pillar', 'cabinet', 'bimah', 'label'].includes(item.type)) fail('unknown room object.');
      return { ...box(item), type: item.type };
    });
    return { id, name: str(raw.name, 80, 'plan name'), people, tables, objects,
      paper: raw.paper === 'tabloid' ? 'tabloid' : 'letter', monochrome: raw.monochrome !== false };
  });
  if (!plans.length || !planIds.has(input.activeId)) fail('no active plan.');
  return { version: 1, activeId: input.activeId, plans };
}
