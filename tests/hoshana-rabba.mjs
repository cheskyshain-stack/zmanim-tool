// Run with: node --test tests/hoshana-rabba.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, resolveSettings } from '../js/settings.js';
import { buildSukkosPoster, SK_TEXT } from '../js/posters/sukkos.js';
import { hoshanaRabbaText } from '../js/erev-yomtov-text.js';

const settings = resolveSettings(DEFAULT_SETTINGS);
const poster = (year = 5787) => buildSukkosPoster(year, settings);
const rows = (p) => p.blocks.find((b) => b.heading === SK_TEXT.hoshana).lines;
const row = (p, calc) => rows(p).find((r) => r.calc === calc);

test('the sample matches the 5786 sheet, while 5787 uses its own morning times', () => {
  const night = 'MISHNA TORAH in the Ezras Nashim at 8:00 PM, followed by Maariv';
  assert.equal(hoshanaRabbaText(poster(5786)),
    `Hoshana Rabba\n${night}\nShacharis: 6:30d, NETZ 7:06, 7:30m, 8:20sh`);
  assert.equal(hoshanaRabbaText(poster()),
    `Hoshana Rabba\n${night}\nShacharis: 6:18d, NETZ 6:54, 7:30m, 8:20sh`);
});

test('changed sheet times and room marks reach the message', () => {
  const p = poster();
  row(p, 'mishna').times = [{ text: '8:15', mark: '**' }];
  const morning = row(p, 'hoshanaShacharis');
  morning.times = [{ text: '6:25', underlined: true }, { text: '7:45', mark: '*' }];
  morning.netz = '7:01';
  assert.equal(hoshanaRabbaText(p), [
    'Hoshana Rabba',
    'MISHNA TORAH in the Simcha Hall at 8:15 PM, followed by Maariv',
    'Shacharis: 6:25d, NETZ 7:01, 7:45en',
  ].join('\n'));
});

test('missing entries are omitted without borrowing from other days', () => {
  assert.equal(hoshanaRabbaText(null), '');
  assert.equal(hoshanaRabbaText({ blocks: [] }), '');
  const withoutMinyanim = poster();
  row(withoutMinyanim, 'hoshanaShacharis').times = [];
  assert.doesNotMatch(hoshanaRabbaText(withoutMinyanim), /Shacharis|NETZ/);
  const p = poster();
  const block = p.blocks.find((b) => b.heading === SK_TEXT.hoshana);
  block.lines = block.lines.filter((r) => r.calc !== 'mishnaMaariv');
  delete row(p, 'hoshanaShacharis').netz;
  assert.doesNotMatch(hoshanaRabbaText(p), /followed by Maariv|NETZ/);
  block.lines = block.lines.filter((r) => r.calc !== 'mishna');
  assert.doesNotMatch(hoshanaRabbaText(p), /MISHNA TORAH/);
  block.lines = [];
  assert.equal(hoshanaRabbaText(p), '');
});

test('NETZ metadata stays identical to the printed note across twenty years', () => {
  for (let year = 5787; year < 5807; year++) {
    const p = poster(year);
    const morning = row(p, 'hoshanaShacharis');
    assert.equal(morning.note, `(${SK_TEXT.netz} ${morning.netz})`, String(year));
    assert.ok(hoshanaRabbaText(p).includes(`NETZ ${morning.netz}`), String(year));
    assert.equal((hoshanaRabbaText(p).match(/followed by Maariv/g) || []).length, 1);
  }
});
