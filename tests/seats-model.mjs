import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsSetCount, seatsAssign, seatsAddNames, seatsAssigned, seatsNormalizeState, seatsUpgradePlan, seatsWriteName } from '../js/seats/model.js';
import { seatsParseDelimited, seatsNamesFromRows, seatsCsvCell } from '../js/seats/import.js';

test('34-table starting layout has the extra middle tables at the back and five-seat tables with three-seat rear tables', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.tables.length, 34);
  assert.deepEqual(['A','B','C','D'].map(col => plan.tables.filter(table => table.column === col).length), [8,9,9,8]);
  assert.ok(plan.tables.find(table => table.id === 'B9').y > plan.tables.find(table => table.id === 'A8').y);
  assert.ok(plan.tables.find(table => table.id === 'C9').y > plan.tables.find(table => table.id === 'D8').y);
  assert.equal(plan.tables.reduce((sum, table) => sum + table.count, 0), 162);
  assert.ok(['A7','A8','D7','D8'].every(id => plan.tables.find(table => table.id === id).count === 3));
  assert.ok(plan.tables.filter(table => !['A7','A8','D7','D8'].includes(table.id)).every(table => table.count === 5));
  assert.ok(plan.tables.filter(table => table.column === 'A' && Number(table.id.slice(1)) <= 6).every(table => table.x === 17));
  assert.ok(plan.tables.filter(table => table.id.endsWith('1')).every(table => table.y === 70));
  assert.ok(plan.tables.find(table=>table.id==='B7').y - plan.tables.find(table=>table.id==='B6').y >= 150);
  assert.equal(plan.objects.find(object=>object.type==='bimah').x,548);
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


test('table width follows seat count and preserves the wall or center anchor', () => {
  const plan=seatsCreateState().plans[0],left=plan.tables[0],middle=plan.tables.find(table=>table.id==='B1');
  const center=middle.x+middle.width/2;
  for(const [count,width] of [[3,129],[4,172],[5,215],[6,258]]){
    seatsSetCount(left,count);seatsSetCount(middle,count);
    assert.equal(left.width,width);assert.equal(left.x,17);
    assert.equal(middle.width,width);assert.equal(middle.x+middle.width/2,center);
  }
  middle.autoSize=false;middle.width=250;seatsSetCount(middle,3);assert.equal(middle.width,250);
});

test('typing reuses an unseated name, suggestions move a person, and copying keeps separate seats', () => {
  const plan=seatsCreateState().plans[0];seatsAddNames(plan,['Yosef Cohen']);
  const dad=seatsWriteName(plan,'A1',0,'Yosef Cohen');assert.equal(plan.people.length,1);
  const child=seatsWriteName(plan,'A1',1,'Yosef Cohen',{duplicate:true});
  assert.notEqual(dad.id,child.id);assert.equal(plan.tables[0].seats[0],dad.id);assert.equal(plan.tables[0].seats[1],child.id);
  seatsWriteName(plan,'A1',1,'Child Cohen');assert.equal(plan.tables[0].seats[1],child.id);assert.equal(plan.people.length,2);assert.equal(plan.people.find(p=>p.id===child.id).name,'Child Cohen');
  seatsWriteName(plan,'A2',0,'Yosef',{personId:dad.id});assert.equal(plan.tables[0].seats[0],null);
  assert.equal(plan.tables[1].seats[0],dad.id);assert.equal(plan.tables[0].seats[1],child.id);
  seatsWriteName(plan,'A2',1,'New Person');assert.equal(plan.people.length,3);
  assert.deepEqual(seatsNormalizeState({version:1,plans:[plan],activeId:plan.id}).plans[0],plan);
});

test('legacy layout migration retains people and assignments, returning excess rear seats to the list', () => {
  const plan=seatsCreateState().plans[0];delete plan.layoutVersion;plan.objects=[];
  for(const table of plan.tables){delete table.autoSize;delete table.anchor;table.count=null;table.seats=[];}
  seatsSetCount(plan.tables[0],5);seatsSetCount(plan.tables.find(table=>table.id==='A7'),5);
  seatsAddNames(plan,['Existing parent','Existing child']);
  const [dad,child]=plan.people.map(person=>person.id);
  seatsAssign(plan,'A1',0,dad);seatsAssign(plan,'A7',4,child);
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.layoutVersion,2);
  assert.equal(plan.tables[0].seats[0],dad);assert.equal(plan.people.length,2);
  assert.equal(plan.tables.find(table=>table.id==='A7').count,3);assert.ok(!seatsAssigned(plan).has(child));
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
});
