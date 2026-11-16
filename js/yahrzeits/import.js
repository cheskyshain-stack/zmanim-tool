import { JEWISH_MONTHS_EN, JEWISH_MONTHS_HE } from '../hebrew-calendar.js';
import { YAHRZEIT_MAX_MEMBERS, yahrzeitMember, yahrzeitVariableMonth } from './model.js';

export const YAHRZEIT_IMPORT_COLUMNS = ['Name', 'Address', 'Father Hebrew Date', 'Mother Hebrew Date', 'Custom Relationship', 'Custom Hebrew Date'];

const yahrzeitHeader = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const yahrzeitNameKey = name => String(name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const yahrzeitHebrewDays = 'א ב ג ד ה ו ז ח ט י יא יב יג יד טו טז יז יח יט כ כא כב כג כד כה כו כז כח כט ל'.split(' ');
const yahrzeitMonthAliases = [
  ['Nisan'], [], ['Sivon'], ['Tamuz'], [], [], ['Tishri', 'Tishrey'],
  ['Cheshvon', 'Heshvan', 'Marcheshvan', 'חשוון', 'מרחשון', 'מרחשוון'],
  ['Kisleiv'], ['Tevet', 'Teveth'], ['Shvat', 'Shebat'],
  [], ['Adar 1', 'Adar Aleph'], ['Adar 2', 'Adar Bet', 'Adar Beis'],
];

const yahrzeitMonthsByName = new Map(JEWISH_MONTHS_EN.flatMap((label, index) =>
  [label, JEWISH_MONTHS_HE[index], ...yahrzeitMonthAliases[index]].map(name => [yahrzeitHeader(name), index + 1])));

function yahrzeitImportedDate(value) {
  const raw = String(value ?? '').trim();
  const qualifier = raw.match(/\s*\(([^()]*)\)$/u);
  const date = (qualifier ? raw.slice(0, qualifier.index) : raw).trim();
  const parts = date.replace(/[,،]/gu, ' ').trim().split(/\s+/u);
  if (parts.length > 2 && /^5\d{3}$/u.test(parts.at(-1))) parts.pop();
  const readDay = value => /^\d{1,2}$/u.test(value) ? Number(value) : yahrzeitHebrewDays.indexOf(yahrzeitHeader(value)) + 1;
  const readMonth = words => {
    const key = yahrzeitHeader(words.join(' '));
    return yahrzeitMonthsByName.get(key) || (key.startsWith('ב') ? yahrzeitMonthsByName.get(key.slice(1)) : undefined);
  };
  let day = readDay(parts[0]), month = readMonth(parts.slice(1));
  if (!day || !month) {
    day = readDay(parts.at(-1));
    month = readMonth(parts.slice(0, -1));
  }
  if (!day || !month) throw new Error('Enter a Hebrew date such as 12 Tishrei or י״ב תשרי.');
  const choice = yahrzeitHeader(qualifier?.[1]);
  if (yahrzeitVariableMonth(month, day)) {
    const shortMonth = new Map([['29th', 'previous'], ['nextmonth', 'next'], ['both', 'both']]).get(choice);
    if (!shortMonth) throw new Error('For 30 Cheshvan or 30 Kislev, add (29th), (next month), or (both).');
    return { month, day, shortMonth };
  }
  if (qualifier) throw new Error('Enter the Hebrew month and day without parentheses.');
  return { month, day };
}

export function yahrzeitMembersFromRows(rows) {
  let headerIndex = -1, columns, roster = false;
  const aliases = {
    name: ['name', 'fullname', 'member', 'membername', 'שם', 'שםמלא'],
    first: ['fathersname', 'fatherfirstname', 'first', 'firstname', 'givenname', 'שםפרטי'],
    address: ['address', 'streetaddress', 'homeaddress', 'כתובת'],
    last: ['last', 'lastname', 'surname', 'familyname', 'שםמשפחה'],
    father: ['fatherhebrewdate', 'fatheryahrzeit', 'fatheryortzeit', 'fatherdate', 'fathershebrewdate', 'יארצייטאב', 'תאריךפטירתאב'],
    mother: ['motherhebrewdate', 'motheryahrzeit', 'motheryortzeit', 'motherdate', 'mothershebrewdate', 'יארצייטאם', 'תאריךפטירתאם'],
    relationship: ['customrelationship', 'relationship'],
    custom: ['customhebrewdate', 'customyahrzeit', 'customdate'],
  };
  for (let index = 0; index < Math.min(rows.length, 50); index++) {
    const header = rows[index].map(yahrzeitHeader);
    const mapping = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, header.findIndex(value => names.includes(value))]));
    if (mapping.name >= 0 || (mapping.first >= 0 && mapping.last >= 0)) {
      headerIndex = index;
      columns = mapping;
      const fatherColumn = header.findIndex(value => value === 'fathersname' || value === 'fatherfirstname');
      if (fatherColumn >= 0 && mapping.last >= 0) {
        columns.first = fatherColumn;
        roster = true;
      }
      break;
    }
  }
  // Also accept a one-column list without a header.
  if (!columns) {
    const nonempty = rows.filter(row => row.some(value => String(value ?? '').trim()));
    if (!nonempty.length || nonempty.some(row => row.slice(1).some(value => String(value ?? '').trim()))) {
      throw new Error('Use a Name column or download the spreadsheet template.');
    }
    columns = { name: 0, first: -1, last: -1, address: -1, father: -1, mother: -1, relationship: -1, custom: -1 };
  }

  const datedHeaders = Object.entries(columns).filter(([field, index]) => !['name', 'first', 'last', 'address'].includes(field) && index >= 0);
  if (headerIndex >= 0) {
    const known = new Set(Object.values(columns));
    const unknownDate = rows[headerIndex].map(yahrzeitHeader).some((header, index) => !known.has(index) && /yahrzeit|yortz|יארצייט|^(father|mother|custom).*date/i.test(header));
    if (unknownDate) throw new Error('Use Father Hebrew Date, Mother Hebrew Date, or Custom Hebrew Date for yahrzeit columns.');
  }

  const members = [], skippedRows = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index], read = field => String(row[columns[field]] ?? '').trim();
    const first = read('first'), last = read('last'), address = read('address');
    const name = columns.name >= 0 && !roster ? read('name') : [first, last].filter(Boolean).join(' ');
    if (!name && !address && !datedHeaders.some(([field]) => read(field))) continue;
    if (roster && (!first || !last)) { skippedRows.push(index + 1); continue; }
    try {
      if (!/\p{L}/u.test(name)) throw new Error('Enter the member’s name.');
      const observances = [];
      for (const kind of ['father', 'mother', 'custom']) {
        const value = read(kind), relationship = kind === 'custom' ? read('relationship') : '';
        if (relationship && !value) throw new Error('Enter the Hebrew date for the custom relationship or leave both fields blank.');
        if (value) observances.push({ kind, relationship, ...yahrzeitImportedDate(value) });
      }
      members.push(yahrzeitMember({ name, address, observances }));
    } catch (error) {
      throw new Error(`Row ${index + 1}: ${error.message}`);
    }
  }
  if (!members.length) throw new Error('No member names were found.');
  if (members.length > YAHRZEIT_MAX_MEMBERS) throw new Error(`Import up to ${YAHRZEIT_MAX_MEMBERS.toLocaleString('en-US')} member rows at a time.`);
  return { members, skippedRows };
}

export function yahrzeitPlanImport(saved, rows) {
  const byName = new Map(), changes = new Map();
  for (const member of saved) {
    const key = yahrzeitNameKey(member.name);
    byName.set(key, byName.has(key) ? null : member);
  }
  for (const row of rows) {
    const key = yahrzeitNameKey(row.name);
    const found = byName.get(key);
    if (found === null) throw new Error(`More than one saved member is named ${row.name}. Edit those records separately.`);
    let change = changes.get(key);
    if (!change) {
      const member = { name: found?.name || row.name, address: found?.address || '', observances: [...(found?.observances || [])] };
      change = { existing: found, member };
    }
    if (!change.member.address && row.address) change.member.address = row.address;
    for (const entry of row.observances) {
      const dateMatches = current => current.day === entry.day && current.month === entry.month;
      if (entry.kind === 'custom') {
        const duplicate = change.member.observances.some(current => current.kind === 'custom' && dateMatches(current)
          && yahrzeitNameKey(current.relationship) === yahrzeitNameKey(entry.relationship));
        if (duplicate) continue;
      } else {
        const parent = change.member.observances.find(current => current.kind === entry.kind);
        if (parent) {
          if (dateMatches(parent)) continue;
          throw new Error(`Two different ${entry.kind} dates were found for ${change.member.name}. Edit that member separately.`);
        }
      }
      change.member.observances.push(entry);
    }
    changes.set(key, change);
  }

  const result = { added: [], updated: [], unchanged: 0 };
  for (const { existing, member } of changes.values()) {
    const valid = yahrzeitMember(member);
    if (!existing) result.added.push(valid);
    else if (valid.address !== (existing.address || '') || valid.observances.length !== existing.observances.length) {
      result.updated.push({ ...existing, ...valid, revision: existing.revision + 1 });
    }
    else result.unchanged++;
  }
  return result;
}
