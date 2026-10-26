import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsSetCount, seatsAssign, seatsAddNames, seatsAssigned, seatsNormalizeState, seatsUpgradePlan, seatsWriteName, seatsItems, seatsFront } from '../js/seats/model.js';
import { seatsParseDelimited, seatsNamesFromRows, seatsCsvCell } from '../js/seats/import.js';

test('34-table starting layout has the extra middle tables at the back and the specified four-seat and three-seat tables', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.tables.length, 34);
  assert.deepEqual(['A','B','C','D'].map(col => plan.tables.filter(table => table.column === col).length), [8,9,9,8]);
  assert.ok(plan.tables.find(table => table.id === 'B9').y > plan.tables.find(table => table.id === 'A8').y);
  assert.ok(plan.tables.find(table => table.id === 'C9').y > plan.tables.find(table => table.id === 'D8').y);
  assert.equal(plan.tables.reduce((sum, table) => sum + table.count, 0), 158);
  assert.ok(['A7','A8','D7','D8'].every(id => plan.tables.find(table => table.id === id).count === 3));
  assert.ok(plan.tables.filter(table => !['A7','A8','D7','D8','B2','C2','B6','C6'].includes(table.id)).every(table => table.count === 5));
  assert.ok(plan.tables.filter(table => table.column === 'A' && Number(table.id.slice(1)) <= 6).every(table => table.x === 17));
  assert.ok(plan.tables.filter(table => table.id.endsWith('1')).every(table => table.y === 70));
  const b6=plan.tables.find(table=>table.id==='B6');
  assert.ok(b6.y+b6.height+14<=536);
  assert.equal(plan.tables.find(table=>table.id==='B7').y,598);
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
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.layoutVersion,5);
  assert.equal(plan.tables[0].seats[0],dad);assert.equal(plan.people.length,2);
  assert.equal(plan.tables.find(table=>table.id==='A7').count,3);assert.ok(!seatsAssigned(plan).has(child));
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
});


test('front tables touch and the opposite-facing rav station fits between Aron Kodesh and C1', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const count of [5,6,4]){
    seatsSetCount(byId('D1'),count,plan);seatsSetCount(byId('C1'),count,plan);
    const front=seatsFront(plan),rav=plan.objects.find(object=>object.type==='rav');
    assert.equal(byId('C1').x+byId('C1').width,byId('D1').x);
    assert.ok(byId('B1').x+byId('B1').width<front.aron.x);
    assert.ok(front.aron.x+front.aron.width<rav.x);
    assert.ok(rav.x+rav.width<byId('C1').x);
    assert.equal(front.aron.y,byId('B1').y);
  }
  seatsWriteName(plan,'rav-seat',0,'Rav Cohen');
  assert.equal(seatsAssigned(plan).size,1);assert.equal(seatsItems(plan).reduce((sum,table)=>sum+table.count,0),157);
  assert.deepEqual(seatsNormalizeState({version:1,activeId:plan.id,plans:[plan]}).plans[0],plan);
});

test('rear tables align with the front or the bookcase face and leave continuous walkways', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const id of ['A7','A8'])assert.equal(byId(id).x+byId(id).width,byId('A6').x+byId('A6').width);
  assert.equal(byId('D7').x+byId('D7').width,1159);
  assert.equal(byId('D8').x+byId('D8').width,1159);
  const cases=plan.objects.filter(object=>object.type==='cabinet');assert.equal(cases.length,5);
  assert.ok(cases.filter(object=>object.height>object.width).every(object=>object.y===byId('A8').y));
  assert.ok(byId('B9').y+byId('B9').height+14<858);
  assert.ok(cases.filter(object=>object.width>object.height).every(object=>object.y===936));
  for(const id of ['B2','C2','B6','C6'])assert.equal(byId(id).count,4);
  const amud=plan.objects.find(object=>object.type==='amud');
  assert.ok(amud.x>byId('B2').x+byId('B2').width);assert.ok(amud.x+amud.width<byId('C2').x);
});

test('version 2 layouts migrate without duplicating a bimah or losing named seats', () => {
  const plan=seatsCreateState().plans[0];plan.layoutVersion=2;plan.objects=plan.objects.filter(object=>object.type==='bimah');
  seatsSetCount(plan.tables.find(table=>table.id==='B2'),5);seatsAddNames(plan,['Existing name']);
  seatsAssign(plan,'B2',4,plan.people[0].id);
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.people.length,1);assert.equal(seatsAssigned(plan).size,0);
  assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
  assert.equal(plan.objects.filter(object=>object.type==='rav').length,1);assert.equal(plan.layoutVersion,5);
});


test('tables beside the amud and bimah align on the edges away from the fixtures', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const [id,reference] of [['B2','B3'],['B6','B5']]){
    assert.equal(byId(id).x,byId(reference).x);assert.equal(byId(id).anchor,'left');
    seatsSetCount(byId(id),3,plan);assert.equal(byId(id).x,byId(reference).x);
  }
  for(const [id,reference] of [['C2','C3'],['C6','C5']]){
    assert.equal(byId(id).x+byId(id).width,byId(reference).x+byId(reference).width);
    seatsSetCount(byId(id),3,plan);assert.equal(byId(id).x+byId(id).width,byId(reference).x+byId(reference).width);
  }
  assert.equal(byId('D7').x,byId('D8').x);
});

test('version 3 alignment updates preserve names, seat counts, fixtures, and custom rear positions', () => {
  const plan=seatsCreateState().plans[0];plan.layoutVersion=3;
  const b2=plan.tables.find(table=>table.id==='B2'),d8=plan.tables.find(table=>table.id==='D8');
  b2.x=321.5;plan.tables.find(table=>table.id==='D7').x=1054;
  seatsWriteName(plan,'B2',3,'Existing Person');const before=JSON.stringify(plan.people),objects=JSON.stringify(plan.objects);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,5);
  assert.equal(b2.count,4);assert.equal(b2.x,300);assert.ok(b2.seats[3]);
  assert.equal(JSON.stringify(plan.people),before);assert.equal(JSON.stringify(plan.objects),objects);
  assert.equal(plan.tables.find(table=>table.id==='D7').x,d8.x);
});

test('version 4 room details move row 7 to the walkway and widen door gaps without losing names or custom fixtures', () => {
  const state=seatsCreateState(),plan=state.plans[0];plan.layoutVersion=4;
  const byId=id=>plan.tables.find(table=>table.id===id);
  for(const id of ['A7','B7','C7','D7'])byId(id).y=628;
  seatsSetCount(byId('B7'),6);seatsWriteName(plan,'B7',5,'Existing name');
  const cabinet=plan.objects.find(object=>object.id==='rear-case-center');
  Object.assign(cabinet,{x:299,width:602,label:'Sefarim'});
  plan.objects.push({id:'custom-pillar',type:'pillar',label:'Pillar',x:250,y:170,width:30,height:40});
  const before=JSON.stringify(plan.people),seats=[...byId('B7').seats];
  assert.equal(seatsUpgradePlan(plan),0);
  assert.equal(plan.layoutVersion,5);
  for(const id of ['A7','B7','C7','D7'])assert.equal(byId(id).y,598);
  assert.equal(byId('B8').y,706);assert.equal(byId('B7').count,6);
  assert.deepEqual(byId('B7').seats,seats);assert.equal(JSON.stringify(plan.people),before);
  const cases=plan.objects.filter(object=>/^rear-case-(left|center|right)$/.test(object.id));
  const [left,center,right]=cases.sort((a,b)=>a.x-b.x);
  assert.equal(241-left.x-left.width,20);assert.equal(center.x-291,20);
  assert.equal(909-center.x-center.width,20);assert.equal(right.x-959,20);
  assert.equal(cabinet.label,'Sefarim');
  assert.deepEqual(plan.objects.find(object=>object.id==='custom-pillar'),{id:'custom-pillar',type:'pillar',label:'Pillar',x:250,y:170,width:30,height:40});
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});
