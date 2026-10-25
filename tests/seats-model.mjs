import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsSetCount, seatsAssign, seatsAddNames, seatsAssigned, seatsNormalizeState } from '../js/seats/model.js';
import { seatsParseDelimited, seatsNamesFromRows, seatsCsvCell } from '../js/seats/import.js';

test('34-table starting layout has the extra middle tables at the back and no assumed seat counts', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.tables.length, 34);
  assert.deepEqual(['A','B','C','D'].map(col => plan.tables.filter(table => table.column === col).length), [8,9,9,8]);
  assert.ok(plan.tables.find(table => table.id === 'B9').y > plan.tables.find(table => table.id === 'A8').y);
  assert.ok(plan.tables.find(table => table.id === 'C9').y > plan.tables.find(table => table.id === 'D8').y);
  assert.ok(plan.tables.every(table => table.count === null && table.seats.length === 0));
  assert.deepEqual(seatsNormalizeState(state), state);
});

test('seat moves and reduced capacities preserve people without duplicate assignments', () => {
  const plan = seatsCreateState().plans[0];
  const [first, second] = plan.tables;
  seatsSetCount(first, 4); seatsSetCount(second, 3);
  assert.deepEqual(seatsAddNames(plan, ['Yosef Cohen', 'דוד כהן', '  Yosef   Cohen  ']), {added:2,duplicates:1});
  const [a,b] = plan.people.map(person => person.id);
  seatsAssign(plan, first.id, 0, a); seatsAssign(plan, first.id, 1, b);
  seatsAssign(plan, second.id, 0, a);
  assert.equal(first.seats[0], null); assert.equal(second.seats[0], a);
  assert.equal(seatsAssigned(plan).size, 2);
  assert.equal(seatsSetCount(first, 1), 1);
  assert.equal(seatsAssigned(plan).size, 1); assert.equal(plan.people.length, 2);
  assert.throws(() => seatsAssign(plan, first.id, 1, b), /Choose a seat/);
  assert.throws(() => seatsSetCount(first, 2.5), /whole number/);
  assert.throws(() => seatsSetCount(first, -1), /whole number/);
});

test('backup validation rejects missing people, duplicate assignments, unsupported versions and off-room objects', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  seatsSetCount(plan.tables[0], 2); seatsAddNames(plan, ['A']);
  seatsAssign(plan, 'A1', 0, plan.people[0].id);
  assert.deepEqual(seatsNormalizeState(state), state);
  const duplicate = structuredClone(state); duplicate.plans[0].tables[0].seats[1] = plan.people[0].id;
  assert.throws(() => seatsNormalizeState(duplicate), /repeated/);
  const missing = structuredClone(state); missing.plans[0].people = [];
  assert.throws(() => seatsNormalizeState(missing), /missing/);
  const outside = structuredClone(state); outside.plans[0].tables[0].x = 2000;
  assert.throws(() => seatsNormalizeState(outside), /outside/);
  assert.throws(() => seatsNormalizeState({...state, version:2}), /version/);
});

test('CSV import handles BOM, quoted commas, doubled quotes, multiline cells and headers', () => {
  const rows = seatsParseDelimited('\uFEFFName,Email\r\n"Cohen, Yosef",a@example.test\r\n"רבי דוד ""כהן""",b@example.test\r\n"Moshe\nLevi",c@example.test');
  assert.deepEqual(seatsNamesFromRows(rows), ['Cohen, Yosef', 'רבי דוד "כהן"', 'Moshe\nLevi']);
  assert.deepEqual(seatsNamesFromRows(seatsParseDelimited('First name;Last name\nYosef;Cohen\nMoshe;Levi')), ['Yosef Cohen','Moshe Levi']);
  assert.deepEqual(seatsNamesFromRows([['שם פרטי','שם משפחה'],['דוד','כהן']]), ['דוד כהן']);
  assert.throws(() => seatsParseDelimited('Name\n"Unclosed'), /unclosed/);
  assert.equal(seatsCsvCell('=1+1'), '"\'=1+1"');
  assert.equal(seatsCsvCell('Normal "name"'), '"Normal ""name"""');
});
