import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSettings } from '../js/settings.js';
import { hebrewDateExtended, excelWeekday, hasBehab, hasRoshChodesh, roshHashana } from '../js/hebrew-calendar.js';
import { dateFromSerial } from '../js/zmanim/solar.js';
import { sunriseElev } from '../js/zmanim/zmanim.js';
import { buildAsaraBTevesPoster } from '../js/posters/asarabteves.js';
import { buildAsaraShacharisPoster, buildBehabShacharisPoster, buildRoshChodeshShacharisPoster,
  ROSH_CHODESH_SHACHARIS_MONTHS } from '../js/posters/shacharis.js';
import { buildChanukahPoster } from '../js/posters/chanukah.js';
import { shacharisParts } from '../js/sheets/common.js';

const readJSON = async name => JSON.parse(await readFile(new URL('../data/' + name, import.meta.url)));
const [config, parshaChutz, parshaEY, parshaNames] = await Promise.all([
  'published.json', 'parsha_chutz.json', 'parsha_ey.json', 'parsha_names.json',
].map(readJSON));
const settings = resolveSettings(config.settings), tables = { parshaChutz, parshaEY, parshaNames };
const expected = [
  ['6:40', 'בית מדרש'], ['7:00', 'בעזרת נשים'],
  ['7:15', 'בית מדרש למטה'], ['7:35', 'באולם השמחות'],
  ['8:00', 'בית מדרש'], ['8:20', 'בעזרת נשים'], ['8:40', 'בית מדרש למטה'],
];
const rows = poster => poster.rows.map(row => [row.text, row.room]);

test('Asara handouts retain the full poster morning times, rooms and conditional note', () => {
  for (let year = 5784; year <= 5834; year++) {
    const full = buildAsaraBTevesPoster(year, settings), morning = buildAsaraShacharisPoster(year, settings);
    assert.deepEqual(rows(morning), expected);
    assert.deepEqual(morning.span, full.span);
    assert.deepEqual(morning.rows.map(({ text, mark, underlined, timeNote }) => ({ text, mark, underlined, timeNote })),
      full.sets.find(set => set.calc === 'shacharis').lines.flat().map(({ text, mark, underlined, timeNote }) => ({ text, mark, underlined, timeNote })));
    assert.equal(morning.title, 'עשרה בטבת');
    assert.equal(morning.sets, undefined, 'The handout does not contain other tefillos');
  }
  const earlySunrise = buildAsaraShacharisPoster(5786, { ...settings, latitude: 0 });
  assert.equal(earlySunrise.rows.some(row => row.timeNote), false, 'The Selichos note is absent when sunrise is before 7:05');
  assert.equal(buildAsaraShacharisPoster(null, settings), null);
});

test('both BHB rounds use the chart calendar and special Shacharis schedule every year', () => {
  for (let year = 5784; year <= 5834; year++) for (const month of [8, 2]) {
    const poster = buildBehabShacharisPoster(year, month, settings, tables);
    assert.deepEqual(rows(poster), expected);
    assert.equal(poster.title, month === 8 ? 'בה"ב אחר סוכות' : 'בה"ב אחר פסח');
    assert.equal(poster.subtitle, 'שחרית');
    assert.equal(poster.days.length, 3);
    assert.deepEqual(poster.days.map(excelWeekday), [2, 5, 2]);
    assert.deepEqual(poster.days.slice(1).map((serial, i) => serial - poster.days[i]), [3, 4]);
    assert(poster.days.every(serial => {
      const date = hebrewDateExtended(serial);
      return date.year === year && date.month === month && hasBehab(serial, settings);
    }));
    assert.deepEqual(poster.span, { from: poster.days[0], to: poster.days[2] });
    const needsSelichos = poster.days.some(serial => sunriseElev(dateFromSerial(serial), settings) * 1440 > 425);
    assert.equal(Boolean(poster.rows[0].timeNote), needsSelichos, 'BHB uses actual sunrise for the 6:40 Selichos note');
    assert.equal(poster.rows.slice(1).some(row => row.timeNote), false, 'The Selichos note belongs only to 6:40');
  }
  assert.deepEqual(buildBehabShacharisPoster(5787, 8, settings, tables).days.map(serial => dateFromSerial(serial).toISOString().slice(0, 10)),
    ['2026-10-19', '2026-10-22', '2026-10-26']);
  assert.equal(buildBehabShacharisPoster(5787, 9, settings), null);
});

test('BHB Selichos notes cover all, none, or the specific qualifying dates in a round', () => {
  const note = (year, month, options = settings) => buildBehabShacharisPoster(year, month, options, tables).rows[0].timeNote;
  assert.equal(note(5787, 8), 'סליחות קודם שחרית',
    'When all three dates qualify, the common note has no weekday or parsha details');
  assert.equal(note(5785, 8), undefined, 'After the clock change all three dates have earlier Netz');
  assert.equal(note(5787, 2), undefined, 'After-Pesach sunrise is earlier than 7:05');
  assert.equal(note(5786, 8), 'סליחות קודם שחרית (יום ב׳ וה׳ לך לך)',
    'A clock change before the third date must not apply the note to that date');
  assert.equal(note(5793, 8), 'סליחות קודם שחרית (יום ה׳ לך לך, יום ב׳ וירא)',
    'Only the later two dates cross the sunrise threshold');
  assert.equal(note(5787, 2, { ...settings, longitude: -110 }), 'סליחות קודם שחרית',
    'The same sunrise rule applies to the after-Pesach round when the calculation settings require it');
  assert.equal(note(5787, 8, { ...settings, latitude: 0 }), undefined,
    'An earlier sunrise from the configured location removes the note');
  assert.equal(note(5786, 8, { ...settings, english: true }), 'סליחות קודם שחרית (יום ב׳ וה׳ לך לך)',
    'The printed note stays Hebrew when the admin uses English');
});

test('Rosh Chodesh handouts cover weekday and Shabbos-only months using their respective chart times', () => {
  let oneDay = false, twoDays = false, shabbosOnly = false, adarI = false, adarII = false;
  for (let year = 5784; year <= 5834; year++) {
    const months = new Map();
    for (let serial = roshHashana(year - 3761); serial < roshHashana(year - 3760); serial++) {
      if (!hasRoshChodesh(serial, settings)) continue;
      const date = hebrewDateExtended(serial);
      const month = date.dayOfMonth === 30 ? hebrewDateExtended(serial + 1).month : date.month;
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(serial);
    }
    for (const month of ROSH_CHODESH_SHACHARIS_MONTHS) {
      const calendarDays = months.get(month) || [];
      const weekdays = calendarDays.filter(serial => excelWeekday(serial) !== 7);
      const days = weekdays.length ? weekdays : calendarDays;
      const poster = buildRoshChodeshShacharisPoster(year, month, settings);
      if (!days.length) {
        assert.equal(poster, null);
        continue;
      }
      if (days.length === 1) oneDay = true;
      if (days.length === 2) twoDays = true;
      if (month === 13) adarI = true;
      if (month === 14) adarII = true;
      assert.deepEqual(poster.days, days);
      assert.deepEqual(poster.span, { from: days[0], to: days.at(-1) });
      assert.equal(poster.month, month);
      assert(poster.title.startsWith('ראש חודש '));
      assert.equal(poster.subtitle, 'שחרית');
      assert.equal(poster.rows.some(row => row.timeNote), false, 'No Asara Selichos note on Rosh Chodesh');
      if (!weekdays.length) {
        shabbosOnly = true;
        assert.equal(poster.shabbosOnly, true);
        assert.equal(poster.dayLabel, 'שבת');
        assert.deepEqual(rows(poster), [['7:30', 'בית מדרש למטה'], ['8:15', 'בית מדרש']]);
        assert.deepEqual(poster.rows.map(row => row.trace.steps), shacharisParts().times.map(trace => trace.steps));
      } else if (month === 10) {
        const chanukah = buildChanukahPoster(year, settings).shacharisRows.find(row => row.isRoshChodesh);
        assert.equal(poster.rows[0].text, chanukah.vasikin.time);
        assert.deepEqual(poster.rows.slice(1).map(row => row.text), chanukah.cells.slice(1).map(cell => cell.text));
        assert.deepEqual(poster.rows.map(row => row.room), expected.map(row => row[1]));
        assert(poster.title.endsWith(' · חנוכה'));
      } else assert.deepEqual(rows(poster), expected);
    }
    assert.equal(buildRoshChodeshShacharisPoster(year, 7, settings), null, 'Rosh Hashana has its own schedule');
  }
  assert(oneDay && twoDays && shabbosOnly && adarI && adarII, 'All calendar shapes were exercised');
  assert.equal(buildRoshChodeshShacharisPoster(null, 8, settings), null);
});

test('Shevat 5787 remains available on Shabbos with the Shabbos schedule', () => {
  const poster = buildRoshChodeshShacharisPoster(5787, 11, settings);
  assert.equal(poster.title, 'ראש חודש שבט');
  assert.equal(poster.dayLabel, 'שבת');
  assert.deepEqual(poster.days.map(serial => dateFromSerial(serial).toISOString().slice(0, 10)), ['2027-01-09']);
  assert.deepEqual(rows(poster), [['7:30', 'בית מדרש למטה'], ['8:15', 'בית מדרש']]);
});
