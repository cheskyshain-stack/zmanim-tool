import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsFormatName } from '../js/seats/name-format.js';
import { seatsCreateState, seatsWriteName, seatsAddNames, seatsNormalizeState } from '../js/seats/model.js';
import { seatsNormalizeNameFile } from '../js/seats/name-files.js';

test('names lose outer/repeated spaces and gain capitals without losing initials or existing mixed case', () => {
  for (const [input, output] of [
    ['  yosef   cohen  ','Yosef Cohen'], ['\tchaim\n dovid  weiss\u00a0','Chaim Dovid Weiss'],
    ['y c cohen','Y C Cohen'], ['david McDonald','David McDonald'], ['O\'connor','O\'Connor'],
    ['chaim-dovid o’neill','Chaim-Dovid O’Neill'], ['sarah van der meer','Sarah van der Meer'],
    ['éliyahu lévy','Éliyahu Lévy'], ['  דוד   כהן  ','דוד כהן'], ["miller's family","Miller's Family"],
    ['  ',''], ['Yosef Chuam Cohen','Yosef Chuam Cohen'], ['COHEN','COHEN'],
  ]) { assert.equal(seatsFormatName(input), output); assert.equal(seatsFormatName(output), output, 'Formatting is idempotent'); }
});

test('typing, copying and matching existing people format names while keeping original assignments', () => {
  const plan=seatsCreateState().plans[0],original=seatsWriteName(plan,'A1',0,'  yosef   cohen  ');
  assert.equal(original.name,'Yosef Cohen');const copy=seatsWriteName(plan,'A2',0,'yosef cohen',{personId:original.id});
  assert.equal(copy.name,'Yosef Cohen');assert.notEqual(copy.id,original.id);assert.equal(plan.tables[0].seats[0],original.id);
  const legacy={id:'synthetic-legacy-format',name:'  lower   case  '};plan.people.push(legacy);
  seatsWriteName(plan,'A3',0,'lower case',{personId:legacy.id});assert.equal(legacy.name,'Lower Case');assert.equal(plan.tables[0].seats[0],original.id);
});

test('manual and uploaded name lists format before deduplication without merging assigned people', () => {
  const state=seatsCreateState(),plan=state.plans[0];
  assert.deepEqual(seatsAddNames(plan,['  yosef cohen ','Yosef   Cohen',' moshe  levi ','דוד כהן']),{added:3,duplicates:1});
  assert.deepEqual(plan.people.map(person=>person.name),['Yosef Cohen','Moshe Levi','דוד כהן']);
  assert.deepEqual(seatsNormalizeNameFile({name:'Original file label',names:[' lower  case ','Lower Case','david McDonald']}),{name:'Original file label',names:['Lower Case','David McDonald']});
  const legacy=structuredClone(state);legacy.plans[0].people[0].name='  original casing  ';
  assert.deepEqual(seatsNormalizeState(legacy),legacy,'Opening an older chart does not silently rewrite names or seats');
});

test('formatting that exceeds the name limit cannot add a copy or change an original assignment', () => {
  const plan=seatsCreateState().plans[0],person={id:'synthetic-format-limit',name:'ß'+'a'.repeat(159)};plan.people.push(person);plan.tables[0].seats[0]=person.id;
  const before=structuredClone(plan);
  assert.throws(()=>seatsWriteName(plan,'A2',0,'query',{personId:person.id}),/160 characters/);assert.deepEqual(plan,before);
  assert.throws(()=>seatsWriteName(plan,'A2',0,person.name),/160 characters/);assert.deepEqual(plan,before);
});
