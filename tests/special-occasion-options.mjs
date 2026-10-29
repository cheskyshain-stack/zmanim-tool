import test from 'node:test';
import assert from 'node:assert/strict';
import { specialOccasionChoices, occasionOptions, orderedOccasionChoices, SPECIAL_COLLECTIONS, specialCollectionEntries } from '../js/ui/special-schedule-controls.js';

const groups = [
  { name: 'ראש השנה יום כיפור', firstStart: 1 }, { name: 'סוכות', firstStart: 15 },
  { name: 'ראש חודש', firstStart: 30 }, { name: 'פסח', firstStart: 190 },
  { name: 'שבועות', firstStart: 240 }, { name: 'חנוכה', firstStart: 70 },
];
const entry = (key, label, group, from, extras = {}) => ({ key, label, group,
  value: from == null ? null : { span: { from, to: from + 1 } }, ...extras });
const catalog = [
  entry('slichos', 'סליחות', groups[0].name, 1), entry('roshhashana', 'ראש השנה', groups[0].name, 5),
  entry('yomkippur', 'יום כיפור', groups[0].name, 12), entry('tzomgedalia', 'צום גדליה', groups[0].name, 8),
  entry('shuva', 'שבת שובה', groups[0].name, 10), entry('afteryk', 'Starting after יום כיפור', groups[0].name, 14),
  entry('pair', 'ראש השנה יום כיפור על דף אחד', groups[0].name, 5, { poster: { combined: true } }),
  entry('slichostzom', 'סליחות וצום גדליה', groups[0].name, 1, { poster: { combined: true } }),
  entry('occasion:' + groups[0].name, 'Whole occasion on one page', groups[0].name, 1, { whole: true }),
  entry('sukkos', 'סוכות', groups[1].name, 15), entry('pesach', 'פסח', groups[3].name, 190),
  entry('chanukah', 'חנוכה', groups[5].name, 70),
  ...[[8, 'חשון', 30], [9, 'כסלו', 59], [11, 'שבט', null], [13, 'אדר א', 145], [14, 'אדר ב', 175]]
    .map(([month, name, from]) => entry('roshchodesh' + month, 'ראש חודש ' + name, groups[2].name, from, { poster: { dated: true } })),
];

test('main holidays stay direct and Rosh Chodesh appears as one occasion', () => {
  const before = JSON.stringify({ groups, catalog });
  const choices = specialOccasionChoices(groups, catalog);
  assert.deepEqual(choices.filter(choice => choice.category === 'Yom Tov').map(choice => choice.name),
    ['ראש השנה', 'יום כיפור', 'סוכות', 'פסח', 'שבועות']);
  assert.deepEqual(choices.filter(choice => choice.category === 'Rosh Chodesh').map(choice => [choice.value, choice.group]),
    [['ראש חודש', 'ראש חודש']]);
  assert.deepEqual(choices.filter(choice => choice.category === 'Other schedules').map(choice => choice.key || choice.value),
    ['slichos', 'tzomgedalia', 'shuva', 'afteryk', 'חנוכה']);
  assert.equal(choices.find(choice => choice.key === 'yomkippur').group, 'ראש השנה יום כיפור');
  assert.equal(JSON.stringify({ groups, catalog }), before, 'The saved groups and source keys are not rewritten');
});

test('saved paired and whole-occasion pages have a correctly classified selected choice', () => {
  for (const [key, category] of [['pair', 'Yom Tov'], ['slichostzom', 'Other schedules'],
    ['occasion:' + groups[0].name, 'Yom Tov']]) {
    const choice = specialOccasionChoices(groups, catalog, { selectedKey: key }).find(choice => choice.key === key);
    assert.equal(choice.category, category); assert.equal(choice.value, 'poster:' + key);
  }
  const custom = entry('own:rc', 'Saved Rosh Chodesh schedule', 'ראש חודש', 30, { poster: { own: { id: 'rc' } } });
  const choices = specialOccasionChoices(groups, [...catalog, custom], { selectedKey: custom.key });
  assert.equal(choices.find(choice => choice.group === custom.group).category, 'Rosh Chodesh');
  assert.equal(choices.find(choice => choice.group === custom.group).name, 'ראש חודש');
});

test('individual and missing months stay out of the main occasion list', () => {
  const choices = specialOccasionChoices(groups, catalog, { selectedKey: 'roshchodesh11' });
  assert(!choices.some(choice => choice.key?.startsWith('roshchodesh')));
  assert.equal(choices.filter(choice => choice.group === 'ראש חודש').length, 1);
  assert(!specialOccasionChoices(groups, catalog.filter(entry => entry.key === 'roshchodesh11'), { availableOnly: true })
    .some(choice => choice.group === 'ראש חודש'));
});

test('addition pickers offer only available sources and preserve safe option labels', () => {
  const choices = specialOccasionChoices(groups, catalog.filter(entry => entry.poster?.dated || entry.key === 'slichos'), { availableOnly: true });
  assert(!choices.some(choice => choice.category === 'Yom Tov'));
  const html = occasionOptions(choices, 'ראש חודש');
  assert(html.includes('label="Rosh Chodesh"')); assert(html.includes('value="ראש חודש" selected'));
  assert(!html.includes('ראש חודש שבט'));
  const custom = occasionOptions([{ name: 'Custom <script>', value: 'one"two', category: 'Other schedules' }]);
  assert(!custom.includes('<script>')); assert(custom.includes('value="one&quot;two"'));
});

test('All collections use available original schedules without duplicated or unrelated pages', () => {
  const before = JSON.stringify(catalog);
  assert.deepEqual(specialCollectionEntries(catalog, 'yomtov').map(entry => entry.key),
    ['roshhashana', 'yomkippur', 'sukkos', 'pesach']);
  assert.deepEqual(specialCollectionEntries(catalog, 'roshchodesh').map(entry => entry.key),
    ['roshchodesh8', 'roshchodesh9', 'roshchodesh13', 'roshchodesh14']);
  assert.deepEqual(specialCollectionEntries(catalog, 'unknown'), []);
  assert.equal(JSON.stringify(catalog), before);
});

test('All Yom Tov leads its section while the main list contains one Rosh Chodesh choice', () => {
  const choices = specialOccasionChoices(groups, catalog);
  const html = occasionOptions(choices, 'ראש חודש', SPECIAL_COLLECTIONS.filter(collection => collection.kind === 'yomtov'));
  assert(html.includes('<optgroup label="Yom Tov"><option value="all:yomtov"'));
  assert(html.includes('<optgroup label="Rosh Chodesh"><option value="ראש חודש" selected'));
  assert(!html.includes('value="all:roshchodesh"'));
  assert(!occasionOptions(choices, 'ראש חודש').includes('value="all:'));
});

test('occasion navigation follows the displayed sections and includes the All selection', () => {
  const choices = specialOccasionChoices(groups, catalog);
  const before = JSON.stringify(choices);
  const ordered = orderedOccasionChoices(choices, SPECIAL_COLLECTIONS.filter(collection => collection.kind === 'yomtov'));
  assert.deepEqual(ordered.map(choice => choice.value), ['all:yomtov', 'poster:roshhashana', 'poster:yomkippur',
    'סוכות', 'פסח', 'שבועות', 'ראש חודש', 'poster:slichos', 'poster:tzomgedalia', 'poster:shuva', 'poster:afteryk', 'חנוכה']);
  assert.equal(JSON.stringify(choices), before);
});
