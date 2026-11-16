import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreatePlan, seatsNormalizeState, seatsWriteName } from '../js/seats/model.js';
import { seatsSharedPlan, seatsSharedDiff, seatsSharedApply, seatsSharedReverse } from '../js/seats/shared-model.js';
import { seatsHasContent } from '../js/seats/content.js';
import { seatsPrintNotes, seatsNormalizePrintNotes, seatsWrapPrintNote, SEATS_PRINT_NOTE_DEFAULTS } from '../js/seats/print-notes.js';

test('existing charts show the starting wording without adding fields or changing saved chart data', () => {
  const plan = seatsCreatePlan(), before = structuredClone(plan);
  assert.deepEqual(seatsPrintNotes(plan), SEATS_PRINT_NOTE_DEFAULTS);
  assert.deepEqual(seatsNormalizeState({version:1,activeId:plan.id,plans:[plan]}).plans[0], before);
  assert.deepEqual(plan, before); assert.equal(seatsHasContent(plan), false);
});

test('custom wording and deliberate blank fields survive backup normalization and count as a saved edit', () => {
  const plan = seatsCreatePlan();
  Object.assign(plan, seatsNormalizePrintNotes({printHeader:'  Revised   draft  ',printFooter:'  '}));
  assert.deepEqual(seatsPrintNotes(plan), {printHeader:'Revised draft',printFooter:''});
  assert.equal(seatsHasContent(plan), true);
  assert.deepEqual(seatsSharedPlan(plan), plan);
  assert.deepEqual(seatsNormalizePrintNotes({printHeader:null}), {});
  for (const value of [3,{},'x'.repeat(81)]) assert.throws(() => seatsNormalizePrintNotes({printHeader:value}));
  assert.throws(() => seatsNormalizePrintNotes({printFooter:'x'.repeat(241)}));
});

test('shared notes merge with independent seat edits and can be undone without removing the seat', () => {
  const base = seatsSharedPlan(seatsCreatePlan()), noteEdit = structuredClone(base), seatEdit = structuredClone(base);
  noteEdit.printHeader = 'Final draft'; noteEdit.printFooter = '';
  seatsWriteName(seatEdit, 'A1', 0, 'Synthetic Person');
  const changes = JSON.parse(JSON.stringify(seatsSharedDiff(base,noteEdit)));
  assert.ok(changes.every(change => change.before === null));
  const merged = seatsSharedApply(seatEdit, changes);
  assert.deepEqual(merged.people, seatEdit.people); assert.deepEqual(merged.tables, seatEdit.tables);
  assert.equal(merged.printHeader, 'Final draft'); assert.equal(merged.printFooter, '');
  assert.deepEqual(seatsSharedApply(merged,seatsSharedReverse(changes)), seatEdit);
  const conflict = {...base,printHeader:'Other wording'};
  assert.throws(() => seatsSharedApply(conflict,changes), /Another organizer changed/);
});

test('print notes wrap words and long unbroken text without losing characters', () => {
  const measure = text => text.length;
  assert.deepEqual(seatsWrapPrintNote('First Draft',7,measure), ['First','Draft']);
  assert.deepEqual(seatsWrapPrintNote('abcdefghijkl',5,measure), ['abcde','fghij','kl']);
  assert.deepEqual(seatsWrapPrintNote('',20,measure), []);
});
