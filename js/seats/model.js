export const SEATS_STORAGE_KEY = 'lakewood-commons-seats-v1';
export const SEATS_ROOM = { width: 1200, height: 1000 };
export const SEATS_BOUNDS = { left: 17, top: 70, right: 1183, bottom: 960 };
export const SEATS_SEAT_WIDTH = 48;
export const SEATS_TABLE_HEIGHT = 40;
export const SEATS_DEFAULT_NAME = '7:30 מנין';
export const SEATS_LAYOUT_VERSION = 12;
// Keep the stored format compatible with the existing shared service.
export const SEATS_ROOM_UPDATE = 'smaller-bimah-2026-10-27';
export const SEATS_TABLE_WALL_GAP = 8;
export const SEATS_FRONT_TABLE_GAP = 8;
export const SEATS_FRONT_RIGHT_DOOR = { top: 78, bottom: 126, clearance: 24 };
export const SEATS_CROSS_WALKWAY = { top: 586, bottom: 648 };
export const SEATS_BACK_WALKWAY_Y = 888;
export const SEATS_FOUR_SEAT_TABLES = ['C1', 'A8', 'B6', 'C6'];
const SEATS_AMUD_SIZE = 38;
const SEATS_ARON_WIDTH = 126;
const SEATS_BIMAH = { x: 558.4, y: 497, width: 83.2, height: 72 };
const SEATS_STANDARD_WIDTH = SEATS_SEAT_WIDTH * 5;
const SEATS_ROW_GAP = 48, SEATS_ROW_PITCH = SEATS_TABLE_HEIGHT + SEATS_ROW_GAP;
const SEATS_TABLE_LEFT = SEATS_BOUNDS.left + SEATS_TABLE_WALL_GAP, SEATS_TABLE_RIGHT = SEATS_BOUNDS.right - SEATS_TABLE_WALL_GAP;
// B1 keeps half of the former 43-unit gap beside A1.
const SEATS_B1_RIGHT = SEATS_TABLE_LEFT + SEATS_STANDARD_WIDTH * 2 + 21.5;
const seatsRowY = row => row >= 7 ? SEATS_CROSS_WALKWAY.bottom + (row - 7) * SEATS_ROW_PITCH : SEATS_BOUNDS.top + SEATS_TABLE_WALL_GAP + (row - 1) * SEATS_ROW_PITCH;
const SEATS_COLUMN_GAP = (SEATS_TABLE_RIGHT - SEATS_TABLE_LEFT - SEATS_STANDARD_WIDTH * 4) / 3;
const SEATS_COLUMN_CENTERS = { A: SEATS_TABLE_LEFT + SEATS_STANDARD_WIDTH / 2,
  B: SEATS_TABLE_LEFT + SEATS_STANDARD_WIDTH * 1.5 + SEATS_COLUMN_GAP,
  C: SEATS_TABLE_RIGHT - SEATS_STANDARD_WIDTH * 1.5 - SEATS_COLUMN_GAP,
  D: SEATS_TABLE_RIGHT - SEATS_STANDARD_WIDTH / 2 };
const SEATS_BACK_CABINETS = [
  { id: 'rear-case-left', type: 'cabinet', label: 'Back sefarim (left)', x: 17, y: 936, width: 204, height: 24 },
  { id: 'rear-case-center', type: 'cabinet', label: 'Back sefarim (center)', x: 311, y: 936, width: 578, height: 24 },
  { id: 'rear-case-right', type: 'cabinet', label: 'Back sefarim (right)', x: 979, y: 936, width: 204, height: 24 },
];
const SEATS_A7_CABINET = { id: 'rear-case-a7', type: 'cabinet', label: 'Small sefarim by A7', x: 17, y: seatsRowY(7), width: 24, height: 40 };
const SEATS_PILLAR_SEATS = [['B7', 2], ['C7', 4]];

export function seatsChairPillar(plan, tableId, seat) {
  const table = plan.tables.find(table => table.id === tableId);
  if (!table?.count) return null;
  const center = table.x + table.width * (seat - .5) / table.count, top = table.y + table.height + 3;
  return plan.objects.find(object => object.type === 'pillar' && object.x < center + 6 && object.x + object.width > center - 6
    && object.y < top + 11 && object.y + object.height > top);
}

function seatsMissingPillars(plan) {
  return SEATS_PILLAR_SEATS.flatMap(([id, seat]) => {
    const table = plan.tables.find(table => table.id === id);
    return table?.count >= seat && !plan.objects.some(object => object.id === 'seat-pillar-' + id + '-' + seat) ? [{ table, seat }] : [];
  });
}
function seatsAddPillars(plan) {
  for (const { table, seat } of seatsMissingPillars(plan)) plan.objects.push({ id: 'seat-pillar-' + table.id + '-' + seat, type: 'pillar', label: 'Pillar by ' + table.id + ' seat ' + seat,
    x: table.x + table.width * (seat - .5) / table.count - 10, y: table.y + table.height + 1, width: 20, height: 20 });
}

export function seatsIsFixed(entry) {
  return entry?.type === 'cabinet' && [SEATS_A7_CABINET, ...SEATS_BACK_CABINETS].some(cabinet => cabinet.id === entry.id)
    || entry?.type === 'pillar' && SEATS_PILLAR_SEATS.some(([id, seat]) => entry.id === 'seat-pillar-' + id + '-' + seat);
}

export function seatsItems(plan) {
  return [...plan.tables, ...plan.objects.filter(object => object.type === 'rav')];
}

export function seatsFront(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1');
  const center = SEATS_ROOM.width / 2, aronWidth = SEATS_ARON_WIDTH, right = c1?.x ?? SEATS_TABLE_RIGHT - SEATS_STANDARD_WIDTH * 2;
  const aronRight = center + aronWidth / 2, gap = right - aronRight;
  const ravWidth = Math.min(40, Math.max(30, gap - 16));
  return { aron: { x: center - aronWidth / 2, y: 70, width: aronWidth, height: 48 },
    rav: { x: aronRight + Math.max(8, (gap - ravWidth) / 2), y: 70, width: ravWidth, height: 70 } };
}

export function seatsSyncFront(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1'), d1 = plan.tables.find(table => table.id === 'D1');
  if (c1 && d1) {
    const edge = Math.min(d1.x + d1.width, SEATS_BOUNDS.right - SEATS_FRONT_RIGHT_DOOR.clearance);
    const available = Math.max(120, edge - (SEATS_ROOM.width / 2 + SEATS_ARON_WIDTH / 2 + 16 + 30) - SEATS_FRONT_TABLE_GAP);
    const pair = [c1, d1], fixed = pair.filter(table => table.autoSize === false).reduce((sum, table) => sum + table.width, 0);
    const automatic = pair.filter(table => table.autoSize !== false), widths = automatic.map(table => Math.max(60, (table.count ?? 5) * SEATS_SEAT_WIDTH));
    const scale = Math.max(0, Math.min(1, (available - fixed) / (widths.reduce((sum, width) => sum + width, 0) || 1)));
    automatic.forEach((table, index) => { table.width = Math.max(60, widths[index] * scale); });
    d1.x = edge - d1.width; c1.anchor = 'right'; c1.x = Math.max(17, d1.x - SEATS_FRONT_TABLE_GAP - c1.width); c1.y = d1.y;
  }
  const b1 = plan.tables.find(table => table.id === 'B1');
  const { aron } = seatsFront(plan);
  const b1Right = Math.min(SEATS_B1_RIGHT, aron.x - SEATS_TABLE_WALL_GAP);
  if (b1 && b1.x + b1.width > b1Right) b1.x = Math.max(SEATS_BOUNDS.left, b1Right - b1.width);
  const rav = plan.objects.find(object => object.type === 'rav');
  if (rav) Object.assign(rav, seatsFront(plan).rav);
}

export function seatsSyncRear(plan) {
  const a6 = plan.tables.find(table => table.id === 'A6');
  for (const id of ['A7', 'A8', 'D7', 'D8']) {
    const table = plan.tables.find(entry => entry.id === id);
    if (!table) continue;
    table.anchor = 'right';
    const edge = id[0] === 'A' ? (a6 ? a6.x + a6.width : SEATS_TABLE_LEFT + SEATS_SEAT_WIDTH * 5) : SEATS_TABLE_RIGHT;
    table.x = edge - table.width;
  }
}

const seatsSideCases = [['A', 'rear-case-side-left', 17], ['D', 'rear-case-side-right', 1159]];
function seatsSideCaseTop(plan, column) {
  const table = plan.tables.find(table => table.id === column + '8');
  return Math.min(916, (table?.y ?? seatsRowY(8)) + (table?.height ?? SEATS_TABLE_HEIGHT) + 14 + SEATS_TABLE_WALL_GAP);
}
function seatsOldSideCases(plan) {
  return seatsSideCases.map(([column, id, x]) => ({ column, cabinet: plan.objects.find(object => object.id === id && object.type === 'cabinet' && object.x === x && object.width === 24 && Math.abs(object.y + object.height - 936) < .001) }))
    .filter(({ column, cabinet }) => cabinet && cabinet.y < seatsSideCaseTop(plan, column) - .001);
}
function seatsOldBimah(plan) {
  return plan.objects.find(object => object.type === 'bimah' && object.x === 548 && object.y === 452 && object.width === 104 && object.height === 90);
}

function seatsLargeBimahs(plan) {
  return plan.objects.filter(object => object.type === 'bimah' && object.width === 104 && object.height === 90);
}
function seatsShrinkBimahs(plan) {
  for (const bimah of seatsLargeBimahs(plan)) {
    bimah.x += (bimah.width - SEATS_BIMAH.width) / 2;
    bimah.y += (bimah.height - SEATS_BIMAH.height) / 2;
    bimah.width = SEATS_BIMAH.width; bimah.height = SEATS_BIMAH.height;
  }
}
function seatsJoinedFront(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1'), d1 = plan.tables.find(table => table.id === 'D1');
  return Boolean(c1 && d1 && Math.abs(c1.x + c1.width - d1.x) < .001);
}
function seatsOldFrontInset(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1'), d1 = plan.tables.find(table => table.id === 'D1');
  return c1 && d1 && Math.abs(d1.y - 78) < .001 && Math.abs(d1.x + d1.width - 1119) < .001
    && Math.abs(d1.x - c1.x - c1.width - SEATS_FRONT_TABLE_GAP) < .001 ? d1 : null;
}

export function seatsSyncAisleTables(plan) {
  for (const [id, reference] of [['B2', 'B3'], ['B5', 'B4'], ['B6', 'B4'], ['C2', 'C3'], ['C5', 'C4'], ['C6', 'C4']]) {
    const table = plan.tables.find(entry => entry.id === id), neighbor = plan.tables.find(entry => entry.id === reference);
    if (!table) continue;
    table.anchor = id[0] === 'B' ? 'left' : 'right';
    table.x = table.anchor === 'left' ? neighbor?.x ?? SEATS_COLUMN_CENTERS.B - SEATS_STANDARD_WIDTH / 2 : (neighbor ? neighbor.x + neighbor.width : SEATS_COLUMN_CENTERS.C + SEATS_STANDARD_WIDTH / 2) - table.width;
    const bimah = plan.objects.find(object => object.type === 'bimah');
    if (bimah && ['B5', 'C5'].includes(id) && table.y < bimah.y + bimah.height && table.y + table.height > bimah.y) {
      table.x = id === 'B5' ? Math.min(table.x, bimah.x - SEATS_TABLE_WALL_GAP - table.width)
        : Math.max(table.x, bimah.x + bimah.width + SEATS_TABLE_WALL_GAP);
    }
  }
}

function seatsBalanceColumns(plan) {
  const reference = column => plan.tables.find(table => table.id === column + '3')
    || plan.tables.find(table => table.column === column && table.id !== column + '1');
  const a = reference('A'), b = reference('B'), c = reference('C'), d = reference('D');
  const left = a ? a.x + a.width : SEATS_TABLE_LEFT + SEATS_STANDARD_WIDTH;
  const right = d?.x ?? SEATS_TABLE_RIGHT - SEATS_STANDARD_WIDTH;
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
    SEATS_A7_CABINET,
    { id: 'rear-case-side-left', type: 'cabinet', label: 'Left sefarim', x: 17, y: seatsSideCaseTop(plan, 'A'), width: 24, height: 936 - seatsSideCaseTop(plan, 'A') },
    { id: 'rear-case-side-right', type: 'cabinet', label: 'Right sefarim', x: 1159, y: seatsSideCaseTop(plan, 'D'), width: 24, height: 936 - seatsSideCaseTop(plan, 'D') },
    { id: 'rav-seat', type: 'rav', label: 'Rav', count: 1, seats: [null], ...seatsFront(plan).rav },
    { id: 'main-amud', type: 'amud', label: 'Amud', x: 600 - SEATS_AMUD_SIZE / 2, y: 188 - SEATS_AMUD_SIZE / 2, width: SEATS_AMUD_SIZE, height: SEATS_AMUD_SIZE },
  ];
  for (const fixture of fixtures) if (!plan.objects.some(object => object.id === fixture.id)) plan.objects.push({ ...fixture });
  seatsAddPillars(plan);
  seatsSyncFront(plan);
}

function seatsDefaultTable(column, row) {
  const count = column === 'A' && row === 7 ? 3
    : SEATS_FOUR_SEAT_TABLES.includes(column + row) ? 4 : 5;
  const anchor = column === 'A' && row <= 6 ? 'left' : column === 'D' && row <= 6 ? 'right' : 'center';
  const width = count * SEATS_SEAT_WIDTH;
  const center = SEATS_COLUMN_CENTERS[column];
  return { id: column + row, label: column + row, column, anchor, autoSize: true,
    x: anchor === 'left' ? SEATS_TABLE_LEFT : anchor === 'right' ? SEATS_TABLE_RIGHT - width : center - width / 2,
    y: seatsRowY(row),
    width, height: SEATS_TABLE_HEIGHT, count, seats: Array(count).fill(null) };
}

function seatsAiryRows(plan, previousVersion) {
  const before = new Map(plan.tables.map(table => [table.id, { y: table.y, height: table.height }]));
  for (const table of plan.tables) if (table.height === 48) table.height = SEATS_TABLE_HEIGHT;
  for (const column of ['A', 'B', 'C', 'D']) {
    for (const row of [2, 3, 4, 5, 6, 8, 9]) {
      const table = plan.tables.find(table => table.id === column + row), previous = plan.tables.find(table => table.id === column + (row - 1));
      if (!table || !previous) continue;
      const old = before.get(table.id), oldPrevious = before.get(previous.id);
      if (Math.abs(old.y - oldPrevious.y - oldPrevious.height - 30) < .001 || (previousVersion < 8 && row >= 8)) {
        table.y = Math.min(SEATS_BOUNDS.bottom - table.height - 14, previous.y + previous.height + 40);
      }
    }
    const cabinetId = column === 'A' ? 'rear-case-side-left' : column === 'D' ? 'rear-case-side-right' : null;
    const cabinet = plan.objects.find(object => object.id === cabinetId), row8 = plan.tables.find(table => table.id === column + '8');
    if (cabinet && row8 && Math.abs(cabinet.y - before.get(row8.id).y) < .001 && Math.abs(cabinet.y + cabinet.height - 936) < .001) {
      cabinet.y = Math.min(916, row8.y); cabinet.height = 936 - cabinet.y;
    }
  }
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

function seatsSpreadRearRows(plan) {
  const before = new Map(plan.tables.map(table => [table.id, { y: table.y, height: table.height }]));
  for (const column of ['A', 'B', 'C', 'D']) {
    for (const row of [8, 9]) {
      const table = plan.tables.find(table => table.id === column + row), previous = plan.tables.find(table => table.id === column + (row - 1));
      if (!table || !previous) continue;
      const old = before.get(table.id), oldPrevious = before.get(previous.id);
      if (Math.abs(old.y - oldPrevious.y - oldPrevious.height - 40) > .001) continue;
      const top = previous.y + previous.height + 70;
      if (top + table.height + 14 <= SEATS_BACK_WALKWAY_Y) table.y = top;
    }
    const cabinetId = column === 'A' ? 'rear-case-side-left' : column === 'D' ? 'rear-case-side-right' : null;
    const cabinet = plan.objects.find(object => object.id === cabinetId), row8 = plan.tables.find(table => table.id === column + '8');
    if (cabinet && row8 && Math.abs(cabinet.y - before.get(row8.id).y) < .001 && Math.abs(cabinet.y + cabinet.height - 936) < .001) {
      cabinet.y = Math.min(916, row8.y); cabinet.height = 936 - cabinet.y;
    }
  }
}

function seatsEvenRows(plan) {
  for (const table of plan.tables) {
    const match = /^([ABCD])([1-9])$/.exec(table.id);
    if (match && table.column === match[1]) table.y = seatsRowY(Number(match[2]));
  }
  for (const [column, id] of [['A', 'rear-case-side-left'], ['D', 'rear-case-side-right']]) {
    const cabinet = plan.objects.find(object => object.id === id), row8 = plan.tables.find(table => table.id === column + '8');
    if (cabinet && row8 && Math.abs(cabinet.y + cabinet.height - 936) < .001) {
      cabinet.y = row8.y - SEATS_TABLE_WALL_GAP; cabinet.height = 936 - cabinet.y;
    }
  }
  const amud = plan.objects.find(object => object.id === 'main-amud' && object.type === 'amud');
  if (amud?.y === 148) amud.y = 156;
  const bimah = plan.objects.find(object => object.type === 'bimah' && object.x === 548 && object.y === 420 && object.width === 104 && object.height === 90);
  if (bimah) bimah.y = 444;
}

function seatsSeparateTables(plan) {
  const minTop = SEATS_BOUNDS.top + SEATS_TABLE_WALL_GAP;
  const before = new Map(plan.tables.map(table => [table.id, { x: table.x, y: table.y, width: table.width }]));
  for (const table of plan.tables) {
    if (table.width <= SEATS_TABLE_RIGHT - SEATS_TABLE_LEFT) table.x = Math.max(SEATS_TABLE_LEFT, Math.min(SEATS_TABLE_RIGHT - table.width, table.x));
    const match = /^([ABCD])([1-9])$/.exec(table.id), row = match ? Number(match[2]) : null;
    const oldTop = row >= 7 ? 640 + (row - 7) * SEATS_ROW_PITCH : 70 + (row - 1) * SEATS_ROW_PITCH;
    const maxTop = SEATS_BOUNDS.bottom - table.height - 14;
    if (match && table.column === match[1] && Math.abs(table.y - oldTop) < .001) table.y = Math.min(maxTop, table.y + SEATS_TABLE_WALL_GAP);
    else if (table.y < minTop && maxTop >= minTop) table.y = minTop;
  }
  const a6 = plan.tables.find(table => table.id === 'A6'), oldA6 = before.get('A6');
  for (const id of ['A7', 'A8', 'D7', 'D8']) {
    const table = plan.tables.find(table => table.id === id), old = before.get(id);
    if (!table) continue;
    if (id[0] === 'A' && a6 && oldA6 && Math.abs(old.x + old.width - oldA6.x - oldA6.width) < .001) table.x = a6.x + a6.width - table.width;
    if (id[0] === 'D' && Math.abs(old.x + old.width - 1159) < .001) table.x = 1159 - SEATS_TABLE_WALL_GAP - table.width;
  }
  const moved = ['A3', 'D3'].some(id => { const table = plan.tables.find(table => table.id === id); return table && table.x !== before.get(id).x; });
  if (moved) seatsBalanceColumns(plan); else seatsSyncFront(plan);
  const amud = plan.objects.find(object => object.id === 'main-amud' && object.type === 'amud');
  if (amud?.y === 156) amud.y = 164;
  const bimah = plan.objects.find(object => object.type === 'bimah' && object.x === 548 && object.y === 444 && object.width === 104 && object.height === 90);
  if (bimah) bimah.y = 452;
}

function seatsEarlierRoomUpdate(plan) {
  // Earlier 7:30 layouts always joined these two tables. The new gap marks the update on every device.
  return seatsJoinedFront(plan) || seatsOldSideCases(plan).length > 0 || Boolean(seatsOldBimah(plan)) || Boolean(seatsOldFrontInset(plan));
}
function seatsOldRearInset(plan) {
  return plan.tables.some(table => ['D7', 'D8'].includes(table.id) && Math.abs(table.x + table.width - 1151) < .001);
}
function seatsAddA7Cabinet(plan) {
  if (!plan.objects.some(object => object.id === SEATS_A7_CABINET.id)) plan.objects.push({ ...SEATS_A7_CABINET });
}
function seatsOldAmud(plan) {
  return plan.objects.find(object => object.id === 'main-amud' && object.type === 'amud' && object.width === 64 && object.height === 48);
}
function seatsUpdateAmud(plan) {
  const amud = seatsOldAmud(plan);
  if (!amud) return;
  amud.x += (amud.width - SEATS_AMUD_SIZE) / 2; amud.y += (amud.height - SEATS_AMUD_SIZE) / 2;
  amud.width = amud.height = SEATS_AMUD_SIZE;
  for (const id of ['B2', 'C2']) {
    const table = plan.tables.find(table => table.id === id);
    if (table?.count === 4) seatsSetCount(table, 5);
  }
}
function seatsFrontClearanceNeeded(plan) {
  const b1 = plan.tables.find(table => table.id === 'B1');
  const { aron } = seatsFront(plan), rav = plan.objects.find(object => object.type === 'rav');
  return Boolean(b1 && b1.x + b1.width > Math.min(SEATS_B1_RIGHT, aron.x - SEATS_TABLE_WALL_GAP) + .001
    || rav && rav.x < aron.x + aron.width + SEATS_TABLE_WALL_GAP - .001
      && rav.y < aron.y + aron.height && rav.y + rav.height > aron.y);
}
function seatsDoorClearanceNeeded(plan) {
  const c1 = plan.tables.find(table => table.id === 'C1'), d1 = plan.tables.find(table => table.id === 'D1');
  return Boolean(c1 && d1 && d1.y < SEATS_FRONT_RIGHT_DOOR.bottom && d1.y + d1.height > SEATS_FRONT_RIGHT_DOOR.top
    && d1.x + d1.width > SEATS_BOUNDS.right - SEATS_FRONT_RIGHT_DOOR.clearance + .001);
}
export function seatsNeedsUpgrade(plan) {
  return plan.layoutVersion !== SEATS_LAYOUT_VERSION || seatsEarlierRoomUpdate(plan) || seatsOldRearInset(plan)
    || !plan.objects.some(object => object.id === SEATS_A7_CABINET.id) || Boolean(seatsOldAmud(plan)) || seatsMissingPillars(plan).length > 0 || seatsFrontClearanceNeeded(plan) || seatsDoorClearanceNeeded(plan) || seatsLargeBimahs(plan).length > 0;
}

export function seatsUpgradePlan(plan) {
  if (!seatsNeedsUpgrade(plan)) return 0;
  if (plan.layoutVersion === SEATS_LAYOUT_VERSION && !seatsEarlierRoomUpdate(plan)) {
    for (const table of seatsOldRearInset(plan) ? plan.tables.filter(table => ['D7', 'D8'].includes(table.id)) : []) {
      table.anchor = 'right'; table.x = Math.max(SEATS_BOUNDS.left, SEATS_TABLE_RIGHT - table.width);
    }
    seatsAddA7Cabinet(plan);
    seatsUpdateAmud(plan);
    seatsAddPillars(plan);
    seatsShrinkBimahs(plan);
    if (seatsFrontClearanceNeeded(plan) || seatsDoorClearanceNeeded(plan)) seatsSyncFront(plan);
    return 0;
  }
  const previousVersion = plan.layoutVersion ?? 1;
  const updateCounts = previousVersion !== SEATS_LAYOUT_VERSION || seatsJoinedFront(plan);
  const inset = seatsOldFrontInset(plan);
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
    for (const id of ['A7']) {
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
    for (const table of plan.tables) if (table.autoSize !== false) seatsSetCount(table, table.count);
    seatsSyncFront(plan); seatsSyncRear(plan); seatsSyncAisleTables(plan);
  }
  if (previousVersion < 7) seatsBalanceColumns(plan);
  if (previousVersion < 8) seatsSpaceRearRows(plan);
  if (previousVersion < 9) {
    seatsAiryRows(plan, previousVersion);
    seatsSyncFront(plan);
  }
  if (previousVersion < 10) seatsSpreadRearRows(plan);
  if (previousVersion < 11) seatsEvenRows(plan);
  if (previousVersion < 12) seatsSeparateTables(plan);
  for (const [id, count] of updateCounts ? [['C1', 4], ['A8', 4], ['B2', 5], ['C2', 5], ['B5', 5], ['C5', 5], ['D7', 5], ['D8', 5]] : []) {
    const table = plan.tables.find(table => table.id === id);
    if (table) released += seatsSetCount(table, count);
  }
  const bimah = seatsOldBimah(plan); if (bimah) bimah.y = 488;
  for (const { column, cabinet } of seatsOldSideCases(plan)) { cabinet.y = seatsSideCaseTop(plan, column); cabinet.height = 936 - cabinet.y; }
  if (inset) inset.x = SEATS_BOUNDS.right - SEATS_FRONT_RIGHT_DOOR.clearance - inset.width;
  seatsSyncFront(plan); seatsSyncRear(plan); seatsSyncAisleTables(plan);
  seatsAddA7Cabinet(plan);
  seatsUpdateAmud(plan);
  seatsAddPillars(plan);
  seatsShrinkBimahs(plan);
  plan.layoutVersion = SEATS_LAYOUT_VERSION;
  return released;
}

export function seatsUid() {
  return crypto.randomUUID();
}

export function seatsCreatePlan(name = SEATS_DEFAULT_NAME) {
  const tables = [];
  ['A', 'B', 'C', 'D'].forEach((column, col) => {
    const rows = col === 0 || col === 3 ? 8 : 9;
    for (let row = 1; row <= rows; row++) tables.push(seatsDefaultTable(column, row));
  });
  const plan = { id: seatsUid(), name, layoutVersion: SEATS_LAYOUT_VERSION, tables,
    objects: [{ id: seatsUid(), type: 'bimah', label: 'Bimah', ...SEATS_BIMAH }],
    people: [], paper: 'auto', monochrome: true };
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
  let name = String(text).replace(/\s+/g, ' ').trim();
  if (!name) { seatsAssign(plan, tableId, index, null); return null; }
  if (name.length > 160) throw new Error('Names must be 160 characters or shorter.');
  const key = value => value.normalize('NFC').toLocaleLowerCase();
  const assigned = seatsAssigned(plan);
  let person = personId ? plan.people.find(entry => entry.id === personId) : null;
  if (person && (duplicate || (assigned.has(person.id) && table.seats[index] !== person.id))) {
    name = person.name; person = null; duplicate = true;
  }
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
    const name = str(raw.name, 80, 'plan name');
    return { id, name: /^main shul$/i.test(name) ? SEATS_DEFAULT_NAME : name, layoutVersion: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(raw.layoutVersion) ? raw.layoutVersion : 1, people, tables, objects,
      paper: ['auto', 'tabloid'].includes(raw.paper) ? raw.paper : 'letter', monochrome: raw.monochrome !== false };
  });
  if (!plans.length || !planIds.has(input.activeId)) fail('no active plan.');
  return { version: 1, activeId: input.activeId, plans };
}
