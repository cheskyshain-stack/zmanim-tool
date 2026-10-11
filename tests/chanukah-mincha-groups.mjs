import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { dateFromHebrew, excelWeekday } from '../js/hebrew-calendar.js';
import { buildChanukahPoster, toCell } from '../js/posters/chanukah.js';
import { clockMins, AFTERNOON } from '../js/posters/minyanim.js';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name, import.meta.url)));
const [config, parshaChutz, parshaEY, parshaNames] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEY, parshaNames };
const cells = times => times.map(({ text, underlined, mark }) => [text, underlined, mark]);

test('the approved compact layout uses full menus and the first actual date to order its groups', () => {
  const poster = buildChanukahPoster(5787, settings, tables);
  assert.deepEqual(poster.minchaRows.map(row => [row.label, row.times.map(time => time.text)]), [
    ['ערב שבת · פרשת וישב ומקץ', ['12:30', '1:00', '1:15', '1:35', '1:50', '2:15', '3:00']],
    ['יום א׳', ['12:30', '1:00', '1:15', '1:35', '1:50', '4:15']],
    ['יום ב׳ ג׳ ד׳ ה׳', ['1:00', '1:15', '1:35', '1:50', '4:15']],
  ]);
  assert.deepEqual(buildChanukahPoster(5785, settings, tables).minchaRows.map(row => row.kind),
    ['weekday', 'friday', 'sunday'], 'The weekday group moves first when it starts before Friday');
  assert.deepEqual(buildChanukahPoster(5787, { ...settings, english: true }, tables).minchaRows.map(row => row.label),
    poster.minchaRows.map(row => row.label), 'Compact parsha labels remain Hebrew in English admin mode');
});

test('51 years retain every covered date, complete menu, room mark and calculation trace', () => {
  const firstKinds = new Set();
  let sawSplitSundays = false;
  for (let year = 5784; year <= 5834; year++) {
    const poster = buildChanukahPoster(year, settings, tables), start = dateFromHebrew(25, 9, year);
    const dates = Array.from({ length: 8 }, (_, i) => start + i).filter(serial => excelWeekday(serial) !== 7);
    if (excelWeekday(start) === 7) dates.unshift(start - 1);
    assert.deepEqual(poster.minchaRows.flatMap(row => row.serials).sort((a, b) => a - b), dates,
      'Each weekday and the opening Friday appears once');
    const firsts = poster.minchaRows.map(row => row.serials[0]);
    assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b), 'Groups are ordered by their first date');
    firstKinds.add(poster.minchaRows[0].kind);
    sawSplitSundays ||= poster.minchaRows.filter(row => row.kind === 'sunday').length === 2;
    for (const row of poster.minchaRows) {
      const minutes = row.times.map(time => clockMins(time.text, AFTERNOON));
      assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), 'Each menu reads from earliest to latest');
      assert(row.times.every(time => time.trace && time.trace.plain() === time.text), 'Time explanations are retained');
      for (const serial of row.serials) {
        const friday = poster.erevShabbosList.find(day => day.serial === serial);
        const extra = poster.sundayMincha.find(day => day.serial === serial);
        const expected = friday ? friday.times.slice(0, -1).map(toCell)
          : [...(extra ? [toCell(extra.time)] : []), ...poster.weekdayMincha.map(toCell)]
            .sort((a, b) => clockMins(a.text, AFTERNOON) - clockMins(b.text, AFTERNOON));
        assert.deepEqual(cells(row.times), cells(expected), 'The full menu and every room match this actual day');
        assert.equal(row.kind, friday ? 'friday' : excelWeekday(serial) === 1 ? 'sunday' : 'weekday');
      }
    }
  }
  assert.deepEqual([...firstKinds].sort(), ['friday', 'sunday', 'weekday'], 'All three calendar orderings were exercised');
  assert(sawSplitSundays, 'Two Sundays with different starts are retained');
});

test('different Sunday menus remain complete and identifiable in the future two-Sunday year', () => {
  const poster = buildChanukahPoster(5804, settings, tables), sundays = poster.minchaRows.filter(row => row.kind === 'sunday');
  assert.equal(sundays.length, 2);
  assert.deepEqual(sundays.map(row => row.times[0].text), ['12:30', '12:35']);
  assert(sundays.every(row => row.times.length === 6 && row.label.includes('פרשת')));
  assert.notEqual(sundays[0].label, sundays[1].label);
  assert.deepEqual(poster.minchaRows.map(row => row.kind), ['sunday', 'weekday', 'friday', 'sunday']);
  assert.doesNotThrow(() => buildChanukahPoster(5804, settings), 'Calendar calculations still work without loaded parsha tables');
});
