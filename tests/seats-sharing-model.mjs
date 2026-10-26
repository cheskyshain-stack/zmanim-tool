import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreatePlan, seatsWriteName } from '../js/seats/model.js';
import { seatsSharedPlan, seatsSharedDiff, seatsSharedApply, seatsSharedReverse } from '../js/seats/shared-model.js';

test('two organizers can update different seats at the same table without losing either name', () => {
  const base=seatsSharedPlan(seatsCreatePlan()),a=structuredClone(base),b=structuredClone(base);
  seatsWriteName(a,'B9',0,'First organizer');seatsWriteName(b,'B9',1,'Second organizer');
  const merged=seatsSharedApply(seatsSharedApply(base,seatsSharedDiff(base,a)),seatsSharedDiff(base,b));
  assert.equal(merged.people.find(person=>person.id===merged.tables.find(table=>table.id==='B9').seats[0]).name,'First organizer');
  assert.equal(merged.people.find(person=>person.id===merged.tables.find(table=>table.id==='B9').seats[1]).name,'Second organizer');
  assert.deepEqual(seatsSharedApply(merged,seatsSharedDiff(base,a)),merged,'Retries are idempotent');
});

test('concurrent edits to the same seat are rejected atomically', () => {
  const base=seatsSharedPlan(seatsCreatePlan()),a=structuredClone(base),b=structuredClone(base);
  seatsWriteName(a,'B9',0,'Keep this name');seatsWriteName(b,'B9',0,'Conflicting name');
  const confirmed=seatsSharedApply(base,seatsSharedDiff(base,a)),before=structuredClone(confirmed);
  assert.throws(()=>seatsSharedApply(confirmed,seatsSharedDiff(base,b)),/Another organizer changed B9, seat 1/);
  assert.deepEqual(confirmed,before);
});

test('undo changes only the originating organizer’s work and refuses to erase a newer edit', () => {
  const base=seatsSharedPlan(seatsCreatePlan()),a=structuredClone(base),b=structuredClone(base);
  seatsWriteName(a,'A2',0,'My name');seatsWriteName(b,'C8',1,'Other name');
  const mine=seatsSharedDiff(base,a),theirs=seatsSharedDiff(base,b),combined=seatsSharedApply(seatsSharedApply(base,mine),theirs);
  assert.deepEqual(seatsSharedApply(combined,seatsSharedReverse(mine)),b);
  const newer=structuredClone(a);newer.people.find(person=>person.name==='My name').name='Updated by other organizer';
  assert.throws(()=>seatsSharedApply(newer,seatsSharedReverse(mine)),/Another organizer changed/);
});

test('bulk deletions, copies, custom sizes and table moves round-trip through shared patches', () => {
  const base=seatsSharedPlan(seatsCreatePlan()),next=structuredClone(base);
  seatsWriteName(next,'A8',1,'Parent Cohen');seatsWriteName(next,'D7',1,'Parent Cohen');
  Object.assign(next.tables.find(table=>table.id==='B8'),{width:225,autoSize:false});next.name='Shared test';
  const changes=seatsSharedDiff(base,next),applied=seatsSharedApply(base,changes);
  assert.deepEqual(applied,seatsSharedPlan(next));assert.deepEqual(seatsSharedApply(applied,seatsSharedReverse(changes)),base);
});

test('invalid patches cannot modify identifiers, prototypes, missing seats or invalid name references', () => {
  const base=seatsSharedPlan(seatsCreatePlan());
  for(const patch of [
    {group:'tables',id:'A1',key:'id',before:'A1',after:'other'},
    {group:'__proto__',id:'A1',before:null,after:{}},
    {group:'plan',key:'__proto__',before:null,after:{}},
    {group:'tables',id:'A1',key:'seats',index:999,before:null,after:null},
    {group:'tables',id:'A1',key:'seats',index:0,before:null,after:'missing-person'},
    {group:'tables',id:'A1',key:'width',before:240,after:5000},
  ])assert.throws(()=>seatsSharedApply(base,[patch]));
});
