import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarISO } from '../js/calendar/model.js';
import { hebrewDateExtended, roshHashana } from '../js/hebrew-calendar.js';
import { yahrzeitDates, yahrzeitMember, yahrzeitsByDay, yahrzeitHebrewDateSerial } from '../js/yahrzeits/model.js';

import { yahrzeitMembersFromRows, yahrzeitPlanImport } from '../js/yahrzeits/import.js';
import { yahrzeitListRange, yahrzeitListDays } from '../js/yahrzeits/list.js';

const dates = (entry, year) => yahrzeitDates(entry, year).map(calendarISO);
const father = { kind: 'father', month: 7, day: 10 };
const mother = { kind: 'mother', month: 12, day: 19, adar: 'both' };
const custom = { kind: 'custom', relationship: ' Grandfather ', deceasedName: ' ר׳ דוד ', month: 9, day: 30, shortMonth: 'next' };

test('member records support one parent, two parents and optional custom relationships', () => {
  assert.equal(yahrzeitMember({ name: 'Test member', observances: [father] }).observances.length, 1);
  const member = yahrzeitMember({ name: ' Test member ', observances: [father, mother, custom] });
  assert.equal(member.name, 'Test member');
  assert.equal(member.observances[2].relationship, 'Grandfather');
  assert.equal(member.observances[2].deceasedName, 'ר׳ דוד');
  assert.deepEqual(yahrzeitMember({ name: 'Test', observances: [] }), { name: 'Test', address: '', observances: [] });
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [father, father] }), /only one/);
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [{ ...custom, shortMonth: '' }] }), /without the 30th/);
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [{ ...father, month: 2, day: 30 }] }), /valid Hebrew date/);
});

test('spreadsheets accept names only and Hebrew dates and preserve recorded dates on reimport', () => {
  const { members: rows } = yahrzeitMembersFromRows([
    ['First Name', 'Last Name', 'Father Hebrew Date', 'Mother Hebrew Date', 'Custom Relationship', 'Custom Hebrew Date'],
    ['One', 'Member', '', ''],
    ['Two', 'Member', 'י״ב בתשרי', '19 Adar II', 'Grandfather', '30 Kislev (next month)'],
  ]);
  assert.deepEqual(rows[0], { name: 'One Member', address: '', observances: [] });
  assert.deepEqual(rows[1].observances.map(({ month, day, shortMonth }) => [month, day, shortMonth]), [[7, 12, ''], [14, 19, ''], [9, 30, 'next']]);
  assert.deepEqual(yahrzeitMembersFromRows([['One Member'], ['Two Member']]).members.map(member => member.name), ['One Member', 'Two Member']);
  assert.throws(() => yahrzeitMembersFromRows([['Name', 'Father Hebrew Date'], ['One Member', 45957]]), /Row 2.*Hebrew date/);
  assert.throws(() => yahrzeitMembersFromRows([['Name', 'Yahrzeit'], ['One Member', '12 Tishrei']]), /Father Hebrew Date/);
  const roster = yahrzeitMembersFromRows([
    ['Last Name', "Father's Name", "Mother's Name", 'Address', 'Father Cell'],
    ['Last', 'Father', 'Mother', '5 Example Street', 'ignore this'],
    ['Other', '', 'Mother', '8 Example Street', 'ignore this'],
  ]);
  assert.deepEqual(roster.members, [{ name: 'Father Last', address: '5 Example Street', observances: [] }]);
  assert.deepEqual(roster.skippedRows, [3]);
  const newAddress = yahrzeitPlanImport([{ id: 'existing-member', revision: 1, name: 'Father Last', observances: [] }], roster.members);
  assert.equal(newAddress.updated[0].address, '5 Example Street');
  assert.equal(newAddress.updated[0].revision, 2);
  const saved = [{ id: 'synthetic-one', revision: 5, ...rows[1] }];
  const updated = yahrzeitPlanImport(saved, rows);
  assert.equal(updated.added.length, 1);
  assert.equal(updated.updated.length, 0);
  assert.equal(updated.unchanged, 1);
  assert.throws(() => yahrzeitPlanImport(saved, [{ name: 'Two Member', observances: [father] }]), /Two different father dates/);
});

test('observances recur on the matching civil date and follow the chosen Adar custom', () => {
  assert.deepEqual(dates(father, 5787), ['2026-09-21']);
  assert.deepEqual(dates(father, 5788), ['2027-10-11']);
  assert.deepEqual(dates(mother, 5787), ['2027-02-26', '2027-03-28']);
  assert.deepEqual(dates(mother, 5788), ['2028-03-17']);
  assert.deepEqual(dates({ month: 14, day: 19 }, 5787), ['2027-03-28']);
  assert.deepEqual(dates({ month: 13, day: 30 }, 5787), ['2027-03-09']);
  assert.deepEqual(dates({ month: 13, day: 30 }, 5788), ['2028-02-27']);
});

test('the family can choose what happens when Cheshvan or Kislev has no 30th', () => {
  assert.deepEqual(dates({ ...custom, month: 8, shortMonth: 'both' }, 5790), ['2029-11-07', '2029-11-08']);
  assert.deepEqual(dates(custom, 5790), ['2029-12-07']);
  assert.deepEqual(dates({ ...custom, shortMonth: 'previous' }, 5790), ['2029-12-06']);
  assert.deepEqual(dates(custom, 5787), ['2026-12-10']);
});

test('every date in a full Hebrew calendar cycle maps back to its own day', () => {
  for (let year = 5780; year < 5799; year++) {
    for (let serial = roshHashana(year - 3761); serial < roshHashana(year - 3760); serial++) {
      const { month, dayOfMonth } = hebrewDateExtended(serial);
      assert.deepEqual(yahrzeitDates({ month, day: dayOfMonth }, year), [serial]);
      assert.equal(yahrzeitHebrewDateSerial(dayOfMonth, month, year), serial);
    }
  }
});

test('list filters use inclusive Shabbos to Shabbos weeks and both calendar years', () => {
  const bounds = (...args) => Object.values(yahrzeitListRange(...args)).map(calendarISO);
  assert.deepEqual(bounds('week', '2026-11-13'), ['2026-11-07', '2026-11-14']);
  assert.deepEqual(bounds('week', '2026-11-14'), ['2026-11-14', '2026-11-21']);
  assert.deepEqual(bounds('week', '2026-11-15'), ['2026-11-14', '2026-11-21']);
  assert.deepEqual(bounds('next-week', '2026-12-30'), ['2027-01-02', '2027-01-09']);
  assert.deepEqual(bounds('year', '2026-11-15'), ['2026-01-01', '2026-12-31']);
  assert.deepEqual(bounds('hebrew-year', '2026-11-15'), ['2026-09-12', '2027-10-01']);
  assert.equal(yahrzeitListRange('custom', '2026-11-15', '2026-12-01', '2026-11-30'), null);
  assert.equal(yahrzeitListRange('custom', '2026-11-15', '2026-02-30', '2026-12-31'), null);
});

test('list results are chronological and include both ends and both Adars when chosen', () => {
  const rows = [
    yahrzeitMember({ name: 'Member one', observances: [mother, father] }),
    yahrzeitMember({ name: 'Member two', observances: [{ ...father, kind: 'mother' }] }),
    yahrzeitMember({ name: 'A member without dates', observances: [] }),
  ];
  const range = yahrzeitListRange('custom', '2026-11-15', '2026-09-21', '2027-03-28');
  const groups = [...yahrzeitListDays(rows, range)];
  assert.deepEqual(groups.map(group => calendarISO(group.serial)), ['2026-09-21', '2027-02-26', '2027-03-28']);
  assert.deepEqual(groups[0].entries.map(item => item.member.name), ['Member one', 'Member two']);
  assert.deepEqual([...yahrzeitListDays(rows, range, true)].map(group => calendarISO(group.serial)), ['2027-03-28', '2027-02-26', '2026-09-21']);
});

test('the same civil date shows every matching observance', () => {
  const [serial] = yahrzeitDates(father, 5787);
  const first = yahrzeitMember({ name: 'Member one', observances: [father] });
  const second = yahrzeitMember({ name: 'Member two', observances: [{ ...father, kind: 'mother' }] });
  const index = yahrzeitsByDay([first, second], [{ serial, hebrew: { year: 5787 } }]);
  assert.deepEqual(index.get(serial).map(row => row.member.name), ['Member one', 'Member two']);
});
