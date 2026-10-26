export const SEATS_STORAGE_KEY = 'lakewood-commons-seats-v1';
export const SEATS_ROOM = { width: 1200, height: 1000 };
export const SEATS_BOUNDS = { left: 17, top: 70, right: 1183, bottom: 960 };
export const SEATS_SEAT_WIDTH = 48;
export const SEATS_LAYOUT_VERSION = 9;
export const SEATS_BACK_WALKWAY_Y = 828;
export const SEATS_FOUR_SEAT_TABLES = ['B2', 'C2', 'B5', 'C5', 'B6', 'C6'];
const SEATS_STANDARD_WIDTH = SEATS_SEAT_WIDTH * 5;
const SEATS_COLUMN_GAP = (SEATS_BOUNDS.right - SEATS_BOUNDS.left - SEATS_STANDARD_WIDTH * 4) / 3;
const SEATS_COLUMN_CENTERS = { A: SEATS_BOUNDS.left + SEATS_STANDARD_WIDTH / 2,
  B: SEATS_BOUNDS.left + SEATS_STANDARD_WIDTH * 1.5 + SEATS_COLUMN_GAP,
  C: SEATS_BOUNDS.right - SEATS_STANDARD_WIDTH * 1.5 - SEATS_COLUMN_GAP,
  D: SEATS_BOUNDS.right - SEATS_STANDARD_WIDTH / 2 };
const SEATS_BACK_CABINETS = [
  { id: 'rear-case-left', type: 'cabinet', label: 'Back sefarim (left)', x: 17, y: 936, width: 204, height: 24 },
  { id: 'rear-case-center', type: 'cabinet', label: 'Back sefarim (center)', x: 311, y: 936, width: 578, height: 24 },
  { id: 'rear-case-right', type: 'cabinet', label: 'Back sefarim (right)', x: 979, y: 936, width: 204, height: 24 },
];

export function seatsIsFixed(entry) {
  return entry?.type === 'cabinet' && SEATS_BACK_CABINETS.some(cabinet => cabinet.id === entry.id);
}

export function seatsItems(plan) {
  return [...plan.tables, ...plan.objects.filter(object => object.type === 'rav')];
}

export function seatsFront(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1');
  const center = SEATS_ROOM.width / 2, aronWidth = 72, right = c1?.x ?? SEATS_BOUNDS.right - SEATS_STANDARD_WIDTH * 2;
  const aronRight = center + aronWidth / 2, gap = right - aronRight;
  const ravWidth = Math.min(40, Math.max(30, gap - 16));
  return { aron: { x: center - aronWidth / 2, y: 70, width: aronWidth, height: 48 },
    rav: { x: aronRight + Math.max(8, (gap - ravWidth) / 2), y: 70, width: ravWidth, height: 70 } };
}

export function seatsSyncFront(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1'), d1 = plan.tables.find(table => table.id === 'D1');
  if (c1 && d1) {
    const edge = d1.x + d1.width, available = Math.max(120, edge - (SEATS_ROOM.width / 2 + 36 + 16 + 30));
    const pair = [c1, d1], fixed = pair.filter(table => table.autoSize === false).reduce((sum, table) => sum + table.width, 0);
    const automatic = pair.filter(table => table.autoSize !== false), widths = automatic.map(table => Math.max(60, (table.count ?? 5) * SEATS_SEAT_WIDTH));
    const scale = Math.max(0, Math.min(1, (available - fixed) / (widths.reduce((sum, width) => sum + width, 0) || 1)));
    automatic.forEach((table, index) => { table.width = Math.max(60, widths[index] * scale); });
    d1.x = edge - d1.width; c1.anchor = 'right'; c1.x = Math.max(17, d1.x - c1.width); c1.y = d1.y;
  }
  const b1 = plan.tables.find(table => table.id === 'B1');
  const { aron } = seatsFront(plan);
  if (b1 && b1.x + b1.width > aron.x - 8) b1.x = Math.max(SEATS_BOUNDS.left, aron.x - 8 - b1.width);
  const rav = plan.objects.find(object => object.type === 'rav');
  if (rav) Object.assign(rav, seatsFront(plan).rav);
}

export function seatsSyncRear(plan) {
  const a6 = plan.tables.find(table => table.id === 'A6');
  for (const id of ['A7', 'A8', 'D7', 'D8']) {
    const table = plan.tables.find(entry => entry.id === id);
    if (!table) continue;
    table.anchor = 'right';
    const edge = id[0] === 'A' ? (a6 ? a6.x + a6.width : SEATS_BOUNDS.left + SEATS_SEAT_WIDTH * 5) : 1159;
    table.x = edge - table.width;
  }
}

export function seatsSyncAisleTables(plan) {
  for (const [id, reference] of [['B2', 'B3'], ['B5', 'B4'], ['B6', 'B4'], ['C2', 'C3'], ['C5', 'C4'], ['C6', 'C4']]) {
    const table = plan.tables.find(entry => entry.id === id), neighbor = plan.tables.find(entry => entry.id === reference);
    if (!table) continue;
    table.anchor = id[0] === 'B' ? 'left' : 'right';
    table.x = table.anchor === 'left' ? neighbor?.x ?? SEATS_COLUMN_CENTERS.B - SEATS_STANDARD_WIDTH / 2 : (neighbor ? neighbor.x + neighbor.width : SEATS_COLUMN_CENTERS.C + SEATS_STANDARD_WIDTH / 2) - table.width;
  }
}

function seatsBalanceColumns(plan) {
  const reference = column => plan.tables.find(table => table.id === column + '3')
    || plan.tables.find(table => table.column === column && table.id !== column + '1');
  const a = reference('A'), b = reference('B'), c = reference('C'), d = reference('D');
  const left = a ? a.x + a.width : SEATS_BOUNDS.left + SEATS_STANDARD_WIDTH;
  const right = d?.x ?? SEATS_BOUNDS.right - SEATS_STANDARD_WIDTH;
  const bWidth = b?.width ?? SEATS_STANDARD_WIDTH, cWidth = c?.width ?? SEATS_STANDARD_WIDTH;
  const gap = Math.max(0, (right - left - bWidth - cWidth) / 3);
  for (const [column, anchor, center] of [['B', b, left + gap + bWidth / 2], ['C', c, right - gap - cWidth / 2]]) {
    if (!anchor) continue;
    const shift = center - anchor.x - anchor.width / 2;
    if (Math.abs(shift) < 0.0000001) continue;
    for (const table of plan.tables) if (table.column === column && table.id !== 'C1') {
      table.x = Math.max(SEATS_BOUNDS.left, Math.min(SEATS_BOUNDS.right - table.width, table.x + shift));
    }
  }
  seatsSyncFront(plan);
}

function seatsRearLayout(plan) {
  seatsSyncRear(plan);
  const fixtures = [
    ...SEATS_BACK_CABINETS,
    { id: 'rear-case-side-left', type: 'cabinet', label: 'Left sefarim', x: 17, y: 676, width: 24, height: 260 },
    { id: 'rear-case-side-right', type: 'cabinet', label: 'Right sefarim', x: 1159, y: 676, width: 24, height: 260 },
    { id: 'rav-seat', type: 'rav', label: 'Rav', count: 1, seats: [null], ...seatsFront(plan).rav },
    { id: 'main-amud', type: 'amud', label: 'Amud', x: 568, y: 148, width: 64, height: 48 },
  ];
  for (const fixture of fixtures) if (!plan.objects.some(object => object.id === fixture.id)) plan.objects.push({ ...fixture });
  seatsSyncFront(plan);
}

function seatsDefaultTable(column, row) {
  const count = (column === 'A' || column === 'D') && (row === 7 || row === 8) ? 3
    : SEATS_FOUR_SEAT_TABLES.includes(column + row) ? 4 : 5;
  const anchor = column === 'A' && row <= 6 ? 'left' : column === 'D' && row <= 6 ? 'right' : 'center';
  const width = count * SEATS_SEAT_WIDTH;
  const center = SEATS_COLUMN_CENTERS[column];
  return { id: column + row, label: column + row, column, anchor, autoSize: true,
    x: anchor === 'left' ? 17 : anchor === 'right' ? 1183 - width : center - width / 2,
    y: row >= 7 ? 598 + (row - 7) * 78 : 70 + (row - 1) * 78,
    width, height: 48, count, seats: Array(count).fill(null) };
}

function seatsSpaceRearRows(plan) {
  for (const column of ['A', 'B', 'C', 'D']) {
    const previous8 = plan.tables.find(table => table.id === column + '8')?.y;
    for (const row of [8, 9]) {
      const table = plan.tables.find(table => table.id === column + row);
      if (!table) continue;
      const previous = plan.tables.find(table => table.id === column + (row - 1));
      const top = previous ? previous.y + previous.height + 30 : 598 + (row - 7) * 78;
      table.y = Math.min(SEATS_BOUNDS.bottom - table.height - 14, top);
    }
    const cabinetId = column === 'A' ? 'rear-case-side-left' : column === 'D' ? 'rear-case-side-right' : null;
    const cabinet = plan.objects.find(object => object.id === cabinetId);
    const row8 = plan.tables.find(table => table.id === column + '8');
    if (cabinet && row8 && Math.abs(cabinet.y - previous8) < .001 && Math.abs(cabinet.y + cabinet.height - 936) < .001) {
      cabinet.y = Math.min(916, row8.y); cabinet.height = 936 - cabinet.y;
    }
  }
}

export function seatsUpgradePlan(plan) {
  if (plan.layoutVersion === SEATS_LAYOUT_VERSION) return 0;
  const previousVersion = plan.layoutVersion ?? 1;
  let released = 0;
  if (previousVersion === 3) {
    seatsSyncAisleTables(plan);
    const d7 = plan.tables.find(table => table.id === 'D7'), d8 = plan.tables.find(table => table.id === 'D8');
    if (d7 && d8) { d7.anchor = 'right'; d7.x = d8.x + d8.width - d7.width; }
  }
  if (previousVersion < 3) {
    if (previousVersion < 2) {
      for (const table of plan.tables) {
        const match = /^([ABCD])([1-9])$/.exec(table.id);
        if (!match || table.column !== match[1]) continue;
        const fresh = seatsDefaultTable(match[1], Number(match[2]));
        const count = fresh.count === 3 ? 3 : table.count ?? fresh.count;
        const assignments = table.seats;
        released += assignments.slice(count).filter(Boolean).length;
        Object.assign(table, fresh, { label: table.label, count, seats: Array.from({ length: count }, (_, i) => assignments[i] || null) });
        seatsSetCount(table, count);
      }
    }
    const bimah = plan.objects.find(object => object.type === 'bimah');
    const position = { x: 548, y: 420, width: 104, height: 90 };
    if (bimah && previousVersion < 2) Object.assign(bimah, position);
    else if (!bimah) plan.objects.push({ id: seatsUid(), type: 'bimah', label: 'Bimah', ...position });
    for (const id of SEATS_FOUR_SEAT_TABLES) {
      const table = plan.tables.find(entry => entry.id === id);
      if (table) released += seatsSetCount(table, 4);
    }
    for (const id of ['A7', 'A8', 'D7', 'D8']) {
      const table = plan.tables.find(entry => entry.id === id);
      if (table) released += seatsSetCount(table, 3);
    }
    seatsRearLayout(plan);
    seatsSyncAisleTables(plan);
  }
  if (previousVersion < 5) {
    for (const table of plan.tables) if (/^[ABCD]7$/.test(table.id)) table.y = 598;
    for (const cabinet of SEATS_BACK_CABINETS) {
      const existing = plan.objects.find(object => object.id === cabinet.id && object.type === 'cabinet');
      if (existing) Object.assign(existing, { x: cabinet.x, y: cabinet.y, width: cabinet.width, height: cabinet.height });
    }
  }
  if (previousVersion < 6) {
    for (const id of ['B5', 'C5']) {
      const table = plan.tables.find(entry => entry.id === id);
      if (table) released += seatsSetCount(table, 4);
    }
    for (const table of plan.tables) if (table.autoSize !== false) seatsSetCount(table, table.count);
    seatsSyncFront(plan); seatsSyncRear(plan); seatsSyncAisleTables(plan);
  }
  if (previousVersion < 7) seatsBalanceColumns(plan);
  if (previousVersion < 8) seatsSpaceRearRows(plan);
  seatsSyncFront(plan);
  plan.layoutVersion = SEATS_LAYOUT_VERSION;
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
  const plan = { id: seatsUid(), name, layoutVersion: SEATS_LAYOUT_VERSION, tables,
    objects: [{ id: seatsUid(), type: 'bimah', label: 'Bimah', x: 548, y: 420, width: 104, height: 90 }],
    people: [], paper: 'letter', monochrome: true };
  seatsRearLayout(plan);
  seatsSyncAisleTables(plan);
  return plan;
}

export function seatsCreateState() {
  const plan = seatsCreatePlan();
  return { version: 1, activeId: plan.id, plans: [plan] };
}

export function seatsSetCount(table, value, plan = null) {
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
  if (plan?.layoutVersion === SEATS_LAYOUT_VERSION && ['B1', 'C1', 'D1'].includes(table.id)) seatsSyncFront(plan);
  if (plan?.layoutVersion === SEATS_LAYOUT_VERSION && ['A6', 'A7', 'A8', 'D7', 'D8'].includes(table.id)) seatsSyncRear(plan);
  if (plan?.layoutVersion === SEATS_LAYOUT_VERSION && /^[BC][2-6]$/.test(table.id)) seatsSyncAisleTables(plan);
  return removed;
}

export function seatsWriteName(plan, tableId, index, text, { duplicate = false, personId = null } = {}) {
  const table = seatsItems(plan).find(entry => entry.id === tableId);
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
  const table = seatsItems(plan).find(item => item.id === tableId);
  if (!table || !Number.isInteger(index) || index < 0 || index >= (table.count ?? 0)) {
    throw new Error('Choose a seat inside a table first.');
  }
  if (personId !== null && !plan.people.some(person => person.id === personId)) throw new Error('Choose a person first.');
  // Moving someone frees their previous seat, and a displaced person stays on the list.
  for (const item of seatsItems(plan)) item.seats = item.seats.map(id => id === personId ? null : id);
  table.seats[index] = personId;
}

export function seatsAssigned(plan) {
  return new Set(seatsItems(plan).flatMap(table => table.seats).filter(Boolean));
}

export function seatsRemovePeople(plan, ids) {
  const removed = new Set(ids), before = plan.people.length;
  plan.people = plan.people.filter(person => !removed.has(person.id));
  for (const table of seatsItems(plan)) table.seats = table.seats.map(id => removed.has(id) ? null : id);
  return before - plan.people.length;
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
    const box = (item, table = false) => {
      const oid = str(item.id, 100, 'object ID');
      if (objectIds.has(oid)) fail('duplicate object ID.');
      objectIds.add(oid);
      const width = num(item.width, 20, 1166), height = num(item.height, 20, 890);
      return { id: oid, label: str(item.label, 80, 'label'),
        x: num(item.x, SEATS_BOUNDS.left, SEATS_BOUNDS.right - width), y: num(item.y, SEATS_BOUNDS.top, SEATS_BOUNDS.bottom - height - (table ? 14 : 0)), width, height };
    };
    const tables = list(raw.tables, 200, 'tables').map(table => {
      const base = box(table, true);
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
    const objects = list(raw.objects, 200, 'room objects').map(item => {
      if (!['pillar', 'cabinet', 'bimah', 'label', 'rav', 'amud'].includes(item.type)) fail('unknown room object.');
      const base = { ...box(item), type: item.type };
      if (item.type !== 'rav') return base;
      if (base.width < 30 || base.height < 70) fail('rav station too small.');
      const seats = list(item.seats, 1, 'rav seat');
      if (seats.length !== 1) fail('invalid rav seat.');
      const person = seats[0];
      if (person !== null) {
        if (!peopleIds.has(person) || assignments.has(person)) fail('missing or repeated seat assignment.');
        assignments.add(person);
      }
      return { ...base, count: 1, seats: [...seats] };
    });
    return { id, name: str(raw.name, 80, 'plan name'), layoutVersion: [2, 3, 4, 5, 6, 7, 8, 9].includes(raw.layoutVersion) ? raw.layoutVersion : 1, people, tables, objects,
      paper: raw.paper === 'tabloid' ? 'tabloid' : 'letter', monochrome: raw.monochrome !== false };
  });
  if (!plans.length || !planIds.has(input.activeId)) fail('no active plan.');
  return { version: 1, activeId: input.activeId, plans };
}
