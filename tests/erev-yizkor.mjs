// Run with: node --test tests/erev-yizkor.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, resolveSettings } from '../js/settings.js';
import { buildSukkosPoster, SK_TEXT } from '../js/posters/sukkos.js';
import { buildPesachPoster, PS_TEXT } from '../js/posters/pesach.js';
import { buildYomKippurPoster } from '../js/posters/yomkippur.js';
import { buildRoshHashanaPoster } from '../js/posters/roshhashana.js';
import {
  erevShminiAtzeresText, erevYomKippurText, erevShviiShelPesachText,
  erevSukkosText, erevPesachText, erevRoshHashanaText,
} from '../js/erev-yomtov-text.js';

const settings = resolveSettings(DEFAULT_SETTINGS);
const sukkos = (year = 5787) => buildSukkosPoster(year, settings);
const block = (poster, heading) => poster.blocks.find((b) => b.heading.startsWith(heading));
const yizkor = (rows) => rows.find((row) => row.calc === 'yizkor');

test('Shemini Atzeres on Shabbos matches the requested message', () => {
  assert.equal(erevShminiAtzeresText(sukkos()), [
    'Erev Shemini Atzeres',
    'Mincha 1:20d, 1:35d, 1:50d, 2:15d, 3:00d',
    'Hadlakas Neiros 6:19',
    'Mincha 6:22m',
    'Yizkor on Shemini Atzeres, approximately 9:40d 10:55m.',
  ].join('\n'));
});

test('weekday Shemini Atzeres uses its different saved Yizkor times', () => {
  assert.match(erevShminiAtzeresText(sukkos(5786)),
    /Yizkor on Shemini Atzeres, approximately 9:10d 10:25m\.$/);
});

test('all three holiday messages follow changed sheet times and explicit room marks', () => {
  const cases = [
    [sukkos(), (p) => block(p, SK_TEXT.shmini).lines, erevShminiAtzeresText, 'Shemini Atzeres'],
    [buildYomKippurPoster(5787, settings), (p) => p.dayLines, erevYomKippurText, 'Yom Kippur'],
    [buildPesachPoster(5787, settings), (p) => block(p, PS_TEXT.achron).lines,
      erevShviiShelPesachText, 'Acharon Shel Pesach'],
  ];
  for (const [poster, rows, format, holiday] of cases) {
    yizkor(rows(poster)).times = [
      { text: '9:23', underlined: true },
      { text: '10:17', mark: '*' },
      { text: '10:42', mark: '**' },
      { text: '11:03' },
    ];
    const lines = format(poster).split('\n').filter((line) => line.startsWith('Yizkor'));
    assert.deepEqual(lines, [
      `Yizkor on ${holiday}, approximately 9:23d 10:17en 10:42sh 11:03m.`,
    ]);
  }
});

test('Yom Kippur and last days Pesach use their own holiday names and saved times', () => {
  assert.ok(erevYomKippurText(buildYomKippurPoster(5787, settings))
    .includes('Yizkor on Yom Kippur, approximately 11:55m.'));
  assert.ok(erevShviiShelPesachText(buildPesachPoster(5787, settings))
    .includes('Yizkor on Acharon Shel Pesach, approximately 10:20m.'));
});

test('missing or empty Yizkor rows do not invent an announcement or borrow another day', () => {
  for (const times of [[], [{ text: '' }], [null, {}]]) {
    const poster = sukkos();
    yizkor(block(poster, SK_TEXT.shmini).lines).times = times;
    assert.doesNotMatch(erevShminiAtzeresText(poster), /Yizkor/);
  }
  const poster = sukkos();
  const shemini = block(poster, SK_TEXT.shmini);
  shemini.lines = shemini.lines.filter((row) => row.calc !== 'yizkor');
  poster.blocks[0].lines.push({ calc: 'yizkor', times: [{ text: '8:01' }] });
  assert.doesNotMatch(erevShminiAtzeresText(poster), /Yizkor/);
  assert.doesNotMatch(erevYomKippurText({ dayLines: [] }), /Yizkor/);
  const pesach = buildPesachPoster(5787, settings);
  pesach.blocks = pesach.blocks.filter((b) => !b.heading.startsWith(PS_TEXT.achron));
  assert.doesNotMatch(erevShviiShelPesachText(pesach), /Yizkor/);
});

test('first-days and Rosh Hashana messages do not announce a later holiday Yizkor', () => {
  assert.doesNotMatch(erevSukkosText(sukkos()), /Yizkor/);
  assert.doesNotMatch(erevPesachText(buildPesachPoster(5787, settings)), /Yizkor/);
  assert.doesNotMatch(erevRoshHashanaText(buildRoshHashanaPoster(5787, settings)), /Yizkor/);
});
