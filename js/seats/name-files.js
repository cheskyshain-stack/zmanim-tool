import { seatsAddNames } from './model.js';

export function seatsNormalizeNameFile(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 80) throw new Error('Name the file using 1 to 80 characters.');
  if (!Array.isArray(value.names) || value.names.length > 2000 || value.names.some(name => typeof name !== 'string' || name.length > 160)) throw new Error('A name file can contain up to 2,000 names, each at most 160 characters.');
  const list = { people: [] }; seatsAddNames(list, value.names.filter(name => /\p{L}/u.test(name)));
  if (!list.people.length) throw new Error('No names were found in this file.');
  return { name, names: list.people.map(person => person.name) };
}
