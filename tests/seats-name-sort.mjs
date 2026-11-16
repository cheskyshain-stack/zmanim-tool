import test from 'node:test';
import assert from 'node:assert/strict';
import { seatsCompareNames, seatsSortPeople, seatsInitialsName } from '../js/seats/name-sort.js';

test('chart initials keep every given-name initial and the full surname', () => {
  assert.equal(seatsInitialsName('Yosef Chuam Cohen'), 'Y C Cohen');
  assert.equal(seatsInitialsName('yosef chuam cohen'), 'Y C Cohen');
  assert.equal(seatsInitialsName('Amrom Yitzchok Friedman'), 'A Y Friedman');
  assert.equal(seatsInitialsName('Rabbi Moshe Dovid Cohen Jr.'), 'M D Cohen Jr.');
  assert.equal(seatsInitialsName('Y. C. Cohen'), 'Y C Cohen');
});

test('chart initials retain compound surnames, Hebrew and accented initials', () => {
  assert.equal(seatsInitialsName('Sarah van der Meer'), 'S van der Meer');
  assert.equal(seatsInitialsName('Ari Ben David'), 'A Ben David');
  assert.equal(seatsInitialsName('Yosef Cohen-Levi'), 'Y Cohen-Levi');
  assert.equal(seatsInitialsName('הרב משה דוד כהן'), 'מ ד כהן');
  assert.equal(seatsInitialsName('Élie René Cohen'), 'É R Cohen');
});

test('single names and incomplete title-only names stay readable', () => {
  for (const name of ['Cohen', 'הרב', 'Rabbi Cohen', 'R. Cohen', '']) assert.equal(seatsInitialsName(name),name);
});

const people = names => names.map((name, index) => ({ id: String(index), name }));
const names = sorted => sorted.map(person => person.name);

test('first-name sorting skips titles and orders equal first names by the rest of the name', () => {
  const input = people(['Yosef Cohen', 'R. Chaim Brown Jr.', 'Rabbi Aaron Zilber', 'Moshe Aaron', 'Dr. Baruch Brown III', 'Reb Yitzchok Stern', 'Aaron Adler']);
  assert.deepEqual(names(seatsSortPeople(input, 'first')), ['Aaron Adler', 'Rabbi Aaron Zilber', 'Dr. Baruch Brown III', 'R. Chaim Brown Jr.', 'Moshe Aaron', 'Reb Yitzchok Stern', 'Yosef Cohen']);
  assert.deepEqual(names(seatsSortPeople(input)), names(seatsSortPeople(input, 'first')));
});

test('last-name sorting skips suffixes, keeps multi-part given names, and breaks surname ties by full name', () => {
  const input = people(['Rabbi Aaron Zilber', 'Yosef Cohen', 'R. Chaim Brown Jr.', 'Dr. Baruch Brown III', 'Moshe Aaron', 'Reb Yitzchok Stern', 'Sarah van Dijk']);
  assert.deepEqual(names(seatsSortPeople(input, 'last')), ['Moshe Aaron', 'Dr. Baruch Brown III', 'R. Chaim Brown Jr.', 'Yosef Cohen', 'Sarah van Dijk', 'Reb Yitzchok Stern', 'Rabbi Aaron Zilber']);
  assert.ok(seatsCompareNames('Amrom Yitzchok Friedman', 'Aaron Weiss', 'last') < 0);
  assert.ok(seatsCompareNames('Amrom Yitzchok Friedman', 'Aaron Weiss', 'first') > 0);
});

test('Hebrew names sort by the chosen meaningful first or last word without changing the label', () => {
  const input = people(['דוד לוי', 'הרב אברהם כהן', 'ר׳ יצחק אברמוביץ']);
  assert.deepEqual(names(seatsSortPeople(input, 'first')), ['הרב אברהם כהן', 'דוד לוי', 'ר׳ יצחק אברמוביץ']);
  assert.deepEqual(names(seatsSortPeople(input, 'last')), ['ר׳ יצחק אברמוביץ', 'הרב אברהם כהן', 'דוד לוי']);
});

test('sorting returns a separate array with the original records and stable duplicate names', () => {
  const input = people(['Moshe Levi', 'Aaron Cohen', 'Aaron Cohen', 'Yosef Weiss']), before = structuredClone(input);
  const sorted = seatsSortPeople(input, 'last');
  assert.notEqual(sorted, input);
  assert.deepEqual(input, before);
  assert.deepEqual(sorted.filter(person => person.name === 'Aaron Cohen').map(person => person.id), ['1', '2']);
  assert.ok(sorted.every(person => input.includes(person)));
});
