import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { dateFromHebrew, excelWeekday } from '../js/hebrew-calendar.js';
import { chartReferenceDates, posterReferenceDates, zmanimReferences, referenceClock } from '../js/zmanim/references.js';
import { buildBehabShacharisPoster } from '../js/posters/shacharis.js';
import { buildAsaraBTevesPoster } from '../js/posters/asarabteves.js';
import { buildKayitzRow } from '../js/sheets/kayitz.js';
import { ceilToMinute, formatTime } from '../js/format.js';

const settings = resolveSettings(JSON.parse(await readFile(new URL('../data/published.json', import.meta.url))).settings);
const byKey = refs => Object.fromEntries(refs.map(ref => [ref.key, ref]));

test('chart date choices include the whole applicable week, including holiday stand-ins', () => {
  const sunday = dateFromHebrew(10, 10, 5787);
  assert.equal(excelWeekday(sunday), 1);
  assert.deepEqual(chartReferenceDates([{ serial: sunday + 3 }]), Array.from({ length: 7 }, (_, i) => sunday + i));
  assert.deepEqual(chartReferenceDates([{ serial: sunday + 6 }], true), Array.from({ length: 6 }, (_, i) => sunday + i));
  assert.equal(chartReferenceDates([{ serial: sunday + 6 }, { serial: sunday + 6 }]).length, 7);
});

test('BHB comparison dates retain only its three mornings; combined runs omit gaps', () => {
  const behab = buildBehabShacharisPoster(5787, 8, settings);
  assert.deepEqual(posterReferenceDates(behab), behab.days);
  assert.deepEqual(posterReferenceDates({ items: [{ poster: { span: { from: 10, to: 11 } } },
    { poster: { span: { from: 20, to: 20 } } }] }), [10, 11, 20]);
  assert.deepEqual(posterReferenceDates({ sheets: [{ span: { from: 30, to: 30 } }, behab] }), [30, ...behab.days]);
  assert.deepEqual(posterReferenceDates(null), []);
});

test('raw Shkiya and fast-night offsets agree with the existing schedules before their final rounding', () => {
  for (let year = 5784; year <= 5834; year++) {
    const full = buildAsaraBTevesPoster(year, settings), serial = full.span.from;
    const refs = byKey(zmanimReferences(serial, settings, 'maariv'));
    assert.equal(formatTime(ceilToMinute(refs.shkia.value)), full.sets.find(set => set.calc === 'shkia').note.text);
    const maariv = full.sets.find(set => set.calc === 'maariv');
    if (maariv) for (const [i, minutes] of [35, 50].entries()) {
      assert.equal(formatTime(ceilToMinute(refs['shkia-plus-' + minutes].value)), maariv.lines[0][i].text);
    }
    const morning = byKey(zmanimReferences(serial, settings, 'shacharis'));
    const hasNote = full.sets[0].lines.flat().some(time => time.timeNote);
    assert.equal(hasNote, morning.netz.value > (7 + 5 / 60) / 24, 'The reference Netz explains the actual Selichos-before-Shacharis note');
  }
});

test('all three Plag references use the same reckonings as the seasonal chart', () => {
  for (const year of [5786, 5787, 5790]) {
    const date = dateFromHebrew(1, 6, year);
    const friday = date + ((6 - excelWeekday(date) + 7) % 7);
    const refs = byKey(zmanimReferences(friday, settings, 'mincha', { weeklyLimit: true }));
    const row = buildKayitzRow({ serial: friday + 1 }, settings);
    for (const [key, reference] of [['I', 'plag-mga-72'], ['J', 'plag-mga'], ['K', 'plag-gra']]) {
      assert.equal(formatTime(ceilToMinute(refs[reference].value)), row.traces[key][1].plain());
      assert.equal(formatTime(ceilToMinute(refs[reference].value - 15 / 1440)), row.traces[key][0].plain());
    }
    assert(refs['gedola-lechumra'].value >= refs.gedola.value);
    assert(refs['gedola-lechumra'].value >= refs['chatzos-30'].value);
    assert.match(refs['gedola-week'].note, /rounded up to the whole minute/);
  }
});

test('references distinguish elevation settings where chart formulas use different sunsets', () => {
  const elevated = { ...settings, elevation: 400, useElevation: false };
  const refs = byKey(zmanimReferences(dateFromHebrew(10, 10, 5787), elevated, 'maariv'));
  assert(refs['shkia-elevation'].value > refs.shkia.value);
  assert(refs['shkia-elevation-plus-50'].value > refs['shkia-plus-50'].value);
  const same = byKey(zmanimReferences(dateFromHebrew(10, 10, 5787), { ...elevated, useElevation: true }, 'maariv'));
  assert.equal(same['shkia-elevation'], undefined, 'Identical elevation reckonings are shown once');
});

test('comparison clocks preserve a minute boundary and distinguish noon from midnight', () => {
  assert.equal(referenceClock(0), '12:00:00.00 AM');
  assert.equal(referenceClock(0.5), '12:00:00.00 PM');
  assert.equal(referenceClock(0.5 - 0.001 / 86400), '11:59:59.99 AM');
  assert.equal(referenceClock(NaN), 'Unavailable');
});
