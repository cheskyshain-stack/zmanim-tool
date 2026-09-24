import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSnapshot, settings, sunset } from '../src/schedules.js';
import { civil, schedulePresentation, splitChartDrashas } from '../src/presentation.js';
import { dateFromHebrew, excelWeekday, hasSpecialParsha } from '../../js/hebrew-calendar.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';
import { shabbosMinchaParts, tishaBavMaariv } from '../../js/sheets/common.js';
import { buildRoshHashanaPoster } from '../../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../../js/posters/yomkippur.js';
import { buildPesachPoster } from '../../js/posters/pesach.js';
import { buildSukkosPoster } from '../../js/posters/sukkos.js';
import { publicPosterSections } from '../../js/ui/posters-view.js';
import parshaChutz from '../../data/parsha_chutz.json' with { type: 'json' };
import parshaEY from '../../data/parsha_ey.json' with { type: 'json' };
import parshaNames from '../../data/parsha_names.json' with { type: 'json' };
import specialDays from '../../data/special_days.json' with { type: 'json' };

const tables = { parshaChutz, parshaEY, parshaNames, specialDays };
const snapshotOn = date => scheduleSnapshot(date + 'T16:00:00Z');
const rowsOf = snapshot => snapshot.presentation.special.sections.flatMap(section => section.rows);
const withoutBidi = text => text.replace(/[\u2066-\u2069\u200e\u200f]/g, '');
const timeText = row => row.times.map(time => withoutBidi(time.text)).join('\n');
const sourceFamily = (rows, serial, column) => rows.filter(row => row.id === `chart:${serial}:${column}` || row.id.startsWith(`chart:${serial}:${column}:`));
const rowFixture = text => ({ id: 'chart:fixture:C', label: 'מנחה', times: [{ text }], note: 'הערת המקור' });

// Read the visible clocks and their place marks independently of how rows are split.
function markedClocks(times) {
  return times.flatMap(time => {
    let depth = 0;
    const clocks = [];
    for (const match of time.text.matchAll(/\uE000|\uE001|\d{1,2}:\d{2}\*?/g)) {
      if (match[0] === '\uE000') depth++;
      else if (match[0] === '\uE001') depth = Math.max(0, depth - 1);
      else clocks.push({ text: match[0].replace(/\*$/, ''), underlined: !!time.underlined || depth > 0, mark: match[0].endsWith('*') ? '*' : time.mark || '' });
    }
    return clocks;
  });
}

function assertSourceAfternoon(snapshot, serial, source) {
  const rows = sourceFamily(rowsOf(snapshot), serial, 'C');
  assert.deepEqual(rows.map(row => row.label), ['מנחה', 'דרשה', 'מנחה'], civil(serial));
  const sourceLines = withoutBidi(source).split('\n');
  assert.equal(timeText(rows[0]), sourceLines[0], 'The earlier Mincha run stays before the drasha');
  assert.equal(timeText(rows[1]), sourceLines[1].replace(/^דרשה\s+/, ''), 'The source supplies the drasha time');
  assert.equal(timeText(rows[2]), sourceLines[2], 'The later Mincha run stays after the drasha');
  assert.deepEqual(markedClocks(rows.flatMap(row => row.times)), markedClocks([{ text: source }]));
  for (const row of rowsOf(snapshot).filter(row => /מנחה/.test(row.label))) {
    assert.doesNotMatch(timeText(row) + '\n' + row.note, /דרשה/, civil(serial) + ' cannot leave a drasha inside Mincha');
  }
  assert.equal(new Set(rowsOf(snapshot).map(row => row.id)).size, rowsOf(snapshot).length, 'Every displayed row has a unique id');
}

test('the April 11, 2027 screenshot week gives the 5:55 drasha its own row', () => {
  const snapshot = snapshotOn('2027-04-11');
  const serial = dateFromHebrew(10, 1, 5787);
  assert.equal(snapshot.presentation.special.id, '2027-04-17');
  assertSourceAfternoon(snapshot, serial, shabbosMinchaParts(dateFromSerial(serial), settings, 'הגדול').text);
  assert.equal(timeText(sourceFamily(rowsOf(snapshot), serial, 'C')[1]), '5:55');
});

test('Shabbos Shuva 2026 separates the 5:15 drasha and preserves both Mincha runs', () => {
  const serial = dateFromHebrew(8, 7, 5787);
  const snapshot = snapshotOn('2026-09-19');
  assertSourceAfternoon(snapshot, serial, shabbosMinchaParts(dateFromSerial(serial), settings, 'שובה').text);
  assert.equal(timeText(sourceFamily(rowsOf(snapshot), serial, 'C')[1]), '5:15');
});

test('Shuva and Hagadol retain the actual source text and marks for twenty years', () => {
  let count = 0;
  for (let year = 5787; year < 5807; year++) {
    for (const [month, first, name] of [[7, 3, 'שובה'], [1, 8, 'הגדול']]) {
      let serial = dateFromHebrew(first, month, year);
      while (excelWeekday(serial) !== 7) serial++;
      assert.equal(hasSpecialParsha(serial, settings), name, `${year}: ${name}`);
      const source = shabbosMinchaParts(dateFromSerial(serial), settings, name).text;
      assertSourceAfternoon(snapshotOn(civil(serial)), serial, source);
      count++;
    }
  }
  assert.equal(count, 40);
});

test('hand-edited named drashas preserve labels, times, underlines, stars, and source order', () => {
  const source = rowFixture('1:40 / \uE0004:35\uE001\nדרשת שבת שובה מאת הרב שליט״א 5:05*\nמנחה (בעזר״נ) 6:05*\n\uE0006:20\uE001');
  const before = structuredClone(source);
  const rows = splitChartDrashas(source);
  assert.deepEqual(rows.map(row => row.label), ['מנחה', 'דרשת שבת שובה מאת הרב שליט״א', 'מנחה (בעזר״נ)', 'מנחה']);
  assert.deepEqual(rows.map(timeText), ['1:40 / \uE0004:35\uE001', '5:05*', '6:05*', '\uE0006:20\uE001']);
  assert.deepEqual(markedClocks(rows.flatMap(row => row.times)), markedClocks(source.times));
  assert.deepEqual(rows.map(row => row.note).filter(Boolean), [source.note], 'A source note is printed once');
  assert.deepEqual(source, before, 'Splitting cannot mutate the source row');
  assert.deepEqual(splitChartDrashas(source), rows, 'Row ids remain stable');
});

test('untimed drashas remain complete announcements on their own rows', () => {
  for (const label of ['דרשה', 'דרשה מאת הרב שליט״א לאחר מנחה', 'דברי התעוררות מאת הרב שליט״א']) {
    const rows = splitChartDrashas(rowFixture(`1:40\n${label}\n\uE0006:30\uE001`));
    assert.deepEqual(rows.map(row => row.label), ['מנחה', label, 'מנחה']);
    assert.deepEqual(rows[1].times, [], label + ' does not acquire an invented time');
    assert.deepEqual(rows.map(timeText), ['1:40', '', '\uE0006:30\uE001']);
  }
});

test('an underline spanning multiple source lines remains balanced in each displayed row', () => {
  const source = rowFixture('\uE0001:40 / 4:45*\nדרשה מאת הרב שליט״א 5:15\n6:14 / 6:29\uE001\n7:00*');
  const rows = splitChartDrashas(source);
  assert.deepEqual(rows.map(row => row.label), ['מנחה', 'דרשה מאת הרב שליט״א', 'מנחה']);
  assert.deepEqual(markedClocks(rows.flatMap(row => row.times)), markedClocks(source.times));
  for (const time of rows.flatMap(row => row.times)) {
    let depth = 0;
    for (const mark of time.text.match(/[\uE000\uE001]/g) || []) {
      depth += mark === '\uE000' ? 1 : -1;
      assert.ok(depth >= 0, 'Each row starts with its own opening underline');
    }
    assert.equal(depth, 0, 'An underline cannot leak into another row');
  }
  assert.deepEqual(markedClocks(rows.at(-1).times).at(-1), { text: '7:00', underlined: false, mark: '*' });
});

test('rich-text chart cells preserve the drasha boundary in the returned schedule', () => {
  const serial = dateFromHebrew(10, 1, 5787);
  const week = { serial, date: dateFromSerial(serial), parsha: 'מצורע', specialParsha: 'הגדול' };
  for (const tag of ['div', 'p']) {
    const source = `1:40 / <u>4:45</u><${tag}>דרשה מאת הרב שליט״א 5:15<br>6:14 / <u>6:29*</u></${tag}>`;
    // A trusted rule supplies the rich-text cell without requiring the editor's
    // DOM sanitizer in this Node test. Presentation receives the same cell text.
    const state = {
      rules: [{ enabled: true, condition: { always: true }, columnKeys: ['kayitz:C'], mode: 'replace', value: source }],
      sheets: [{ id: 'edited', season: 'kayitz', weeks: [week] }],
    };
    const presentation = schedulePresentation({
      serial: serial - 6, state, settings, tables, instant: civil(serial - 6) + 'T16:00:00Z', sunset,
      day: daySerial => ({ date: civil(daySerial), events: [] }),
    });
    const rows = sourceFamily(presentation.special.sections.flatMap(section => section.rows), serial, 'C');
    assert.deepEqual(rows.map(row => row.label), ['מנחה', 'דרשה מאת הרב שליט״א', 'מנחה'], tag);
    assert.deepEqual(rows.map(timeText), ['1:40 / \uE0004:45\uE001', '5:15', '6:14 / \uE0006:29*\uE001'], tag);
  }
});

test('a drasha-bearing Tisha BAv source keeps every named event in source order', () => {
  const source = rowFixture('שקיעה 8:12\nדרשה 8:45\nזמן 72 9:24\nמעריב 9:35');
  source.label = 'מעריב';
  const rows = splitChartDrashas(source);
  assert.deepEqual(rows.map(row => row.label), ['שקיעה', 'דרשה', 'זמן 72', 'מעריב']);
  assert.deepEqual(rows.map(timeText), ['8:12', '8:45', '9:24', '9:35']);
});

test('every relevant Tisha BAv evening for twenty years has separately labeled source times', () => {
  let cases = 0, postponed = 0;
  for (let year = 5787; year < 5807; year++) {
    for (const day of [8, 9]) {
      const serial = dateFromHebrew(day, 5, year);
      const source = tishaBavMaariv(serial, settings);
      if (!source) continue;
      const snapshot = snapshotOn(civil(serial));
      const rows = sourceFamily(rowsOf(snapshot), serial, 'B');
      assert.deepEqual(rows.map(row => row.label), ['דרשה', 'זמן 72', 'מעריב'], civil(serial));
      assert.deepEqual(rows.map(timeText), source.split('\n').slice(1).map(line => line.match(/\d{1,2}:\d{2}/)[0]), civil(serial));
      assert.ok(rowsOf(snapshot).some(row => timeText(row).includes(source.split('\n')[0])), 'The printed sunset also remains present');
      assert.ok(rows.every(row => !/דרשה|זמן|מעריב/.test(timeText(row))), 'Names belong in their own label columns');
      cases++;
      if (day === 9) postponed++;
    }
  }
  assert.ok(cases > 0);
  assert.ok(postponed > 0, 'The dates include a postponed fast');
});

test('ordinary rows and prose that merely mention a drasha remain unchanged', () => {
  for (const source of ['1:40 / \uE0005:30\uE001\n6:00 / 6:30*', '1:40\nלאחר הדרשה מנחה בבית המדרש', '8:10\nזמן 72 8:22']) {
    const row = rowFixture(source);
    assert.deepEqual(splitChartDrashas(row), [row]);
  }
});

test('Rosh Hashana, Yom Kippur, Pesach, and Sukkos keep their full original poster rows', () => {
  for (const [date, key, build] of [
    ['2026-09-12', 'rh', buildRoshHashanaPoster],
    ['2026-09-21', 'yk', buildYomKippurPoster],
    ['2027-04-22', 'pesach', buildPesachPoster],
    ['2026-09-26', 'sukkos', buildSukkosPoster],
  ]) {
    const snapshot = snapshotOn(date);
    assert.equal(snapshot.specialSheet.sourceId, `${key}:5787`);
    assert.deepEqual(snapshot.specialSheet.sections, publicPosterSections(key, build(5787, settings)), key);
    const posterRows = rowsOf(snapshot).filter(row => !row.id.startsWith('chart:'));
    assert.ok(posterRows.length, key);
    for (const row of posterRows) assert.deepEqual(splitChartDrashas(row), [row], key + ': ' + row.label);
  }
});
