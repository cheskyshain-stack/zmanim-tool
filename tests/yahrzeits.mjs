import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarISO } from '../js/calendar/model.js';
import { hebrewDateExtended, roshHashana } from '../js/hebrew-calendar.js';
import { yahrzeitDates, yahrzeitMember, yahrzeitsByDay } from '../js/yahrzeits/model.js';

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
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [] }), /at least one/);
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [father, father] }), /only one/);
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [{ ...custom, shortMonth: '' }] }), /without the 30th/);
  assert.throws(() => yahrzeitMember({ name: 'Test', observances: [{ ...father, month: 2, day: 30 }] }), /valid Hebrew date/);
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
    }
  }
});

test('the same civil date shows every matching observance', () => {
  const [serial] = yahrzeitDates(father, 5787);
  const first = yahrzeitMember({ name: 'Member one', observances: [father] });
  const second = yahrzeitMember({ name: 'Member two', observances: [{ ...father, kind: 'mother' }] });
  const index = yahrzeitsByDay([first, second], [{ serial, hebrew: { year: 5787 } }]);
  assert.deepEqual(index.get(serial).map(row => row.member.name), ['Member one', 'Member two']);
});
