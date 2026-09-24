import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot, settings } from '../src/schedules.js';
import { validate } from '../src/model.js';
import { buildSukkosPoster, SK_TEXT } from '../../js/posters/sukkos.js';
import * as zmanim from '../../js/zmanim/zmanim.js';

const SUKKOS_PREVIEW = '2026-09-24T16:00:00Z';

test('the Sukkos board preserves every source block and public time', () => {
  const sheet = scheduleSnapshot(SUKKOS_PREVIEW).fullSheet;
  const source = buildSukkosPoster(5787, settings);
  assert.ok(sheet);
  assert.equal(sheet.title, SK_TEXT.title);
  assert.equal(sheet.year, 5787);
  assert.equal(sheet.blocks.length, 7);
  assert.deepEqual(sheet.blocks.map(b => b.heading), source.blocks.map(b => b.heading));

  let count = 0;
  source.blocks.forEach((block, index) => {
    const lines = block.lines.flatMap(line => [line, line.extra].filter(Boolean));
    const rows = sheet.blocks[index].rows;
    assert.equal(rows.length, lines.length, block.heading);
    rows.forEach((row, rowIndex) => {
      const line = lines[rowIndex];
      assert.equal(row.label, line.label, `${block.heading}: label ${rowIndex}`);
      assert.deepEqual(row.times, (line.times || []).map(t => ({
        text: t.text,
        underlined: !!t.underlined,
        mark: t.mark || '',
        name: t.name || ''
      })), `${block.heading}: times, locations and reckoning labels ${rowIndex}`);
      for (const note of [line.note, line.sub].filter(Boolean)) {
        assert.ok(row.note.includes(note), `${block.heading}: source note ${rowIndex}`);
      }
      count++;
    });
  });
  assert.equal(count, 45);
  assert.equal(new Set(sheet.blocks.flatMap(b => b.rows.map(r => r.id))).size, count);
});

test('the full sheet contains public fields only, without source calculation traces', () => {
  const sheet = scheduleSnapshot(SUKKOS_PREVIEW).fullSheet;
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(trace|internalName|createdBy|updatedBy|sponsor|privateNotes)$/i);
      walk(nested);
    }
  };
  walk(sheet);
  for (const time of sheet.blocks.flatMap(b => b.rows.flatMap(r => r.times))) {
    assert.deepEqual(Object.keys(time).sort(), ['mark', 'name', 'text', 'underlined']);
  }
});

test('ordinary weeks and Yom Kippur do not acquire the Sukkos sheet', () => {
  for (const at of ['2026-09-21T16:00:00Z', '2026-10-05T16:00:00Z', '2026-10-15T16:00:00Z']) {
    assert.equal(scheduleSnapshot(at).fullSheet, null, at);
  }
});

test('a visible control applying to unrelated dates does not suppress the Sukkos sheet', () => {
  const unrelated = validate({
    kind: 'schedule', status: 'published', title: 'DEVELOPMENT TEST: unrelated Yom Kippur control',
    startLocal: '2026-09-20T00:00', endLocal: '2026-10-10T00:00',
    data: { source: 'yk:5787', appliesFrom: '2026-09-21', appliesTo: '2026-09-21', portion: 'all', precedence: 41 }
  });
  assert.ok(unrelated.startsAt < SUKKOS_PREVIEW && SUKKOS_PREVIEW < unrelated.endsAt);
  const before = scheduleSnapshot(SUKKOS_PREVIEW);
  const after = scheduleSnapshot(SUKKOS_PREVIEW, [unrelated]);
  assert.deepEqual(after.fullSheet, before.fullSheet);
  assert.deepEqual(after.next, before.next);
});

test('the daily zmanim retain seconds and use the existing source calculations', () => {
  const functions = ['misheyakir10_2', 'sunrise', 'sofZmanShmaMGA72', 'sofZmanShmaGRA',
    'sofZmanTfilaGRA', 'solarNoon', 'minchaGedola', 'plagHamincha', 'sunset', 'tzaisGeonim8_5', 'tzais72'];
  // Include both sides of New York's spring and fall daylight-saving changes.
  for (const date of ['2026-03-07', '2026-03-08', '2026-09-24', '2026-10-31', '2026-11-01']) {
    const rows = scheduleSnapshot(date + 'T16:00:00Z').zmanim;
    assert.equal(rows.length, 11, date);
    assert.equal(new Set(rows.map(r => r.label)).size, 11, date);
    rows.forEach((row, index) => {
      assert.match(row.time, /^(?:[1-9]|1[0-2]):[0-5]\d:[0-5]\d$/, row.label);
      const [hours, minutes, seconds] = row.time.split(':').map(Number);
      const sourceSeconds = Math.round(zmanim[functions[index]](new Date(date + 'T00:00:00Z'), settings) * 86400);
      assert.equal((hours % 12) * 3600 + minutes * 60 + seconds, ((sourceSeconds % 43200) + 43200) % 43200, `${date}: ${row.label}`);
    });
  }
});

test('daily zmanim change on New York midnight rather than UTC midnight', () => {
  const sameDay = scheduleSnapshot('2026-09-25T03:59:00Z');
  const nextDay = scheduleSnapshot('2026-09-25T04:00:00Z');
  assert.equal(sameDay.date, '2026-09-24');
  assert.equal(nextDay.date, '2026-09-25');
  assert.deepEqual(sameDay.zmanim, scheduleSnapshot(SUKKOS_PREVIEW).zmanim);
  assert.notDeepEqual(nextDay.zmanim, sameDay.zmanim);
});
