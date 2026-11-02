import test from 'node:test';
import assert from 'node:assert/strict';
import { SEATS_DEFAULT_ROOM } from '../js/seats/default-room.js';
import { seatsCreatePlan, seatsCreateOriginalPlan, seatsCreateState, seatsNeedsUpgrade, seatsUpgradePlan, seatsNormalizeState, seatsItems, seatsUsableCount, seatsSeatBlocked, seatsWriteName } from '../js/seats/model.js';
import { seatsHasContent } from '../js/seats/content.js';
import { seatsSharedPlan } from '../js/seats/shared-model.js';

test('new charts have the current 36-table room, updated counts and numbering, and 172 usable seats',()=>{
 const plan=seatsCreatePlan(),byLabel=label=>plan.tables.find(t=>t.label===label);
 assert.equal(plan.tables.length,36);assert.deepEqual(['A','B','C','D'].map(c=>plan.tables.filter(t=>t.column===c).length),[9,9,9,9]);
 for(const c of ['A','D'])assert.deepEqual(plan.tables.filter(t=>t.column===c).map(t=>t.label),Array.from({length:9},(_,i)=>c+(i+1)));
 for(const c of ['B','C'])assert.deepEqual(plan.tables.filter(t=>t.column===c).map(t=>t.label),[1,2,3,4,5,6,8,9,10].map(n=>c+n));
 assert.equal(byLabel('A9').count,3);for(const l of ['A8','C1','C2','B6','C6'])assert.equal(byLabel(l).count,4);
 assert.ok(plan.tables.filter(t=>!['A9','A8','C1','C2','B6','C6'].includes(t.label)).every(t=>t.count===5));
 for(const c of ['A','D']){assert.equal(byLabel(c+'7').y,528);assert.ok(byLabel(c+'7').y+byLabel(c+'7').height+14<586);assert.equal(byLabel(c+'8').y,648);assert.equal(byLabel(c+'9').y,736);}
 assert.equal(plan.people.length,0);assert.ok(seatsItems(plan).every(t=>t.seats.every(id=>id===null)));
 assert.equal(seatsItems(plan).reduce((sum,t)=>sum+seatsUsableCount(plan,t),0),172);
 assert.deepEqual(plan.tables.flatMap(t=>t.seats.flatMap((_,i)=>seatsSeatBlocked(plan,t.id,i)?[t.label+':'+(i+1)]:[])),['B8:2','C8:4']);
 assert.equal(seatsHasContent(plan),false);assert.equal(seatsNeedsUpgrade(plan),false);assert.equal(seatsUpgradePlan(plan),0);assert.deepEqual(seatsSharedPlan(plan),plan);
});
test('new charts retain the moved amud and bookcase and all four pillars without overlap at the front tables',()=>{
 const plan=seatsCreatePlan(),object=id=>plan.objects.find(o=>o.id===id);
 assert.equal(object('main-amud').y,188);assert.deepEqual([object('main-amud').width,object('main-amud').height],[38,38]);assert.equal(object('rear-case-a7').y,plan.tables.find(t=>t.label==='A9').y);assert.equal(object('rear-case-a7').label,'Small sefarim by A9');
 assert.equal(plan.objects.filter(o=>o.type==='pillar').length,4);
 for(const id of ['B4','C4']){const p=object('front-pillar-'+id),t=plan.tables.find(t=>t.id===id);assert.equal(p.y,320.7);assert.ok(Math.abs(t.y-p.y-p.height-1.3)<.001);assert.equal(seatsUsableCount(plan,t),t.count);}
});
test('the room template contains no people, assignments or saved-chart metadata and each chart is independent',()=>{
 assert.deepEqual(Object.keys(SEATS_DEFAULT_ROOM).sort(),['objects','tables']);for(const item of [...SEATS_DEFAULT_ROOM.tables,...SEATS_DEFAULT_ROOM.objects])for(const key of ['name','people','seats','createdAt','updatedAt','history'])assert.equal(key in item,false);
 const first=seatsCreatePlan('First blank chart'),before=structuredClone(seatsCreatePlan('Second blank chart'));
 seatsWriteName(first,'A1',0,'Synthetic Only First');first.tables[0].x+=10;first.objects.find(o=>o.type==='cabinet').y+=5;
 const next=seatsCreatePlan('Second blank chart');assert.notEqual(first.id,next.id);assert.notEqual(before.id,next.id);assert.deepEqual(next.people,[]);assert.equal(next.tables[0].x,before.tables[0].x);assert.deepEqual(next.tables,before.tables);assert.deepEqual(next.objects.filter(o=>o.type!=='bimah'),before.objects.filter(o=>o.type!=='bimah'));
});
test('existing original and current saved rooms keep their names, assignments and geometry without adopting the new template',()=>{
 for(const create of [seatsCreateOriginalPlan,seatsCreatePlan]){
  const plan=create('Synthetic saved chart');seatsWriteName(plan,'A1',0,'Synthetic Existing Person');plan.tables.find(t=>t.id==='A3').y+=3;
  const state={version:1,activeId:plan.id,plans:[plan]},before=structuredClone(state);assert.deepEqual(seatsNormalizeState(state),before);assert.equal(seatsUpgradePlan(plan),0);assert.deepEqual(state,before);
 }
 assert.equal(seatsHasContent(seatsCreateOriginalPlan()),false);assert.equal(seatsHasContent(seatsCreateState().plans[0]),false);
});
