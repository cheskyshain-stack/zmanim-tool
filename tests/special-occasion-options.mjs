import test from 'node:test';
import assert from 'node:assert/strict';
import { specialOccasionChoices, occasionOptions } from '../js/ui/special-schedule-controls.js';

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

test('main holidays and every available Rosh Chodesh open their canonical sources directly', () => {
  const before = JSON.stringify({ groups, catalog });
  const choices = specialOccasionChoices(groups, catalog);
  assert.deepEqual(choices.filter(choice => choice.category === 'Yom Tov').map(choice => choice.name),
    ['ראש השנה', 'יום כיפור', 'סוכות', 'פסח', 'שבועות']);
  assert.deepEqual(choices.filter(choice => choice.category === 'Rosh Chodesh').map(choice => [choice.key, choice.group]),
    ['8', '9', '13', '14'].map(month => ['roshchodesh' + month, 'ראש חודש']));
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
});

test('missing weekday months are omitted and queued missing pages remain identifiable', () => {
  const choices = specialOccasionChoices(groups, catalog, { selectedKey: 'roshchodesh11' });
  assert.equal(choices.find(choice => choice.key === 'roshchodesh11').disabled, true);
  assert(!specialOccasionChoices(groups, catalog, { selectedKey: 'roshchodesh11', availableOnly: true })
    .some(choice => choice.key === 'roshchodesh11'));
});

test('addition pickers offer only available sources and preserve safe option labels', () => {
  const choices = specialOccasionChoices(groups, catalog.filter(entry => entry.poster?.dated || entry.key === 'slichos'), { availableOnly: true });
  assert(!choices.some(choice => choice.category === 'Yom Tov'));
  const html = occasionOptions(choices, 'poster:roshchodesh9');
  assert(html.includes('label="Rosh Chodesh"')); assert(html.includes('value="poster:roshchodesh9" selected'));
  assert(!html.includes('ראש חודש שבט'));
  const custom = occasionOptions([{ name: 'Custom <script>', value: 'one"two', category: 'Other schedules' }]);
  assert(!custom.includes('<script>')); assert(custom.includes('value="one&quot;two"'));
});
