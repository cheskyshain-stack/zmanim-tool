import { roshHashana, JEWISH_MONTHS_EN, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';

export const YAHRZEIT_MAX_OBSERVANCES = 12;
export const YAHRZEIT_MONTHS = [7, 8, 9, 10, 11, 12, 13, 14, 1, 2, 3, 4, 5, 6];
export const yahrzeitMonthLabel = month => `${JEWISH_MONTHS_EN[month - 1]} (${JEWISH_MONTHS_HE[month - 1]})`;
export const yahrzeitRelationship = entry => entry.kind === 'custom' ? entry.relationship : entry.kind === 'father' ? 'Father' : 'Mother';
export const yahrzeitMonthLimit = month => [2, 4, 6, 10, 12, 14].includes(month) ? 29 : 30;
export const yahrzeitVariableMonth = (month, day) => day === 30 && [8, 9].includes(month);

function yahrzeitText(value, message, limit, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > limit || (required && !value.trim())) throw new Error(message);
  return value.trim();
}

export function yahrzeitMember(value) {
  const name = yahrzeitText(value?.name, 'Enter a congregation member’s name (up to 100 characters).', 100, true);
  if (!Array.isArray(value.observances) || !value.observances.length || value.observances.length > YAHRZEIT_MAX_OBSERVANCES) {
    throw new Error('Enter at least one yahrzeit for this member.');
  }
  const parents = new Set();
  const observances = value.observances.map(entry => {
    const kind = entry?.kind;
    if (!['father', 'mother', 'custom'].includes(kind)) throw new Error('Choose Father, Mother or a custom relationship.');
    if (kind !== 'custom' && parents.has(kind)) throw new Error('Use only one entry for each parent.');
    if (kind !== 'custom') parents.add(kind);
    const relationship = kind === 'custom' ? yahrzeitText(entry.relationship, 'Enter the custom relationship (up to 60 characters).', 60, true) : '';
    const deceasedName = yahrzeitText(entry.deceasedName, 'Keep the name of the deceased to 140 characters or less.', 140);
    const { month, day } = entry;
    if (!YAHRZEIT_MONTHS.includes(month) || !Number.isInteger(day) || day < 1 || day > yahrzeitMonthLimit(month)) {
      throw new Error(`Choose a valid Hebrew date for ${yahrzeitRelationship({ kind, relationship })}.`);
    }
    const adar = month === 12 ? entry.adar ?? 'first' : '';
    if (month === 12 && !['first', 'second', 'both'].includes(adar)) throw new Error('Choose an Adar preference for leap years.');
    const shortMonth = yahrzeitVariableMonth(month, day) ? entry.shortMonth : '';
    if (yahrzeitVariableMonth(month, day) && !['previous', 'next', 'both'].includes(shortMonth)) {
      throw new Error('Choose what to use in years without the 30th.');
    }
    return { kind, relationship, deceasedName, month, day, adar, shortMonth };
  });
  return { name, observances };
}

// Work from Rosh Hashana and the current year's actual month lengths. The
// workbook's inverse helper assumes a different leap-year offset for Adar.
function yahrzeitMonthStart(month, year, leap) {
  const first = roshHashana(year - 3761);
  const yearType = (roshHashana(year - 3760) - first) % 10;
  const months = [7, 8, 9, 10, 11, ...(leap ? [13, 14] : [12]), 1, 2, 3, 4, 5, 6];
  let start = first;
  for (const current of months) {
    if (current === month) break;
    start += current === 8 ? (yearType === 5 ? 30 : 29)
      : current === 9 ? (yearType === 3 ? 29 : 30) : yahrzeitMonthLimit(current);
  }
  return start;
}

export function yahrzeitDates(entry, year) {
  const leap = (year * 7 + 1) % 19 < 7;
  let { day, month } = entry;
  if (month === 12 && leap) {
    return (entry.adar === 'both' ? [13, 14] : [entry.adar === 'second' ? 14 : 13]).map(adar => yahrzeitMonthStart(adar, year, leap) + day - 1);
  }
  if (month >= 13 && !leap) {
    if (month === 13 && day === 30) { month = 11; }
    else { month = 12; }
  }
  const date = yahrzeitMonthStart(month, year, leap) + day - 1;
  if (yahrzeitVariableMonth(month, day) && date === yahrzeitMonthStart(month + 1, year, leap)) {
    return entry.shortMonth === 'both' ? [date - 1, date] : [entry.shortMonth === 'next' ? date : date - 1];
  }
  return [date];
}

export function yahrzeitsByDay(members, days) {
  const years = new Set(days.map(day => day.hebrew.year));
  const monthDays = new Set(days.map(day => day.serial)), index = new Map();
  for (const member of members) {
    for (const entry of member.observances) {
      for (const year of years) {
        for (const date of yahrzeitDates(entry, year)) {
          if (!monthDays.has(date)) continue;
          if (!index.has(date)) index.set(date, []);
          index.get(date).push({ member, entry });
        }
      }
    }
  }
  return index;
}
