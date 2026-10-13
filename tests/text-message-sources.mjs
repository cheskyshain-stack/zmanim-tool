import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_SETTINGS, resolveSettings, WEEKDAY_SHACHARIS } from '../js/settings.js';
import { erevTimes, erevShabbosText } from '../js/erev-text.js';
import { weekText } from '../js/week-text.js';
import { roshChodeshText } from '../js/rosh-chodesh-text.js';
import { tzomGedaliaText, asaraBTevesText } from '../js/taanis-text.js';
import { buildRoshHashanaPoster, RH_TEXT } from '../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../js/posters/yomkippur.js';
import { buildSukkosPoster, SK_TEXT } from '../js/posters/sukkos.js';
import { buildPesachPoster, PS_TEXT } from '../js/posters/pesach.js';
import { buildVasikinPoster } from '../js/posters/vasikin.js';
import { buildTzomGedaliaPoster } from '../js/posters/tzomgedalia.js';
import { buildAsaraBTevesPoster } from '../js/posters/asarabteves.js';
import { buildRoshChodeshShacharisPoster } from '../js/posters/shacharis.js';
import { buildChanukahPoster, chanukahScheduleLines } from '../js/posters/chanukah.js';
import { buildWeekdayRow, chanukahDaysThroughFriday } from '../js/sheets/weekday.js';
import { computeSeasonWeeks } from '../js/sheets/weeks.js';
import { rowFor } from '../js/sheets/rows.js';
import { dateFromHebrew, excelWeekday, hasRoshChodesh } from '../js/hebrew-calendar.js';
import {
  erevRoshHashanaText, erevYomKippurText, erevSukkosText, erevShminiAtzeresText,
  erevPesachText, erevShviiShelPesachText, cholHamoedText, hoshanaRabbaText, netzMinyanText,
} from '../js/erev-yomtov-text.js';

const settings = resolveSettings(DEFAULT_SETTINGS);
const tables = Object.fromEntries([['parshaChutz', 'parsha_chutz'], ['parshaEy', 'parsha_ey'], ['parshaNames', 'parsha_names'], ['specialDays', 'special_days']]
  .map(([key, name]) => [key, JSON.parse(fs.readFileSync(new URL(`../data/${name}.json`, import.meta.url)))]));
const room = time => time.mark === '**' ? 'sh' : time.mark === '*' ? 'en' : time.underlined ? 'd' : 'm';
const list = times => times.map(time => time.text + room(time)).join(', ');
const block = (poster, name) => poster.blocks.find(row => row.heading.startsWith(name));
const clocks = text => text.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
function postedClocks(value) {
  if (typeof value === 'string') return clocks(value);
  if (!value || typeof value !== 'object') return [];
  // Trace arithmetic and minyan metadata are not text printed on a poster.
  return Object.entries(value).filter(([key]) => !['trace', 'traces', 'minyanim', 'zmanim'].includes(key))
    .flatMap(([, item]) => postedClocks(item));
}

test('every holiday and full fast message quotes only its own poster across 51 years', () => {
  const kinds = new Set(); let messages = 0;
  for (let year = 5784; year <= 5834; year++) {
    const rh = buildRoshHashanaPoster(year, settings), yk = buildYomKippurPoster(year, settings);
    const sukkos = buildSukkosPoster(year, settings), pesach = buildPesachPoster(year, settings);
    const cases = [
      ['rh', rh, erevRoshHashanaText], ['yk', yk, erevYomKippurText],
      ['sukkos', sukkos, erevSukkosText], ['shemini', sukkos, erevShminiAtzeresText],
      ['pesach', pesach, erevPesachText], ['shvii', pesach, erevShviiShelPesachText],
      ['chm-sukkos', sukkos, p => cholHamoedText(p, SK_TEXT.cholHamoed)],
      ['chm-pesach', pesach, p => cholHamoedText(p, PS_TEXT.cholHamoed)],
      ['hoshana', sukkos, hoshanaRabbaText],
      ['netz-rh', buildVasikinPoster(year, settings, 'rh'), p => netzMinyanText(p, 'rh')],
      ['netz-yk', buildVasikinPoster(year, settings, 'yk'), p => netzMinyanText(p, 'yk')],
      ['gedalia', buildTzomGedaliaPoster(year, settings), tzomGedaliaText],
      ['asara', buildAsaraBTevesPoster(year, settings), asaraBTevesText],
    ];
    for (const [kind, poster, format] of cases) {
      const text = format(poster), allowed = new Set(postedClocks(poster));
      assert(text && clocks(text).length, `${kind}, ${year}: a real message`);
      for (const time of clocks(text)) assert(allowed.has(time), `${kind}, ${year}: ${time} is on its own poster`);
      kinds.add(kind); messages++;
    }
  }
  assert.equal(kinds.size, 13); assert.equal(messages, 663);
});

test('Rosh Hashana and Yom Kippur follow changed and removed erev rows', () => {
  const rh = buildRoshHashanaPoster(5787, settings);
  const morning = rh.erevLines.find(row => row.label === RH_TEXT.slichos.label);
  morning.times = [{ text: '6:12', mark: '**' }, { text: '7:03', underlined: true }];
  rh.erevLines.find(row => row.label === RH_TEXT.erevMincha.label).times = [{ text: '1:42', mark: '*' }];
  rh.erevLines.find(row => row.label === RH_TEXT.chatzos).times = [{ text: '12:47' }];
  assert.match(erevRoshHashanaText(rh), /Selichos 6:12sh, 7:03d\nChatzos 12:47\nMincha 1:42en/);
  const yk = buildYomKippurPoster(5787, settings);
  yk.erevLines.find(row => row.calc === 'erevShacharis').times = morning.times;
  yk.erevLines.find(row => row.calc === 'erevMincha').times = [{ text: '2:08', underlined: true }];
  assert.match(erevYomKippurText(yk), /Selichos 6:12sh, 7:03d\nMincha 2:08d/);
  rh.erevLines = []; yk.erevLines = [];
  assert.doesNotMatch(erevRoshHashanaText(rh), /Selichos|Chatzos/);
  assert.doesNotMatch(erevYomKippurText(yk), /Selichos/);
});

test('room marks survive underlined HTML and Friday messages use the common room key', () => {
  assert.deepEqual(erevTimes('<u>1:12</u>* / <u>1:28</u>** / 1:43').map(time => [time.text, room(time)]),
    [['1:12', 'en'], ['1:28', 'sh'], ['1:43', 'm']]);
  assert.match(erevShabbosText([{ key: 'I', header: 'מנחה ערב שבת' }], { I: '<u>1:12</u>* / 1:28** / <u>1:43</u>' }, 'Test'),
    /Mincha 1:12en, 1:28sh, 1:43d/);
});

test('Rosh Chodesh and Chanukah chart panels quote the same posted morning across 51 years', () => {
  for (let year = 5784; year <= 5834; year++) {
    const chanukah = buildChanukahPoster(year, settings);
    for (const row of chanukah.shacharisRows) {
      const days = chanukah.days.filter(day => day.isRoshChodesh === row.isRoshChodesh).map(day => day.serial);
      const expected = [{ ...row.cells[0], text: row.vasikin.time }, ...row.cells.slice(1)];
      const printed = erevTimes(chanukahScheduleLines(days, settings, { mergeAll: true }));
      assert.equal(list(printed), list(expected), `Chart and poster agree in ${year}`);
      const part = chanukahScheduleLines(days.slice(0, 1), settings, { mergeAll: true });
      assert.equal(erevTimes(part)[0].text, row.vasikin.time, 'A split chart page retains the posted first minyan');
    }
    for (const month of [8, 9, 10, 11, 12, 13, 14, 1, 2, 3, 4, 5, 6]) {
      const poster = buildRoshChodeshShacharisPoster(year, month, settings);
      if (!poster) continue;
      assert(roshChodeshText({ month }, poster.rows).endsWith(` Shacharis ${list(poster.rows)}`));
    }
  }
});

test('all Chanukah weeks include their actual mornings, including Rosh Chodesh and Friday', () => {
  let partial = 0, friday = 0;
  for (let year = 5784; year <= 5834; year++) {
    const start = dateFromHebrew(25, 9, year);
    const anchors = new Set(Array.from({ length: 8 }, (_, offset) => start + offset)
      .filter(day => excelWeekday(day) !== 7).map(day => day + 7 - excelWeekday(day)));
    for (const anchor of anchors) {
      const days = chanukahDaysThroughFriday(anchor, settings);
      const text = weekText(WEEKDAY_SHACHARIS, buildWeekdayRow({ serial: anchor }, settings), 'Test', anchor, settings);
      assert(text.includes('Chanuka'), 'Every covered week names the changed schedule');
      if (days.length < 6) { partial++; assert(text.includes('Shacharis (')); }
      for (const rc of [false, true]) {
        const group = days.filter(day => Boolean(hasRoshChodesh(day, settings)) === rc);
        if (!group.length) continue;
        const line = text.split('\n').find(line => line.startsWith('Shacharis (') && line.includes(rc ? 'Rosh Chodesh Teves - Chanuka;' : '(Chanuka;'));
        assert(line, `The ${rc ? 'Rosh Chodesh' : 'regular'} days have a line in ${year}`);
        assert.equal(line.slice(line.indexOf(') ') + 2), list(erevTimes(chanukahScheduleLines(group, settings, { mergeAll: true }))));
        if (group.some(day => excelWeekday(day) === 6)) { friday++; assert(line.includes('Friday')); }
      }
    }
  }
  assert(partial > 50 && friday > 40);
});

test('weekly and Erev Shabbos messages honor edited chart cells and the effective season', () => {
  const weeks = computeSeasonWeeks('choref', 5787, settings, tables).weeks;
  for (const week of weeks) {
    const source = rowFor(week, { season: 'choref', overrides: {} }, { rules: [] }, settings);
    const text = erevShabbosText(source.columns, source.row, week.parsha, week.specialParsha);
    const allowed = new Set(source.columns.flatMap(column => clocks(String(source.row[column.key] || ''))));
    for (const time of clocks(text)) assert(allowed.has(time));
  }
  const week = weeks[2], source = rowFor(week, { season: 'choref', overrides: {} }, { rules: [] }, settings);
  assert.match(erevShabbosText(source.columns, { ...source.row, I: '<u>1:41</u>* / 2:06**' }, 'Edited'), /1:41en, 2:06sh/);
  const text = weekText(WEEKDAY_SHACHARIS, { C: '<u>1:41</u>*', B: '8:37**' }, 'Edited', week.serial, settings);
  assert.match(text, /Mincha: 1:41en\nMariv: 8:37sh/);
});
