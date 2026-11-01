import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsFrontPillars, seatsSeatBlocked, seatsUsableCount, seatsWriteName, seatsAssign, seatsItems, seatsIsFixed, seatsNormalizeState } from '../js/seats/model.js';

const blocked = plan => plan.tables.flatMap(table => table.seats.flatMap((_, index) => seatsSeatBlocked(plan, table.id, index) ? [table.id + ':' + (index + 1)] : []));
test('front pillars align with the rear pair and do not block a seat or move existing names', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  seatsWriteName(plan, 'B4', 1, 'Front Pillar Test'); seatsWriteName(plan, 'C4', 3, 'Other Front Pillar Test');
  const before = structuredClone(plan), additions = seatsFrontPillars(plan);
  assert.equal(additions.length, 2); plan.objects.push(...additions);
  assert.deepEqual(plan.tables, before.tables); assert.deepEqual(plan.people, before.people);
  assert.deepEqual(blocked(plan), ['B7:2', 'C7:4']);
  for (const [id, rearId] of [['B4','seat-pillar-B7-2'],['C4','seat-pillar-C7-4']]) {
    const table = plan.tables.find(table => table.id === id), front = additions.find(pillar => pillar.id === 'front-pillar-' + id), rear = plan.objects.find(pillar => pillar.id === rearId);
    assert.equal(front.x + 10, rear.x + rear.width / 2); assert.equal(front.y + front.height + 8, table.y);
    assert.deepEqual([front.width, front.height], [20,20]); assert.ok(seatsIsFixed(front)); assert.equal(seatsUsableCount(plan, table), table.count);
  }
  assert.deepEqual(seatsFrontPillars(plan), []); assert.deepEqual(seatsNormalizeState(state), state);
  assert.equal(seatsItems(plan).reduce((count, table) => count + seatsUsableCount(plan, table), 0), 163);
});
test('blocked positions reject typing, copies and assignments before changing any names or original seats', () => {
  const plan = seatsCreateState().plans[0], person = seatsWriteName(plan, 'A1', 0, 'Keep Original Assignment'), before = structuredClone(plan);
  for (const [table, index] of [['B7',1],['C7',3]]) {
    assert.throws(() => seatsWriteName(plan, table, index, 'Cannot Be Added'), /blocked by a pillar/);
    assert.throws(() => seatsWriteName(plan, table, index, person.name, { personId: person.id }), /blocked by a pillar/);
    assert.throws(() => seatsWriteName(plan, table, index, person.name, { duplicate: true }), /blocked by a pillar/);
    assert.throws(() => seatsAssign(plan, table, index, person.id), /blocked by a pillar/);
    assert.deepEqual(plan, before, 'Rejected changes cannot add orphan names or remove a source assignment');
  }
  seatsWriteName(plan, 'B7', 2, 'Usable Adjacent Seat'); assert.ok(plan.tables.find(table => table.id === 'B7').seats[2]);
});
test('legacy names at a blocked position survive loading and can be cleared or moved without loss', () => {
  const state = seatsCreateState(), plan = state.plans[0], table = plan.tables.find(table => table.id === 'B7'), person = { id: 'synthetic-legacy-blocked-person', name: 'Keep Legacy Name' };
  plan.people.push(person); table.seats[1] = person.id;
  assert.deepEqual(seatsNormalizeState(state), state);
  seatsAssign(plan, 'B7', 1, person.id); assert.equal(table.seats[1], person.id);
  seatsAssign(plan, 'A1', 0, person.id); assert.equal(table.seats[1], null); assert.equal(plan.tables[0].seats[0], person.id); assert.equal(plan.people[0].name, person.name);
  table.seats[1] = person.id; plan.tables[0].seats[0] = null;
  seatsWriteName(plan, 'B7', 1, ''); assert.equal(table.seats[1], null); assert.equal(plan.people[0].name, person.name);
});
