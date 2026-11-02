import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateOriginalPlan, seatsSetCount, seatsAssign, seatsAddNames, seatsAssigned, seatsNormalizeState, seatsUpgradePlan, seatsWriteName, seatsItems, seatsFront, seatsRemovePeople, seatsNeedsUpgrade, seatsIsFixed } from '../js/seats/model.js';
import { seatsParseDelimited, seatsNamesFromRows, seatsCsvCell } from '../js/seats/import.js';

const seatsCreateState = () => { const plan = seatsCreateOriginalPlan(); return { version: 1, activeId: plan.id, plans: [plan] }; };

const rowTop = row => row >= 7 ? 648 + (row - 7) * 88 : 78 + (row - 1) * 88;

test('automatic paper fitting is saved while existing fixed paper preferences are retained', () => {
  const state=seatsCreateState();
  assert.equal(state.plans[0].paper,'auto');
  for(const paper of ['auto','letter','tabloid']){
    state.plans[0].paper=paper;
    assert.deepEqual(seatsNormalizeState(state),state);
  }
});

test('the original 34-table layout has the extra middle tables at the back and the specified four-seat and three-seat tables', () => {
  const state = seatsCreateState(), plan = state.plans[0];
  assert.equal(plan.tables.length, 34);
  assert.deepEqual(['A','B','C','D'].map(col => plan.tables.filter(table => table.column === col).length), [8,9,9,8]);
  assert.ok(plan.tables.find(table => table.id === 'B9').y > plan.tables.find(table => table.id === 'A8').y);
  assert.ok(plan.tables.find(table => table.id === 'C9').y > plan.tables.find(table => table.id === 'D8').y);
  assert.equal(plan.tables.reduce((sum, table) => sum + table.count, 0), 164);
  assert.equal(plan.tables.find(table => table.id === 'A7').count, 3);
  assert.ok(['A8','C1','B6','C6'].every(id => plan.tables.find(table => table.id === id).count === 4));
  assert.ok(plan.tables.filter(table => !['A7','A8','C1','B6','C6'].includes(table.id)).every(table => table.count === 5));
  assert.ok(plan.tables.filter(table => table.column === 'A' && Number(table.id.slice(1)) <= 6).every(table => table.x === 25));
  assert.ok(plan.tables.filter(table => table.id.endsWith('1')).every(table => table.y === 78));
  const b6=plan.tables.find(table=>table.id==='B6');
  const row=['A3','B3','C3','D3'].map(id=>plan.tables.find(table=>table.id===id));
  const gaps=row.slice(1).map((table,index)=>table.x-row[index].x-row[index].width);
  assert.ok(gaps.every(gap=>gap>63&&Math.abs(gap-gaps[0])<.0001),'The three main aisle gaps should be even');
  assert.ok(b6.y+b6.height+14<=586);
  assert.equal(plan.tables.find(table=>table.id==='B7').y,648);
  for(const column of ['A','B','C','D']){
    const byRow=row=>plan.tables.find(table=>table.id===column+row);
    assert.equal(byRow(8).y-byRow(7).y-byRow(7).height,48);
    if(byRow(9))assert.equal(byRow(9).y-byRow(8).y-byRow(8).height,48);
  }
  assert.equal(plan.objects.find(object=>object.type==='bimah').x,558.4);
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
    assert.equal(left.width,width);assert.equal(left.x,25);
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
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.layoutVersion,12);
  assert.equal(plan.tables[0].seats[0],dad);assert.equal(plan.people.length,2);
  assert.equal(plan.tables.find(table=>table.id==='A7').count,3);assert.ok(!seatsAssigned(plan).has(child));
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
});


test('front tables keep a small gap, wall clearance and the opposite-facing rav station beside the centered Aron', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const count of [5,6,4]){
    seatsSetCount(byId('D1'),count,plan);seatsSetCount(byId('C1'),count,plan);
    const front=seatsFront(plan),rav=plan.objects.find(object=>object.type==='rav');
    assert.equal(front.aron.x+front.aron.width/2,600,'The Aron must stay centered when front tables change size');
    assert.equal(front.aron.width,126);
    assert.ok(Math.abs(byId('D1').x-byId('C1').x-byId('C1').width-8)<.0001);
    assert.ok(byId('D1').x+byId('D1').width<=1159.0001);
    assert.ok(byId('B1').x+byId('B1').width<front.aron.x);
    assert.ok(front.aron.x+front.aron.width<rav.x);
    assert.ok(rav.x+rav.width<byId('C1').x);
    assert.equal(front.aron.y,byId('B1').y-8);
  }
  seatsWriteName(plan,'rav-seat',0,'Rav Cohen');
  assert.equal(seatsAssigned(plan).size,1);assert.equal(seatsItems(plan).reduce((sum,table)=>sum+table.count,0),164);
  assert.deepEqual(seatsNormalizeState({version:1,activeId:plan.id,plans:[plan]}).plans[0],plan);
  byId('B1').x-=40;byId('C1').x+=30;
  assert.equal(seatsFront(plan).aron.x+seatsFront(plan).aron.width/2,600,'Moving tables must not move the Aron');
});

test('rear tables align with the front or the right wall and leave continuous walkways', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const id of ['A7','A8'])assert.equal(byId(id).x+byId(id).width,byId('A6').x+byId('A6').width);
  assert.equal(byId('D7').x+byId('D7').width,1175);
  assert.equal(byId('D8').x+byId('D8').width,1175);
  const cases=plan.objects.filter(object=>object.type==='cabinet');assert.equal(cases.length,6);
  const small=cases.find(object=>object.id==='rear-case-a7');
  assert.deepEqual([small.x,small.y,small.width,small.height],[17,byId('A7').y,24,40]);
  assert.ok(small.x+small.width+8<byId('A7').x);assert.equal(seatsIsFixed(small),true);
  for(const [id,tableId] of [['rear-case-side-left','A8'],['rear-case-side-right','D8']]){
    const cabinet=cases.find(object=>object.id===id),table=byId(tableId);
    assert.equal(cabinet.y,table.y+table.height+14+8);assert.equal(cabinet.y+cabinet.height,936);
  }
  assert.ok(byId('B9').y+byId('B9').height+14<888);
  assert.ok(cases.filter(object=>object.width>object.height).every(object=>object.y===936));
  for(const id of ['C1','A8','B6','C6'])assert.equal(byId(id).count,4);
  for(const id of ['B2','C2','B5','C5','D7','D8'])assert.equal(byId(id).count,5);
  const amud=plan.objects.find(object=>object.type==='amud');
  assert.ok(amud.x>byId('B2').x+byId('B2').width);assert.ok(amud.x+amud.width<byId('C2').x);
});

test('version 2 layouts migrate without duplicating a bimah or losing named seats', () => {
  const plan=seatsCreateState().plans[0];plan.layoutVersion=2;plan.objects=plan.objects.filter(object=>object.type==='bimah');
  seatsSetCount(plan.tables.find(table=>table.id==='B2'),5);seatsAddNames(plan,['Existing name']);
  seatsAssign(plan,'B2',4,plan.people[0].id);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.people.length,1);assert.equal(seatsAssigned(plan).size,1);
  assert.equal(plan.objects.filter(object=>object.type==='bimah').length,1);
  assert.equal(plan.objects.filter(object=>object.type==='rav').length,1);assert.equal(plan.layoutVersion,12);
});


test('tables beside the amud and bimah align on the edges away from the fixtures', () => {
  const plan=seatsCreateState().plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const [id,reference] of [['B2','B3'],['B6','B4']]){
    assert.equal(byId(id).x,byId(reference).x);assert.equal(byId(id).anchor,'left');
    seatsSetCount(byId(id),3,plan);assert.equal(byId(id).x,byId(reference).x);
  }
  for(const [id,reference] of [['C2','C3'],['C6','C4']]){
    assert.equal(byId(id).x+byId(id).width,byId(reference).x+byId(reference).width);
    seatsSetCount(byId(id),3,plan);assert.equal(byId(id).x+byId(id).width,byId(reference).x+byId(reference).width);
  }
  const bimah=plan.objects.find(object=>object.type==='bimah');
  assert.equal(bimah.y,497);
  for(const id of ['B5','C5'])assert.ok(byId(id).y+byId(id).height+14<bimah.y,'Bimah is behind the fifth-row chairs');
  assert.equal(byId('B5').x,byId('B4').x);assert.equal(byId('C5').x+byId('C5').width,byId('C4').x+byId('C4').width);
  seatsSetCount(byId('B5'),3,plan);seatsSetCount(byId('C5'),3,plan);
  assert.equal(byId('B5').x,byId('B4').x);
  assert.equal(byId('C5').x+byId('C5').width,byId('C4').x+byId('C4').width);
  assert.equal(byId('D7').x,byId('D8').x);
});

test('version 3 alignment updates preserve names, seat counts, fixtures, and rear horizontal positions', () => {
  const plan=seatsCreateState().plans[0];plan.layoutVersion=3;
  const b2=plan.tables.find(table=>table.id==='B2'),d8=plan.tables.find(table=>table.id==='D8');
  b2.x=321.5;plan.tables.find(table=>table.id==='D7').x=1054;
  seatsWriteName(plan,'B2',3,'Existing Person');const before=JSON.stringify(plan.people),objects=JSON.stringify(plan.objects);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  assert.equal(b2.count,5);assert.equal(b2.x,plan.tables.find(table=>table.id==='B3').x);assert.ok(b2.seats[3]);
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
  assert.equal(plan.layoutVersion,12);
  for(const id of ['A7','B7','C7','D7'])assert.equal(byId(id).y,648);
  assert.equal(byId('B8').y,736);assert.equal(byId('B7').count,6);
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

test('version 5 plans widen automatic tables and preserve their B5/C5 fifth-seat names', () => {
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
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  assert.equal(byId('A1').width,240);assert.equal(byId('B9').width,240);
  for(const id of ['B5','C5']){
    assert.equal(byId(id).count,5);assert.equal(byId(id).width,240);
    assert.equal(byId(id).seats[0],before.tables.find(table=>table.id===id).seats[0]);
    assert.equal(byId(id).seats[4],before.tables.find(table=>table.id===id).seats[4]);
  }
  assert.deepEqual(plan.people,before.people);assert.deepEqual(byId('B8'),{...before.tables.find(table=>table.id==='B8'),y:736});
  assert.deepEqual(plan.objects.find(object=>object.id==='custom-pillar'),before.objects.find(object=>object.id==='custom-pillar'));
  const bimah=plan.objects.find(object=>object.type==='bimah');
  assert.equal(bimah.y,497);assert.ok(byId('B5').y+byId('B5').height+14<bimah.y);assert.ok(byId('C5').y+byId('C5').height+14<bimah.y);
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
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  assert.deepEqual(plan.people,before.people);
  const row=['A3','B3','C3','D3'].map(byId),gaps=row.slice(1).map((table,index)=>table.x-row[index].x-row[index].width);
  assert.ok(gaps.every(gap=>Math.abs(gap-gaps[0])<.0001));assert.ok(gaps[0]>63);
  for(const table of plan.tables){
    const previous=before.tables.find(entry=>entry.id===table.id);
    assert.equal(table.count,previous.count);assert.equal(table.width,previous.width);assert.equal(table.height,previous.height);
    assert.equal(table.y,rowTop(Number(table.id.slice(1))));assert.deepEqual(table.seats,previous.seats);
    if(['A','D'].includes(table.column)||table.id==='C1')assert.equal(table.x,previous.x);
  }
  assert.ok(byId('B8').x>292);assert.equal(byId('B5').count,5);assert.ok(byId('B5').seats[4]);
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('version 7 plans use common row spacing while preserving names, widths and column positions', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const column of ['A','B','C','D']){byId(column+'8').y=706;if(byId(column+'9'))byId(column+'9').y=784;}
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=706;cabinet.height=230;}
  byId('C7').height=54;Object.assign(byId('B8'),{autoSize:false,width:225});
  seatsWriteName(plan,'A8',0,'Rear name');seatsWriteName(plan,'B9',0,'Back name');seatsWriteName(plan,'rav-seat',0,'Rav name');
  plan.layoutVersion=7;const before=structuredClone(plan);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){
    const old=before.tables.find(entry=>entry.id===table.id),row=Number(table.id.slice(1));
    assert.equal(table.x,old.x);assert.equal(table.width,old.width);assert.equal(table.height,old.height);assert.equal(table.count,old.count);assert.deepEqual(table.seats,old.seats);
    assert.equal(table.y,rowTop(row));
  }
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){assert.equal(cabinet.y,798);assert.equal(cabinet.height,138);}
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
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  const {aron}=seatsFront(plan);assert.equal(aron.x+aron.width/2,600);
  assert.ok(byId('B1').x+byId('B1').width<aron.x);assert.ok(Math.abs(byId('D1').x-byId('C1').x-byId('C1').width-8)<.0001);
    assert.ok(byId('D1').x+byId('D1').width<=1159.0001);
  assert.deepEqual(plan.people,before.people);assert.deepEqual(byId('B1').seats,before.tables.find(table=>table.id==='B1').seats);
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,before.objects.find(object=>object.type==='rav').seats);
  assert.deepEqual(plan.tables.filter(table=>table.id!=='B1').map(({y,...table})=>table),before.tables.filter(table=>table.id!=='B1').map(({y,...table})=>table));
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  assert.deepEqual(seatsNormalizeState(state),state);
  const upgraded=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),upgraded);
});

test('standard old tables become 40 high with uniform gaps while names and custom dimensions are retained', () => {
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
      if(row>1&&row!==7)assert.equal(current.y-table(row-1).y-table(row-1).height,48);
      const previous=before.tables.find(table=>table.id===current.id);assert.equal(current.count,previous.count);assert.deepEqual(current.seats,previous.seats);
    }
  }
  assert.deepEqual(plan.tables.find(table=>table.id==='custom-table'),before.tables.find(table=>table.id==='custom-table'));
  assert.ok(plan.objects.filter(object=>object.id.startsWith('rear-case-side-')).every(object=>object.y===798&&object.height===138));
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


test('version 9 plans join the uniform room grid while preserving names and custom dimensions', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const table of plan.tables){const row=Number(table.id.slice(1));if(row>=7)table.y=598+(row-7)*80;}
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=678;cabinet.height=258;}
  byId('A3').height=48;byId('B8').width=225;byId('B8').autoSize=false;byId('D8').y=690;
  plan.objects.push({id:'custom-pillar',type:'pillar',label:'Pillar',x:600,y:750,width:25,height:30});
  seatsWriteName(plan,'A8',0,'Parent Cohen');seatsWriteName(plan,'B9',0,'Parent Cohen');
  plan.layoutVersion=9;const before=structuredClone(plan);
  assert.equal(seatsNormalizeState(state).plans[0].layoutVersion,9);
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){
    const old=before.tables.find(old=>old.id===table.id),row=Number(table.id.slice(1));
    assert.deepEqual({...table,y:old.y},old,'Only standard table vertical positions should change');
    assert.equal(table.y,rowTop(row));
    if(row>=8)assert.ok(table.y+table.height+14<888);
  }
  assert.deepEqual(plan.objects.filter(object=>!object.id.startsWith('rear-case-side-')),before.objects.filter(object=>!object.id.startsWith('rear-case-side-')));
  const left=plan.objects.find(object=>object.id==='rear-case-side-left');assert.equal(left.y,byId('A8').y+byId('A8').height+14+8);assert.equal(left.y+left.height,936);
  const right=plan.objects.find(object=>object.id==='rear-case-side-right');assert.equal(right.y,byId('D8').y+byId('D8').height+14+8);assert.equal(right.y+right.height,936);
  assert.deepEqual(seatsNormalizeState(state),state);const after=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),after);
});


test('version 10 plans evenly space all standard rows and keep assignments, sizes, and custom fixtures', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const table of plan.tables){const row=Number(table.id.slice(1));table.y=row>=7?598+(row-7)*110:70+(row-1)*80;}
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=708;cabinet.height=228;}
  plan.objects.find(object=>object.id==='main-amud').y=148;Object.assign(plan.objects.find(object=>object.type==='bimah'),{x:548,y:420,width:104,height:90});
  byId('B8').width=225;byId('B8').autoSize=false;byId('A3').height=48;
  plan.objects.push({id:'custom-pillar',type:'pillar',label:'Pillar',x:600,y:750,width:25,height:30});
  seatsWriteName(plan,'A2',0,'Parent Cohen');seatsWriteName(plan,'B9',0,'Parent Cohen');
  plan.layoutVersion=10;const before=structuredClone(plan);
  assert.equal(seatsNormalizeState(state).plans[0].layoutVersion,10);assert.equal(seatsUpgradePlan(plan),0);
  assert.equal(plan.layoutVersion,12);assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){const old=before.tables.find(old=>old.id===table.id);assert.equal(table.y,rowTop(Number(table.id.slice(1))));assert.deepEqual({...table,y:old.y},old);}
  assert.equal(plan.objects.find(object=>object.id==='main-amud').y,164);assert.equal(plan.objects.find(object=>object.type==='bimah').y,497);
  assert.deepEqual(plan.objects.find(object=>object.id==='custom-pillar'),before.objects.find(object=>object.id==='custom-pillar'));
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){assert.equal(cabinet.y,798);assert.equal(cabinet.y+cabinet.height,936);}
  assert.deepEqual(plan.objects.filter(object=>['rear-case-left','rear-case-center','rear-case-right'].includes(object.id)),before.objects.filter(object=>['rear-case-left','rear-case-center','rear-case-right'].includes(object.id)));
  assert.deepEqual(seatsNormalizeState(state),state);const after=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),after);
});

test('version 11 wall tables gain clear space while names, sizes and manual row edits survive', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const table of plan.tables){
    const row=Number(table.id.slice(1));table.y=row>=7?640+(row-7)*88:70+(row-1)*88;
    if(table.column==='A')table.x-=8;
    if(table.column==='D')table.x+=8;
    if(table.column==='B'&&row>1)table.x-=8/3;
    if(table.column==='C')table.x+=row===1?8:8/3;
  }
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){cabinet.y=728;cabinet.height=208;}
  Object.assign(plan.objects.find(object=>object.type==='rav'),seatsFront(plan).rav);
  plan.objects.find(object=>object.id==='main-amud').y=156;Object.assign(plan.objects.find(object=>object.type==='bimah'),{x:548,y:444,width:104,height:90});
  Object.assign(byId('B8'),{width:225,autoSize:false,y:750});
  seatsWriteName(plan,'A1',0,'Parent Cohen');seatsWriteName(plan,'B9',0,'Parent Cohen');seatsWriteName(plan,'rav-seat',0,'Rav Cohen');
  plan.layoutVersion=11;const before=structuredClone(plan);
  assert.equal(seatsNormalizeState(state).plans[0].layoutVersion,11);assert.equal(seatsUpgradePlan(plan),0);assert.equal(plan.layoutVersion,12);
  assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){const old=before.tables.find(old=>old.id===table.id);assert.deepEqual({...table,x:old.x,y:old.y},old);assert.equal(table.y,table.id==='B8'?750:rowTop(Number(table.id.slice(1))));}
  for(const column of ['A','D'])for(let row=1;row<=6;row++){const table=byId(column+row);assert.ok(Math.abs((column==='A'?table.x-17:1183-table.x-table.width)-(column==='D'&&row===1?24:8))<.0001);}
  for(const id of ['A1','B1','C1','D1'])assert.equal(byId(id).y-70,8);
  for(const id of ['D7','D8'])assert.equal(1183-byId(id).x-byId(id).width,8);
  for(const id of ['A7','A8'])assert.equal(byId(id).x+byId(id).width,byId('A6').x+byId('A6').width);
  assert.ok(Math.abs(byId('D1').x-byId('C1').x-byId('C1').width-8)<.0001);
    assert.ok(byId('D1').x+byId('D1').width<=1159.0001);assert.equal(seatsFront(plan).aron.x+seatsFront(plan).aron.width/2,600);
  const row=['A3','B3','C3','D3'].map(byId),gaps=row.slice(1).map((table,index)=>table.x-row[index].x-row[index].width);assert.ok(Math.max(...gaps)-Math.min(...gaps)<.001);
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,before.objects.find(object=>object.type==='rav').seats);
  assert.deepEqual(plan.objects.filter(object=>object.type==='cabinet'&&!object.id.startsWith('rear-case-side-')),before.objects.filter(object=>object.type==='cabinet'&&!object.id.startsWith('rear-case-side-')),'Back bookcases must keep their positions and sizes');
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){assert.equal(cabinet.y,798);assert.equal(cabinet.y+cabinet.height,936);}
  assert.deepEqual(seatsNormalizeState(state),state);const after=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),after);
});

test('manual full-width and full-height tables stay valid when wall clearance cannot fit', () => {
  const state=seatsCreateState(),plan=state.plans[0];
  plan.tables.push({id:'wide-custom',label:'Wide',column:'',anchor:'left',autoSize:false,x:17,y:870,width:1166,height:40,count:1,seats:[null]},
    {id:'tall-custom',label:'Tall',column:'',anchor:'left',autoSize:false,x:400,y:70,width:60,height:876,count:1,seats:[null]});
  seatsWriteName(plan,'wide-custom',0,'Wide Person');seatsWriteName(plan,'tall-custom',0,'Tall Person');
  plan.layoutVersion=11;const before=structuredClone(plan.tables.slice(-2));
  assert.equal(seatsUpgradePlan(plan),0);assert.deepEqual(plan.tables.slice(-2),before);assert.deepEqual(seatsNormalizeState(state),state);
});

test('the previous v12 room upgrades seat counts without deleting names and remains compatible with the shared wire format', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const [id,count,x] of [['C1',5,695],['B5',4,328+1/3],['C5',4,679+2/3],['D7',3,1007],['D8',3,1007],['A8',3,121]]){
    Object.assign(byId(id),{count,width:count*48,x,seats:Array(count).fill(null)});
  }
  Object.assign(byId('D1'),{count:5,width:240,x:935,seats:Array(5).fill(null)});
  Object.assign(byId('B8'),{autoSize:false,width:225,x:304,y:748});
  plan.objects.push({id:'retained-pillar',type:'pillar',label:'Custom pillar',x:600,y:750,width:25,height:30});
  seatsWriteName(plan,'C1',0,'Keep Front Name');seatsWriteName(plan,'C1',4,'Keep Waiting Name');
  seatsWriteName(plan,'B5',3,'Keep Bimah Name');seatsWriteName(plan,'D7',2,'Keep Rear Name');
  seatsWriteName(plan,'rav-seat',0,'Keep Rav Name');
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-')))Object.assign(cabinet,{y:728,height:208});
  const before=structuredClone(plan),waiting=byId('C1').seats[4];
  assert.equal(plan.layoutVersion,12);assert.equal(seatsNeedsUpgrade(plan),true);
  assert.equal(seatsUpgradePlan(plan),1);assert.equal(plan.layoutVersion,12);
  assert.deepEqual(plan.people,before.people);
  assert.equal(byId('C1').count,4);assert.deepEqual(byId('C1').seats,before.tables.find(table=>table.id==='C1').seats.slice(0,4));
  assert.equal(seatsAssigned(plan).has(waiting),false);assert.ok(plan.people.some(person=>person.id===waiting));
  for(const [id,count] of [['B5',5],['C5',5],['D7',5],['D8',5],['A8',4]]){
    assert.equal(byId(id).count,count);
    assert.deepEqual(byId(id).seats.slice(0,before.tables.find(table=>table.id===id).count),before.tables.find(table=>table.id===id).seats);
  }
  assert.ok(Math.abs(byId('D1').x-byId('C1').x-byId('C1').width-8)<.0001);
  assert.ok(byId('D1').x+byId('D1').width<=1159.0001);
  assert.deepEqual(byId('B8'),before.tables.find(table=>table.id==='B8'));
  assert.deepEqual(plan.objects.find(object=>object.id==='retained-pillar'),before.objects.find(object=>object.id==='retained-pillar'));
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,before.objects.find(object=>object.type==='rav').seats);
  for(const cabinet of plan.objects.filter(object=>object.id.startsWith('rear-case-side-'))){assert.equal(cabinet.y,798);assert.equal(cabinet.y+cabinet.height,936);}
  assert.deepEqual(seatsNormalizeState(state),state);
  assert.equal(seatsNeedsUpgrade(plan),false);
  const updated=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),updated);
});

test('the former 64-unit front inset moves D1 toward the opening while keeping custom counts, dimensions and assignments', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  seatsSetCount(byId('D1'),6);seatsSetCount(byId('B5'),4);seatsSetCount(byId('D7'),4);
  Object.assign(byId('C1'),{autoSize:false,x:682,y:78,width:170});
  Object.assign(byId('D1'),{autoSize:true,x:860,y:78,width:259});
  Object.assign(byId('B8'),{autoSize:false,width:225,x:304,y:748});
  seatsWriteName(plan,'C1',3,'Synthetic Front Person');seatsWriteName(plan,'D1',5,'Synthetic Right Person');
  seatsWriteName(plan,'B5',3,'Synthetic Custom Count Person');seatsWriteName(plan,'D7',3,'Synthetic Rear Person');
  seatsWriteName(plan,'rav-seat',0,'Synthetic Rav Person');
  const before=structuredClone(plan),counts=plan.tables.map(table=>[table.id,table.count]);
  assert.ok(Math.abs(byId('D1').x+byId('D1').width-1119)<.0001);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.people,before.people);assert.deepEqual(plan.tables.map(table=>[table.id,table.count]),counts);
  for(const table of plan.tables)assert.deepEqual(table.seats,before.tables.find(previous=>previous.id===table.id).seats);
  assert.ok(Math.abs(byId('D1').x+byId('D1').width-1159)<.0001);
  assert.ok(Math.abs(byId('D1').x-byId('C1').x-byId('C1').width-8)<.0001);
  assert.equal(byId('C1').width,170);assert.equal(byId('C1').autoSize,false);
  assert.deepEqual(byId('B8'),before.tables.find(table=>table.id==='B8'));
  assert.deepEqual(plan.objects.find(object=>object.type==='rav').seats,before.objects.find(object=>object.type==='rav').seats);
  const rav=plan.objects.find(object=>object.type==='rav'),aron=seatsFront(plan).aron;
  assert.ok(aron.x+aron.width<rav.x&&rav.x+rav.width<byId('C1').x);
  assert.equal(seatsNeedsUpgrade(plan),false);assert.deepEqual(seatsNormalizeState(state),state);
  const updated=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),updated);
});

test('the old D7/D8 inset moves to the right wall without changing names, custom sizes or unrelated layout', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  seatsSetCount(byId('D7'),4);Object.assign(byId('D8'),{autoSize:false,width:216});
  for(const id of ['D7','D8'])byId(id).x=1151-byId(id).width;
  byId('A7').x-=12;Object.assign(byId('B8'),{autoSize:false,width:225,x:304});
  seatsWriteName(plan,'D7',3,'Synthetic Right Rear Person');seatsWriteName(plan,'D8',4,'Synthetic Back Right Person');
  const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.people,before.people);assert.deepEqual(plan.objects,before.objects);
  for(const table of plan.tables){
    const previous=before.tables.find(item=>item.id===table.id);
    if(['D7','D8'].includes(table.id))assert.deepEqual(table,{...previous,x:1175-previous.width,anchor:'right'});
    else assert.deepEqual(table,previous);
  }
  assert.equal(seatsNeedsUpgrade(plan),false);assert.deepEqual(seatsNormalizeState(state),state);
  const after=JSON.stringify(plan);assert.equal(seatsUpgradePlan(plan),0);assert.equal(JSON.stringify(plan),after);
  seatsSetCount(byId('D7'),5,plan);assert.equal(byId('D7').x+byId('D7').width,1175);
});

test('adding the small A7 bookcase preserves existing tables, assignments and custom fixtures', () => {
  const state=seatsCreateState(),plan=state.plans[0];
  plan.objects=plan.objects.filter(object=>object.id!=='rear-case-a7');
  plan.tables.find(table=>table.id==='D7').x-=12;
  seatsWriteName(plan,'A7',0,'Synthetic A7 Person');
  const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.tables,before.tables);assert.deepEqual(plan.people,before.people);
  assert.deepEqual(plan.objects.filter(object=>object.id!=='rear-case-a7'),before.objects);
  assert.equal(plan.objects.filter(object=>object.id==='rear-case-a7').length,1);
  assert.equal(seatsNeedsUpgrade(plan),false);assert.deepEqual(seatsNormalizeState(state),state);
  const after=JSON.stringify(plan);seatsUpgradePlan(plan);assert.equal(JSON.stringify(plan),after);
});

test('the smaller amud adds the fifth B2/C2 seats while keeping names, outer edges and unrelated layout', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  for(const id of ['B2','C2']){seatsSetCount(byId(id),4);seatsWriteName(plan,id,3,'Synthetic '+id+' Person');}
  Object.assign(plan.objects.find(object=>object.id==='main-amud'),{x:568,y:164,width:64,height:48});
  byId('D7').x-=12;const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){
    const previous=before.tables.find(other=>other.id===table.id);
    if(['B2','C2'].includes(table.id)){
      assert.equal(table.count,5);assert.equal(table.width,240);assert.deepEqual(table.seats,[...previous.seats,null]);
      assert.equal(table.id==='B2'?table.x:table.x+table.width,table.id==='B2'?previous.x:previous.x+previous.width);
    }else assert.deepEqual(table,previous);
  }
  const amud=plan.objects.find(object=>object.id==='main-amud');assert.deepEqual([amud.x,amud.y,amud.width,amud.height],[581,169,38,38]);
  assert.deepEqual(plan.objects.filter(object=>object.id!=='main-amud'),before.objects.filter(object=>object.id!=='main-amud'));
  assert.equal(seatsNeedsUpgrade(plan),false);assert.deepEqual(seatsNormalizeState(state),state);
  const after=JSON.stringify(plan);seatsUpgradePlan(plan);assert.equal(JSON.stringify(plan),after);
});

test('the Bimah shrinks 20 percent around its center once and preserves names and other layout edits', () => {
  const plan=seatsCreateState().plans[0],bimah=plan.objects.find(object=>object.type==='bimah');
  Object.assign(bimah,{x:548,y:488,width:104,height:90});
  plan.tables.find(table=>table.id==='B8').x-=11;seatsWriteName(plan,'B5',0,'Synthetic Assigned Person');const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.equal(bimah.width,104*.8);assert.equal(bimah.height,90*.8);assert.equal(bimah.x+bimah.width/2,600);assert.equal(bimah.y+bimah.height/2,533);
  assert.deepEqual(plan.tables,before.tables);assert.deepEqual(plan.people,before.people);
  assert.deepEqual(plan.objects.filter(object=>object.id!==bimah.id),before.objects.filter(object=>object.id!==bimah.id));
  assert.equal(seatsNeedsUpgrade(plan),false);const after=JSON.stringify(plan);seatsUpgradePlan(plan);assert.equal(JSON.stringify(plan),after);
});

test('shrinking a moved standard Bimah keeps its center while custom-sized objects stay unchanged', () => {
  const plan=seatsCreateState().plans[0],bimah=plan.objects.find(object=>object.type==='bimah');
  Object.assign(bimah,{x:560,y:500,width:104,height:90});
  plan.objects.push({id:'custom-bimah',type:'bimah',label:'Custom',x:350,y:700,width:100,height:80});const custom=structuredClone(plan.objects.at(-1));
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(bimah.x+bimah.width/2,612);assert.equal(bimah.y+bimah.height/2,545);assert.deepEqual(plan.objects.at(-1),custom);
});

test('a wider centered Aron halves the former gap beside B1 without changing names, capacity or unrelated layout', () => {
  const plan=seatsCreateState().plans[0],b1=plan.tables.find(table=>table.id==='B1'),a1=plan.tables.find(table=>table.id==='A1');
  b1.x=308;plan.objects.find(object=>object.type==='rav').x=661.5;
  plan.tables.find(table=>table.id==='B8').x-=11;const oldGap=b1.x-a1.x-a1.width;
  seatsWriteName(plan,'B1',0,'Synthetic Front Person');const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.equal(b1.x,286.5);assert.equal(b1.x-a1.x-a1.width,oldGap/2);assert.equal(b1.width,240);assert.equal(b1.count,5);assert.deepEqual(b1.seats,before.tables.find(table=>table.id==='B1').seats);
  assert.deepEqual(plan.people,before.people);const aron=seatsFront(plan).aron;
  assert.equal(aron.width,126);assert.equal(aron.x+aron.width/2,600);assert.equal(aron.x-b1.x-b1.width,10.5);
  assert.deepEqual(plan.tables.filter(table=>table.id!=='B1'),before.tables.filter(table=>table.id!=='B1'));
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  const rav=plan.objects.find(object=>object.type==='rav');assert.equal(rav.width,40);assert.equal(rav.x-aron.x-aron.width,8);assert.equal(plan.tables.find(table=>table.id==='C1').x-rav.x-rav.width,8);
  assert.equal(seatsNeedsUpgrade(plan),false);const after=JSON.stringify(plan);seatsUpgradePlan(plan);assert.equal(JSON.stringify(plan),after);
});

test('the wider Aron preserves an already-left B1 and gives the old Rav station clearance', () => {
  const plan=seatsCreateState().plans[0],b1=plan.tables.find(table=>table.id==='B1'),rav=plan.objects.find(object=>object.type==='rav');
  b1.x=275;rav.x=661.5;seatsWriteName(plan,'rav-seat',0,'Synthetic Rav Person');const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.tables,before.tables);assert.deepEqual(plan.people,before.people);assert.deepEqual(rav.seats,before.objects.find(object=>object.type==='rav').seats);
  assert.equal(rav.x,671);assert.equal(rav.width,40);assert.equal(seatsNeedsUpgrade(plan),false);
});

test('C1 and D1 move slightly away from the doorway while preserving seats, names and the rest of the room', () => {
  const state=seatsCreateState(),plan=state.plans[0],byId=id=>plan.tables.find(table=>table.id===id);
  byId('C1').x=735;byId('D1').x=935;plan.objects.find(object=>object.type==='rav').x=669.5;
  seatsWriteName(plan,'C1',3,'Synthetic C1 Person');seatsWriteName(plan,'D1',4,'Synthetic D1 Person');
  byId('B8').x-=11;const before=structuredClone(plan);
  assert.equal(seatsNeedsUpgrade(plan),true);assert.equal(seatsUpgradePlan(plan),0);
  assert.deepEqual(plan.people,before.people);
  for(const table of plan.tables){const previous=before.tables.find(other=>other.id===table.id);assert.deepEqual(table,['C1','D1'].includes(table.id)?{...previous,x:previous.x-16}:previous);}
  assert.equal(1183-byId('D1').x-byId('D1').width,24);assert.equal(byId('D1').x-byId('C1').x-byId('C1').width,8);
  assert.deepEqual(plan.objects.filter(object=>object.type!=='rav'),before.objects.filter(object=>object.type!=='rav'));
  assert.equal(seatsFront(plan).aron.x+seatsFront(plan).aron.width/2,600);assert.deepEqual(seatsNormalizeState(state),state);
  assert.equal(seatsNeedsUpgrade(plan),false);const after=JSON.stringify(plan);seatsUpgradePlan(plan);assert.equal(JSON.stringify(plan),after);
});
