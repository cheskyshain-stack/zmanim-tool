import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { roshHashana } from '../js/hebrew-calendar.js';
import { behabText, behabMessagesBetween } from '../js/behab-text.js';
import { buildBehabShacharisPoster } from '../js/posters/shacharis.js';
import { erevWhereMark } from '../js/erev-text.js';

const json = async name => JSON.parse(await readFile(new URL('../data/' + name + '.json', import.meta.url)));
const [published, parshaChutz, parshaEY, parshaNames, specialDays] = await Promise.all([
  'published', 'parsha_chutz', 'parsha_ey', 'parsha_names', 'special_days',
].map(json));
const settings = resolveSettings(published.settings), tables = { parshaChutz, parshaEY, parshaNames, specialDays };

test('The Behab message uses the chart times and rooms, with later minyanim separated', () => {
  const poster = buildBehabShacharisPoster(5787, 8, settings, tables);
  assert.equal(behabText(poster, poster.days[0]), [
    'Tomorrow Behab',
    '6:40m (Selichos before Shacharis), 7:00en, 7:15d, 7:35sh',
    'The following will NOT be saying Behab:',
    '8:00m, 8:20en, 8:40d',
  ].join('\n'));
  assert(behabText(poster, poster.days[0], poster.days[0]).startsWith('Today Behab\n'));
  assert.equal(behabText(poster, poster.days[0] + 1), '');
  assert.equal(behabText(null, poster.days[0]), '');
  const changed = { ...poster, rows: poster.rows.map((row, i) => i === 1 ? { ...row, text: '7:02', mark: '', underlined: true } : row) };
  assert.match(behabText(changed, poster.days[0]), /7:02d/);
  assert(!behabText(changed, poster.days[0]).includes('7:00en'), 'Message follows source rows instead of storing its own time list');
});

test('Each morning retains only its own chart Selichos note, including a mixed round', () => {
  for (const [year, month, notes] of [[5787, 8, [true, true, true]], [5786, 8, [true, true, false]], [5793, 8, [false, true, true]], [5787, 2, [false, false, false]]]) {
    const poster = buildBehabShacharisPoster(year, month, settings, tables);
    assert.deepEqual(poster.days.map(day => behabText(poster, day).includes('Selichos before Shacharis')), notes);
  }
});

test('All six Behab dates per Hebrew year match the chart across 51 years', () => {
  for (let year = 5780; year <= 5830; year++) {
    const from = roshHashana(year - 3761), to = roshHashana(year - 3760) - 1;
    const messages = behabMessagesBetween(from, to, settings, tables);
    const posters = [8, 2].map(month => buildBehabShacharisPoster(year, month, settings, tables));
    assert.equal(messages.length, 6, 'Six mornings in ' + year);
    assert.deepEqual(messages.map(message => message.day), posters.flatMap(poster => poster.days));
    assert.equal(new Set(messages.map(message => message.day)).size, 6);
    for (const [i, poster] of posters.entries()) for (const day of poster.days) {
      const message = messages.find(message => message.day === day);
      assert.equal(message.round, i ? 'After Pesach' : 'After Sukkos');
      assert.equal(message.year, year);
      const actual = message.text.match(/\d{1,2}:\d{2}(?:en|sh|d|m)/g);
      assert.deepEqual(actual, poster.rows.map(row => row.text + erevWhereMark(row)), 'Every chart time and room in ' + year);
    }
  }
});

test('Date windows include today, exclude past mornings and stop at the requested end', () => {
  const poster = buildBehabShacharisPoster(5787, 8, settings, tables), first = poster.days[0];
  assert.equal(behabMessagesBetween(first - 5, first - 1, settings, tables).length, 0);
  assert.equal(behabMessagesBetween(first - 4, first, settings, tables).length, 1);
  assert(behabMessagesBetween(first, first, settings, tables)[0].text.startsWith('Today Behab'));
  assert.deepEqual(behabMessagesBetween(first + 1, poster.days[2], settings, tables).map(message => message.day), poster.days.slice(1));
});
