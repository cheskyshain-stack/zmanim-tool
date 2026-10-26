import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsSetCount, seatsAssign, seatsAddNames, seatsAssigned, seatsNormalizeState, seatsUpgradePlan, seatsWriteName, seatsItems, seatsFront, seatsRemovePeople } from '../js/seats/model.js';
import { seatsParseDelimited, seatsNamesFromRows, seatsCsvCell } from '../js/seats/import.js';

test('34-table starting layout has the extra middle tables at the back and the specified four-seat and three-seat tables', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.tables.length, 34);
  assert.deepEqual(['A','B','C','D'].map(col => plan.tables.filter(table => table.column === col).length), [8,9,9,8]);
  assert.ok(plan.tables.find(table => table.id === 'B9').y > plan.tables.find(table => table.id === 'A8').y);
  assert.ok(plan.tables.find(table => table.id === 'C9').y > plan.tables.find(table => table.id === 'D8').y);
  assert.equal(plan.tables.reduce((sum, table) => sum + table.count, 0), 156);
  assert.ok(['A7','A8','D7','D8'].every(id => plan.tables.find(table => table.id === id).count === 3));
  assert.ok(plan.tables.filter(table => !['A7','A8','D7','D8','B2','C2','B5','C5','B6','C6'].includes(table.id)).every(table => table.count === 5));
  assert.ok(plan.tables.filter(table => table.column === 'A' && Number(table.id.slice(1)) <= 6).every(table => table.x === 17));
  assert.ok(plan.tables.filter(table => table.id.endsWith('1')).every(table => table.y === 70));
  const b6=plan.tables.find(table=>table.id==='B6');
  const row=['A3','B3','C3','D3'].map(id=>plan.tables.find(table=>table.id===id));
  const gaps=row.slice(1).map((table,index)=>table.x-row[index].x-row[index].width);
  assert.ok(gaps.every(gap=>gap>68&&Math.abs(gap-gaps[0])<.0001),'The three main aisle gaps should be even');
  assert.ok(b6.y+b6.height+14<=536);
  assert.equal(plan.tables.find(table=>table.id==='B7').y,598);
  for(const column of ['A','B','C','D']){
    const byRow=row=>plan.tables.find(table=>table.id===column+row);
    assert.equal(byRow(8).y-byRow(7).y-byRow(7).height,40);
    if(byRow(9))assert.equal(byRow(9).y-byRow(8).y-byRow(8).height,40);
  }
  assert.equal(plan.objects.find(object=>object.type==='bimah').x,548);
  for (const table of plan.tables) {
    for (const other of [...plan.tables.filter(other=>other.id!==table.id),...plan.objects]) {
      assert.ok(table.x+table.width<=other.x || other.x+other.width<=table.x || table.y+table.height<=other.y || other.y+other.height<=table.y,table.id+' overlaps '+other.id);
    }
  }
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

test('directory import finds name headers below title and note rows instead of reading house numbers', () => {
  const rows=[['Directory'],['Source notes'],['3 entries'],['House number','First name','Last name','Street','Notes'],
    [1,'Yosef','Cohen','Example Street',''],[2,'Moshe','Levi','Example Street','Check spelling'],[3,'דוד','כהן','Example Street','']];
  assert.deepEqual(seatsNamesFromRows(rows),['Yosef Cohen','Moshe Levi','דוד כהן']);
  assert.deepEqual(seatsNamesFromRows([['Directory'],['Number','Name'],[1,'Yosef Cohen'],[2,'Moshe Levi']]),['Yosef Cohen','Moshe Levi']);
  assert.deepEqual(seatsNamesFromRows([[123],['456'],['Yosef Cohen']]),['Yosef Cohen']);
});

test('deleting selected or all people clears their table and Rav seats and preserves the room and other plans', () => {
  const state=seatsCreateState(),plan=state.plans[0],other=seatsCreateState().plans[0];state.plans.push(other);
  seatsAddNames(plan,['Keep me','Seated person','Waiting person','Rav']);
  const [keep,seated,waiting,rav]=plan.people.map(person=>person.id);
  seatsAssign(plan,'A1',0,keep);seatsAssign(plan,'A1',1,seated);seatsAssign(plan,'rav-seat',0,rav);
  const original=structuredClone(state);
  assert.equal(seatsRemovePeople(plan,[seated,waiting,rav,'missing',seated]),3);
  assert.deepEqual(plan.people,[original.plans[0].people[0]]);
  assert.equal(plan.tables[0].seats[0],keep);assert.equal(plan.tables[0].seats[1],null);
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,[null]);
  assert.deepEqual(seatsNormalizeState(state),state);assert.deepEqual(other,original.plans[1]);
  assert.equal(seatsRemovePeople(plan,plan.people.map(person=>person.id)),1);
  assert.equal(plan.people.length,0);assert.equal(seatsAssigned(plan).size,0);
  assert.deepEqual(plan.tables.map(({seats,...table})=>table),original.plans[0].tables.map(({seats,...table})=>table));
  assert.deepEqual(plan.objects.map(({seats,...object})=>object),original.plans[0].objects.map(({seats,...object})=>object));
  assert.deepEqual(seatsNormalizeState(state),state);
});


test('table width follows seat count and preserves the wall or center anchor', () => {
  const plan=seatsCreateState().plans[0],left=plan.tables[0],middle=plan.tables.find(table=>table.id==='B1');
  const center=middle.x+middle.width/2;
  for(const [count,width] of [[3,144],[4,192],[5,240],[6,288]]){
    seatsSetCount(left,count);seatsSetCount(middle,count);
    assert.equal(left.width,width);assert.equal(left.x,17);
    assert.equal(middle.width,width);assert.equal(middle.x+middle.width/2,center);
  }
  middle.autoSize=false;middle.width=250;seatsSetCount(middle,3);assert.equal(middle.width,250);
});

test('typing and suggestions keep existing seats and create independently editable names', () => {
  const plan=seatsCreateState().plans[0];seatsAddNames(plan,['Yosef Cohen']);
  const dad=seatsWriteName(plan,'A1',0,'Yosef Cohen');assert.equal(plan.people.length,1);
  const child=seatsWriteName(plan,'A1',1,'Yosef Cohen',{duplicate:true});
  assert.notEqual(dad.id,child.id);assert.equal(plan.tables[0].seats[0],dad.id);assert.equal(plan.tables[0].seats[1],child.id);
  seatsWriteName(plan,'A1',1,'Child Cohen');assert.equal(plan.tables[0].seats[1],child.id);assert.equal(plan.people.length,2);assert.equal(plan.people.find(p=>p.id===child.id).name,'Child Cohen');
  const suggested=seatsWriteName(plan,'A2',0,'Yosef',{personId:dad.id});
  assert.notEqual(suggested.id,dad.id);assert.equal(suggested.name,'Yosef Cohen');
  assert.equal(plan.tables[0].seats[0],dad.id);assert.equal(plan.tables[1].seats[0],suggested.id);assert.equal(plan.tables[0].seats[1],child.id);
  assert.equal(seatsWriteName(plan,'A2',0,'Yosef',{personId:suggested.id}).id,suggested.id);assert.equal(plan.people.length,3);
  seatsWriteName(plan,'A2',0,'Another Cohen');assert.equal(plan.people.find(person=>person.id===dad.id).name,'Yosef Cohen');
  seatsWriteName(plan,'A2',1,'New Person');assert.equal(plan.people.length,4);
  assert.deepEqual(seatsNormalizeState({version:1,plans:[plan],activeId:plan.id}).plans[0],plan);
});

test('legacy layout migration retains people and assignments, returning excess rear seats to the list', () => {
  const plan=seatsCreateState().plans[0];delete plan.layoutVersion;plan.objects=[];
  for(const table of plan.tables){delete table.autoSize;delete table.anchor;table.count=null;table.seats=[];}
  seatsSetCount(plan.tables[0],5);seatsSetCount(plan.tables.find(table=>table.id==='A7'),5);
  seatsAddNames(plan,['Existing parent','Existing child']);
  const [dad,child]=plan.people.map(person=>person.id);
  seatsAssign(plan,'A1',0,dad);seatsAssign(plan,'A7',4,child);
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.layoutVersion,9);
  assert.equal(plan.tables[0].seats[0],dad);assert.equal(plan.people.length,2);
  assert.equal(plan.tables.find(table=>table.id==='A7').count,3);assert.ok(!seatsAssigned(plan).has(child));
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
});


test('front tables touch and the opposite-facing rav station fits between Aron Kodesh and C1', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const count of [5,6,4]){
    seatsSetCount(byId('D1'),count,plan);seatsSetCount(byId('C1'),count,plan);
    const front=seatsFront(plan),rav=plan.objects.find(object=>object.type==='rav');
    assert.equal(front.aron.x+front.aron.width/2,600,'The Aron must stay centered when front tables change size');
    assert.equal(byId('C1').x+byId('C1').width,byId('D1').x);
    assert.ok(byId('B1').x+byId('B1').width<front.aron.x);
    assert.ok(front.aron.x+front.aron.width<rav.x);
    assert.ok(rav.x+rav.width<byId('C1').x);
    assert.equal(front.aron.y,byId('B1').y);
  }
  seatsWriteName(plan,'rav-seat',0,'Rav Cohen');
  assert.equal(seatsAssigned(plan).size,1);assert.equal(seatsItems(plan).reduce((sum,table)=>sum+table.count,0),155);
  assert.deepEqual(seatsNormalizeState({version:1,activeId:plan.id,plans:[plan]}).plans[0],plan);
  byId('B1').x-=40;byId('C1').x+=30;
  assert.equal(seatsFront(plan).aron.x+seatsFront(plan).aron.width/2,600,'Moving tables must not move the Aron');
});

test('rear tables align with the front or the bookcase face and leave continuous walkways', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const id of ['A7','A8'])assert.equal(byId(id).x+byId(id).width,byId('A6').x+byId('A6').width);
  assert.equal(byId('D7').x+byId('D7').width,1159);
  assert.equal(byId('D8').x+byId('D8').width,1159);
  const cases=plan.objects.filter(object=>object.type==='cabinet');assert.equal(cases.length,5);
  assert.ok(cases.filter(object=>object.height>object.width).every(object=>object.y===byId('A8').y));
  assert.ok(byId('B9').y+byId('B9').height+14<828);
  assert.ok(cases.filter(object=>object.width>object.height).every(object=>object.y===936));
  for(const id of ['B2','C2','B5','C5','B6','C6'])assert.equal(byId(id).count,4);
  const amud=plan.objects.find(object=>object.type==='amud');
  assert.ok(amud.x>byId('B2').x+byId('B2').width);assert.ok(amud.x+amud.width<byId('C2').x);
});

test('version 2 layouts migrate without duplicating a bimah or losing named seats', () => {
  const plan=seatsCreateState().plans[0];plan.layoutVersion=2;plan.objects=plan.objects.filter(object=>object.type==='bimah');
  seatsSetCount(plan.tables.find(table=>table.id==='B2'),5);seatsAddNames(plan,['Existing name']);
  seatsAssign(plan,'B2',4,plan.people[0].id);
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.people.length,1);assert.equal(seatsAssigned(plan).size,0);
  assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
  assert.equal(plan.objects.filter(object=>object.type==='rav').length,1);assert.equal(plan.layoutVersion,9);
});


test('tables beside the amud and bimah align on the edges away from the fixtures', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const [id,reference] of [['B2','B3'],['B5','B4'],['B6','B4']]){
    assert.equal(byId(id).x,byId(reference).x);assert.equal(byId(id).anchor,'left');
    seatsSetCount(byId(id),3,plan);assert.equal(byId(id).x,byId(reference).x);
  }
  for(const [id,reference] of [['C2','C3'],['C5','C4'],['C6','C4']]){
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
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,9);
  assert.equal(b2.count,4);assert.equal(b2.x,plan.tables.find(table=>table.id==='B3').x);assert.ok(b2.seats[3]);
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
  assert.equal(plan.layoutVersion,9);
  for(const id of ['A7','B7','C7','D7'])assert.equal(byId(id).y,598);
  assert.equal(byId('B8').y,678);assert.equal(byId('B7').count,6);
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

test('version 5 plans widen automatic tables and keep displaced B5/C5 names on the waiting list', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const table of plan.tables){const old=table.width;table.width=43*(table.count??5);table.x+=(old-table.width)*(table.anchor==='left'?0:table.anchor==='right'?1:.5);}
  for(const id of ['B5','C5']){
    const table=byId(id);Object.assign(table,{count:5,width:215,anchor:'center',x:id==='B5'?300:685,seats:Array(5).fill(null)});
    seatsWriteName(plan,id,0,'Keep at '+id);seatsWriteName(plan,id,4,'Return from '+id);
  }
  Object.assign(byId('B8'),{autoSize:false,width:230,x:292,y:720});
  seatsWriteName(plan,'B8',0,'Custom table');
  plan.objects.push({id:'custom-pillar',type:'pillar',label:'Pillar',x:600,y:750,width:25,height:30});
  plan.layoutVersion=5;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),2);assert.equal(plan.layoutVersion,9);
  assert.equal(byId('A1').width,240);assert.equal(byId('B9').width,240);
  for(const id of ['B5','C5']){
    assert.equal(byId(id).count,4);assert.equal(byId(id).width,192);
    assert.equal(byId(id).seats[0],before.tables.find(table=>table.id===id).seats[0]);
    assert.ok(!seatsAssigned(plan).has(before.tables.find(table=>table.id===id).seats[4]));
  }
  assert.deepEqual(plan.people,before.people);assert.deepEqual(byId('B8'),{...before.tables.find(table=>table.id==='B8'),y:678});
  assert.deepEqual(plan.objects.find(object=>object.id==='custom-pillar'),before.objects.find(object=>object.id==='custom-pillar'));
  assert.equal(byId('B5').x,byId('B6').x);assert.equal(byId('C5').x+byId('C5').width,byId('C6').x+byId('C6').width);
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('version 6 plans balance the aisle gaps without changing names, seat counts, sizes or outer columns', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const column of ['B','C']){
    const reference=byId(column+'3'),oldCenter=column==='B'?407.5:792.5,shift=oldCenter-reference.x-reference.width/2;
    for(const table of plan.tables)if(table.column===column&&table.id!=='C1')table.x+=shift;
  }
  Object.assign(byId('B8'),{autoSize:false,width:230,x:292,y:720});
  seatsSetCount(byId('B5'),5);seatsWriteName(plan,'B5',4,'Keep fifth seat');
  seatsWriteName(plan,'C8',0,'Existing name');
  plan.layoutVersion=6;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,9);
  assert.deepEqual(plan.people,before.people);
  const row=['A3','B3','C3','D3'].map(byId),gaps=row.slice(1).map((table,index)=>table.x-row[index].x-row[index].width);
  assert.ok(gaps.every(gap=>Math.abs(gap-gaps[0])<.0001));assert.ok(gaps[0]>68);
  for(const table of plan.tables){
    const previous=before.tables.find(entry=>entry.id===table.id);
    assert.equal(table.count,previous.count);assert.equal(table.width,previous.width);assert.equal(table.height,previous.height);
    assert.equal(table.y,Number(table.id.slice(1))>=8?598+(Number(table.id.slice(1))-7)*80:previous.y);assert.deepEqual(table.seats,previous.seats);
    if(['A','D'].includes(table.column)||table.id==='C1')assert.equal(table.x,previous.x);
  }
  assert.ok(byId('B8').x>292);assert.equal(byId('B5').count,5);assert.ok(byId('B5').seats[4]);
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('version 7 plans close the extra rear row gap while preserving names, widths and column positions', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const column of ['A','B','C','D']){byId(column+'8').y=706;if(byId(column+'9'))byId(column+'9').y=784;}
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=706;cabinet.height=230;}
  byId('C7').height=54;Object.assign(byId('B8'),{autoSize:false,width:225});
  seatsWriteName(plan,'A8',0,'Rear name');seatsWriteName(plan,'B9',0,'Back name');seatsWriteName(plan,'rav-seat',0,'Rav name');
  plan.layoutVersion=7;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,9);assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){
    const old=before.tables.find(entry=>entry.id===table.id),row=Number(table.id.slice(1));
    assert.equal(table.x,old.x);assert.equal(table.width,old.width);assert.equal(table.height,old.height);assert.equal(table.count,old.count);assert.deepEqual(table.seats,old.seats);
    if(row<8)assert.equal(table.y,old.y);
    else{const previous=byId(table.column+(row-1));assert.equal(table.y-previous.y-previous.height,40);}
  }
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){assert.equal(cabinet.y,678);assert.equal(cabinet.height,258);}
  assert.deepEqual(plan.objects.filter(object=>!object.id.startsWith('rear-case-side-')),before.objects.filter(object=>!object.id.startsWith('rear-case-side-')));
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('version 8 plans center the Aron and keep assigned names and unrelated layout edits', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  byId('B1').x=325.6666666666667;byId('B8').y=700;
  Object.assign(plan.objects.find(object=>object.type==='rav'),{x:658.8888888888889,width:33});
  seatsWriteName(plan,'B1',0,'Front name');seatsWriteName(plan,'rav-seat',0,'Rav name');
  plan.layoutVersion=8;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,9);
  const {aron}=seatsFront(plan);assert.equal(aron.x+aron.width/2,600);
  assert.ok(byId('B1').x+byId('B1').width<aron.x);assert.equal(byId('C1').x+byId('C1').width,byId('D1').x);
  assert.deepEqual(plan.people,before.people);assert.deepEqual(byId('B1').seats,before.tables.find(table=>table.id==='B1').seats);
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,before.objects.find(object=>object.type==='rav').seats);
  assert.deepEqual(plan.tables.filter(table=>table.id!=='B1'),before.tables.filter(table=>table.id!=='B1'));
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('standard old tables become 40 high with 40 row gaps while names and custom dimensions are retained', () => {
  const state=seatsCreateState(),plan=state.plans[0];
  for(const table of plan.tables){const row=Number(table.id.slice(1));table.height=48;table.y=row>=7?598+(row-7)*78:70+(row-1)*78;}
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=676;cabinet.height=260;}
  plan.tables.push({id:'custom-table',label:'Custom',column:'',anchor:'left',autoSize:false,x:260,y:400,width:60,height:54,count:1,seats:[null]});
  seatsWriteName(plan,'B8',0,'Existing person');seatsWriteName(plan,'custom-table',0,'Custom person');
  plan.layoutVersion=8;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),0);assert.deepEqual(plan.people,before.people);
  for(const column of ['A','B','C','D']){
    const table=row=>plan.tables.find(table=>table.id===column+row);
    for(const row of [1,2,3,4,5,6,7,8,9]){
      const current=table(row);if(!current)continue;assert.equal(current.height,40);
      if(row>1&&row!==7)assert.equal(current.y-table(row-1).y-table(row-1).height,40);
      const previous=before.tables.find(table=>table.id===current.id);assert.equal(current.count,previous.count);assert.deepEqual(current.seats,previous.seats);
    }
  }
  assert.deepEqual(plan.tables.find(table=>table.id==='custom-table'),before.tables.find(table=>table.id==='custom-table'));
  assert.ok(plan.objects.filter(object=>object.id.startsWith('rear-case-side-')).every(object=>object.y===678&&object.height===258));
  assert.deepEqual(seatsNormalizeState(state),state);
});


test('old default plan names become 7:30 מנין without changing custom names or assignments', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.name, '7:30 מנין');
  seatsAddNames(plan, ['Existing person']); seatsAssign(plan, 'A1', 0, plan.people[0].id);
  plan.name = 'Main shul';
  const renamed = seatsNormalizeState(state);
  assert.equal(renamed.plans[0].name, '7:30 מנין');
  assert.deepEqual(renamed.plans[0].people, plan.people);
  assert.deepEqual(renamed.plans[0].tables, plan.tables);
  plan.name = 'Yomim Noraim';
  assert.equal(seatsNormalizeState(state).plans[0].name, 'Yomim Noraim');
});
