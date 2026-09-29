import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot, settings } from '../src/schedules.js';
import { validate } from '../src/model.js';
import { buildSukkosPoster, SK_TEXT } from '../../js/posters/sukkos.js';
import { publicPosterSections } from '../../js/ui/posters-view.js';
import * as zmanim from '../../js/zmanim/zmanim.js';
import { dateFromHebrew } from '../../js/hebrew-calendar.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';

const SUKKOS_PREVIEW = '2026-09-24T16:00:00Z';

test('the Sukkos board preserves the original page sections and public times', () => {
  const sheet = scheduleSnapshot(SUKKOS_PREVIEW).specialSheet;
  const source = buildSukkosPoster(5787, settings);
  assert.ok(sheet);
  assert.equal(sheet.title, SK_TEXT.title);
  assert.equal(sheet.year, 5787);
  assert.equal(sheet.sections.length, 7);
  assert.deepEqual(sheet.sections, publicPosterSections('sukkos', source));
  assert.equal(sheet.sections.flatMap(s => s.rows).length, 45);
  assert.equal('fullSheet' in scheduleSnapshot(SUKKOS_PREVIEW), false);
});

test('the original sheet contains public fields only, without calculation traces', () => {
  const sheet = scheduleSnapshot(SUKKOS_PREVIEW).specialSheet;
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(trace|calc|internalName|createdBy|updatedBy|sponsor|privateNotes)$/i);
      walk(nested);
    }
  };
  walk(sheet);
  for (const time of sheet.sections.flatMap(b => b.rows.flatMap(r => r.times || []))) {
    assert.ok(Object.keys(time).every(key => ['mark', 'name', 'text', 'underlined'].includes(key)));
    assert.equal(typeof time.text, 'string');
  }
});

test('ordinary weeks do not acquire a special sheet; Yom Kippur uses the combined occasion page', () => {
  const sheet=scheduleSnapshot('2026-09-21T16:00:00Z').specialSheet;
  assert.equal(sheet.sourceId, 'high-holidays:5787');
  assert.equal(sheet.windowSourceId, 'yk:5787');
  for (const at of ['2026-10-15T16:00:00Z', '2027-01-15T16:00:00Z']) {
    assert.equal(scheduleSnapshot(at).specialSheet, null, at);
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
  assert.deepEqual(after.specialSheet, before.specialSheet);
  assert.deepEqual(after.next, before.next);
});

test('the daily zmanim retain seconds and use the existing source calculations', () => {
  const functions = ['alos72', 'misheyakir10_2', 'sunrise', 'sofZmanShmaMGA72', 'sofZmanShmaGRA',
    'sofZmanTfilaMGA72', 'sofZmanTfilaGRA', 'solarNoon', 'sunset', 'tzaisGeonim8_5', 'tzais72'];
  const labels = ['עלות', 'טלית ותפילין', 'נץ', 'סזק"ש מ"א', 'סזק"ש גר"א',
    'סז"ת מ"א', 'סז"ת גר"א', 'חצות', 'שקיעה', "צאת ג' כוכבים", 'צאת 72'];
  // Include both sides of New York's spring and fall daylight-saving changes.
  for (const [date, tallisLabel] of [['2026-03-07','טלית'], ['2026-03-08','טלית ותפילין'], ['2026-09-24','טלית ותפילין'], ['2026-10-31','טלית'], ['2026-11-01','טלית ותפילין']]) {
    const rows = scheduleSnapshot(date + 'T16:00:00Z').zmanim;
    assert.equal(rows.length, 11, date);
    assert.deepEqual(rows.map(r => r.label), labels.map((label,index)=>index===1?tallisLabel:label), date);
    assert.equal(new Set(rows.map(r => r.label)).size, 11, date);
    rows.forEach((row, index) => {
      assert.match(row.time, /^(?:[1-9]|1[0-2]):[0-5]\d:[0-5]\d$/, row.label);
      const [hours, minutes, seconds] = row.time.split(':').map(Number);
      const sourceSeconds = Math.round(zmanim[functions[index]](new Date(date + 'T00:00:00Z'), settings) * 86400);
      assert.equal((hours % 12) * 3600 + minutes * 60 + seconds, ((sourceSeconds % 43200) + 43200) % 43200, `${date}: ${row.label}`);
    });
  }
});

test('tallis omits tefillin on every full Yom Tov, including second days and Yom Kippur', () => {
  for (const year of [5787,5788,5806]) {
    for (const [month,days] of [[7,[1,2,10,15,16,22,23]],[1,[15,16,21,22]],[3,[6,7]]]) {
      for (const day of days) {
        const date=dateFromSerial(dateFromHebrew(day,month,year)).toISOString().slice(0,10);
        assert.equal(scheduleSnapshot(date+'T16:00:00Z').zmanim[1].label,'טלית',`${day}/${month}/${year}`);
      }
    }
  }
});

test('tallis label follows the New York date of the daily times, not the upcoming chart', () => {
  for (const [instant,label] of [
    ['2026-09-25T16:00:00Z','טלית ותפילין'], // Erev Sukkos; the holiday chart is already visible.
    ['2026-09-26T03:59:00Z','טלית ותפילין'], // Still Friday's daily zmanim in New York.
    ['2026-09-26T04:00:00Z','טלית'], // Saturday and first day Sukkos.
    ['2026-09-28T16:00:00Z','טלית ותפילין'], // Weekday Chol Hamoed retains its existing label.
    ['2026-10-10T16:00:00Z','טלית'], // Ordinary Shabbos.
    ['2026-10-11T16:00:00Z','טלית ותפילין'], // Ordinary Sunday.
  ]) assert.equal(scheduleSnapshot(instant).zmanim[1].label,label,instant);
});

test('MGA72 tefila is 24 minutes before GRA in both existing proportional-day modes', () => {
  for (const date of ['2026-01-15', '2026-03-08', '2026-06-21', '2026-09-24', '2026-11-01']) {
    for (const useAstronomicalChatzos of [false, true]) {
      const d = new Date(date + 'T00:00:00Z'), s = { ...settings, useAstronomicalChatzos };
      const mga = zmanim.sofZmanTfilaMGA72(d, s), gra = zmanim.sofZmanTfilaGRA(d, s);
      // Extending each end of the GRA day by 72 minutes moves its fourth hour
      // 24 minutes earlier, including when morning hours end at solar noon.
      assert.ok(Math.abs((gra - mga) * 1440 - 24) < 1e-8, date);
      assert.ok(zmanim.sofZmanShmaMGA72(d, s) < mga && mga < zmanim.solarNoon(d, s), date);
    }
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
