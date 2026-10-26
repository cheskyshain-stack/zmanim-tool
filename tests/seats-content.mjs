import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCreatePlan, seatsUpgradePlan } from '../js/seats/model.js';
import { seatsHasContent, seatsIsAutomaticChartName } from '../js/seats/content.js';

const copy = value => structuredClone(value);
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

test('automatic names include room titles and valid generated dates, while custom titles count as content', () => {
  const automatic = ['7:30', '7:30 מנין', '7:30 מניין', ' 7 : 30 MINYAN ', 'Main shul', 'Seating plan - Oct 26, 2026', 'Seating plan - Oct 26, 2026 (2)', 'Seating plan - Feb 29, 2028'];
  for (const name of automatic) {
    assert.equal(seatsIsAutomaticChartName(name), true, name);
    const plan = seatsCreatePlan(); plan.name = name;
    assert.equal(seatsHasContent(plan), false, name);
  }
  const custom = ['Yom Kippur family section', '7:30 family seats', 'Seating plan - Oct 26, 2026 family section', 'Seating plan - Smarch 26, 2026', 'Seating plan - Feb 30, 2026', 'Seating plan - Oct 26, 2026 (reserved)'];
  for (const name of custom) {
    assert.equal(seatsIsAutomaticChartName(name), false, name);
    const plan = seatsCreatePlan(); plan.name = name;
    assert.equal(seatsHasContent(plan), true, name);
  }
});

test('fresh canonical layouts stay empty despite factory IDs, ordering and print preferences', () => {
  const first = seatsCreatePlan(), second = seatsCreatePlan();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.objects.find(object => object.type === 'bimah').id, second.objects.find(object => object.type === 'bimah').id);
  assert.equal(seatsHasContent(first), false); assert.equal(seatsHasContent(second), false);
  second.tables.reverse(); second.objects.reverse(); second.paper = 'tabloid'; second.monochrome = false; second.layoutVersion = 1;
  assert.equal(seatsHasContent(second), false);
});

test('the latest room update keeps older untouched charts empty', () => {
  const plan=seatsCreatePlan();
  plan.objects=plan.objects.filter(object=>object.id!=='rear-case-a7');
  for(const table of plan.tables.filter(table=>['D7','D8'].includes(table.id)))table.x=1151-table.width;
  for(const table of plan.tables.filter(table=>['B2','C2'].includes(table.id))){table.count=4;table.seats=[null,null,null,null];table.width=192;if(table.id==='C2')table.x+=48;}
  Object.assign(plan.objects.find(object=>object.id==='main-amud'),{x:568,y:164,width:64,height:48});
  assert.equal(seatsUpgradePlan(plan),0);assert.equal(seatsHasContent(plan),false);
});

test('unassigned people and occupied table or Rav seats preserve content', () => {
  const waiting = seatsCreatePlan(); waiting.people.push({ id: 'waiting-example', name: 'Unassigned Example Person' });
  assert.equal(seatsHasContent(waiting), true);
  const assigned = seatsCreatePlan(); assigned.tables[0].seats[0] = 'missing-person';
  assert.equal(seatsHasContent(assigned), true, 'A dangling seat assignment still represents data that must be kept');
  const rav = seatsCreatePlan(); rav.objects.find(object => object.type === 'rav').seats[0] = 'missing-rav';
  assert.equal(seatsHasContent(rav), true);
});

test('layout edits, table IDs and manual sizing choices count as content', () => {
  const baseline = seatsCreatePlan();
  for (const [field, value] of [['x', 30], ['y', 82], ['width', 250], ['height', 44], ['count', 4], ['label', 'Reserved front table'], ['column', 'B'], ['anchor', 'center'], ['autoSize', false], ['id', 'custom-table-reference']]) {
    const plan = copy(baseline); plan.tables[0][field] = value;
    assert.equal(seatsHasContent(plan), true, field);
  }
  const added = copy(baseline); added.tables.push({ ...copy(added.tables[0]), id: 'added-example-table' });
  assert.equal(seatsHasContent(added), true);
  const removed = copy(baseline); removed.tables.pop(); assert.equal(seatsHasContent(removed), true);
});

test('room object edits and fixed IDs count as content while the default bimah UUID does not', () => {
  const baseline = seatsCreatePlan();
  for (const [field, value] of [['x', 552], ['y', 456], ['width', 110], ['height', 94], ['label', 'Custom bimah'], ['type', 'amud']]) {
    const plan = copy(baseline); plan.objects.find(object => object.type === 'bimah')[field] = value;
    assert.equal(seatsHasContent(plan), true, field);
  }
  const reference = copy(baseline); reference.objects.find(object => object.type === 'rav').id = 'custom-rav-reference';
  assert.equal(seatsHasContent(reference), true);
  const added = copy(baseline); added.objects.push({ id: 'example-pillar', type: 'pillar', label: 'Example pillar', x: 600, y: 600, width: 30, height: 30 });
  assert.equal(seatsHasContent(added), true);
  const removed = copy(baseline); removed.objects = removed.objects.filter(object => object.type !== 'bimah');
  assert.equal(seatsHasContent(removed), true);
});

test('sub-pixel numeric noise is ignored and content detection never mutates frozen inputs', () => {
  const baseline = seatsCreatePlan(), noise = copy(baseline); noise.tables[0].x += .0005; noise.objects[0].height += .0005;
  assert.equal(seatsHasContent(noise), false);
  const moved = copy(baseline); moved.tables[0].x += .002; assert.equal(seatsHasContent(moved), true);
  const input = frozen(noise), before = JSON.stringify(input);
  assert.equal(seatsHasContent(input), false); assert.equal(JSON.stringify(input), before);
  const occupied = copy(baseline); occupied.people.push({ id: 'frozen-example', name: 'Frozen Example Person' });
  assert.equal(seatsHasContent(frozen(occupied)), true);
});
