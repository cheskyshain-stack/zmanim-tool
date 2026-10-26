import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreateState, seatsWriteName } from '../js/seats/model.js';
import { seatsSharedDiff } from '../js/seats/shared-model.js';
import { seatsDescribeChanges, seatsRecordMetadata } from '../js/seats/activity.js';
import { seatsCreateRecords } from '../js/seats/records.js';
import { seatsNormalizeNameFile } from '../js/seats/name-files.js';
import { seatsHasContent } from '../js/seats/content.js';

function setup(fresh = true) {
  const storage = new Map(); globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const state = seatsCreateState(), warnings = [];
  const options = { getState: () => state, getName: () => 'Organizer One', isShared: () => false, notify: message => warnings.push(message), fresh };
  return { state, warnings, options, records: seatsCreateRecords(options) };
}

test('chart creation date stays fixed while edits, undo and reload keep their own history', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T12:00:00Z') });
  const { state, records, options, warnings } = setup(), plan = state.plans[0], created = records.info(plan.id).createdAt;
  t.mock.timers.tick(1000); const before = structuredClone(plan);
  seatsWriteName(plan, 'A1', 0, 'Test Person'); records.sync();
  assert.equal(records.info(plan.id).createdAt, created); assert.equal(records.info(plan.id).updatedAt, '2026-10-26T12:00:01.000Z');
  assert.equal(records.info(plan.id).updatedBy, 'Organizer One'); assert.match(records.info(plan.id).history.at(-1).details.join(' '), /A1, seat 1: Empty → Test Person/);
  const edits = records.info(plan.id).history.length; records.sync(); assert.equal(records.info(plan.id).history.length, edits, 'Opening or saving an unchanged chart is not a new edit');
  t.mock.timers.tick(1000); state.plans[0] = before; records.sync();
  assert.match(records.info(plan.id).history.at(-1).details.join(' '), /Test Person → Empty/);
  const reloaded = seatsCreateRecords({ ...options, fresh: false }); assert.deepEqual(reloaded.info(plan.id), records.info(plan.id)); assert.deepEqual(warnings, []);
});

test('older charts retain unknown creation dates, and backup restores retain known dates', () => {
  const { state, records } = setup(false), plan = state.plans[0];
  assert.equal(records.info(plan.id).createdAt, null); plan.name = 'Renamed older chart'; records.sync();
  assert.equal(records.info(plan.id).createdAt, null); assert.ok(records.info(plan.id).updatedAt);
  const restored = structuredClone(plan); restored.id = crypto.randomUUID();
  records.restore(restored.id, { createdAt: '2026-01-02T10:00:00Z', updatedAt: '2026-03-04T12:00:00Z', updatedBy: 'Earlier organizer', history: [] });
  state.plans.push(restored); records.sync();
  assert.equal(records.info(restored.id).createdAt, '2026-01-02T10:00:00.000Z');
  assert.match(records.info(restored.id).history.at(-1).details[0], /Restored/);
  assert.deepEqual(seatsRecordMetadata({ revision: 4, updatedAt: '2026-03-04T12:00:00Z', updatedBy: 'Earlier organizer' }), { createdAt: null, createdBy: null, updatedAt: '2026-03-04T12:00:00Z', updatedBy: 'Earlier organizer' });
});

test('untouched drafts have no dates while undo and redo of real work retain accurate edit history', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T12:00:00Z') });
  const { state, options } = setup(false), plan = state.plans[0], empty = structuredClone(plan);
  const records = seatsCreateRecords({ ...options, isEligible: seatsHasContent });
  records.sync(); assert.equal(records.info(plan.id).createdAt, null); assert.equal(records.info(plan.id).history.length, 0);
  t.mock.timers.tick(1000); seatsWriteName(plan, 'A1', 0, 'History Test Person'); records.sync();
  const filled = structuredClone(plan), created = records.info(plan.id).createdAt;
  assert.equal(created, '2026-10-26T12:00:01.000Z');
  t.mock.timers.tick(1000); state.plans[0] = empty; records.sync();
  assert.equal(records.info(plan.id).updatedAt, '2026-10-26T12:00:02.000Z');
  assert.match(records.info(plan.id).history.at(-1).details.join(' '), /History Test Person → Empty/);
  t.mock.timers.tick(1000); state.plans[0] = filled; records.sync();
  assert.equal(records.info(plan.id).createdAt, created); assert.equal(records.info(plan.id).updatedAt, '2026-10-26T12:00:03.000Z');
  assert.match(records.info(plan.id).history.at(-1).details.join(' '), /Empty → History Test Person/);
  assert.equal(records.info(plan.id).history.filter(entry => entry.details.includes('Created chart')).length, 1);
});

test('change descriptions name seats and renames and summarize bulk name imports', () => {
  const before = seatsCreateState().plans[0], after = structuredClone(before); after.name = 'Named chart';
  seatsWriteName(after, 'B9', 0, 'New Test Person');
  const details = seatsDescribeChanges(before, after, seatsSharedDiff(before, after)).join(' ');
  assert.match(details, /Renamed chart/); assert.match(details, /Added 1 name/); assert.match(details, /B9, seat 1: Empty → New Test Person/);
});

test('shared name files normalize names independently of chart assignments and reject invalid files', () => {
  const file=seatsNormalizeNameFile({ name:' Family list ', names:['Yosef Cohen','  Yosef   Cohen ','דוד כהן','1234'] });
  assert.deepEqual(file,{name:'Family list',names:['Yosef Cohen','דוד כהן']});
  assert.throws(()=>seatsNormalizeNameFile({name:'',names:['Test']}),/Name the file/);
  assert.throws(()=>seatsNormalizeNameFile({name:'Bad file',names:[{}]}),/2,000 names/);
  assert.throws(()=>seatsNormalizeNameFile({name:'Empty file',names:['1234']}),/No names/);
});
